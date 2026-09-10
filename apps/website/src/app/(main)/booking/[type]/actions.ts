"use server";

import { addBreadcrumb, captureException, setContext, setTag, startSpan } from "@sentry/nextjs";
import { format } from "date-fns";
import { revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { getAvailability } from "@/lib/availability";
import { isValidDateRange, mergeDateRanges } from "@/lib/date-utils";
import { calculateTotalPrice } from "@/lib/price-utils";
import { captureBookingError } from "@/lib/sentry-booking";
import { combinePhoneNumber } from "@/lib/shared/country-codes";
import { upsertGuestContact } from "@/lib/shared/guest-contacts";
import { checkoutSchema } from "@/lib/shared/schemas/booking";
import { createAdminClient } from "@/lib/shared/supabase";
import { formatZodErrors } from "@/lib/shared/validation";
import { stripe } from "@/lib/stripe";
import type { DateRange } from "@/lib/shared/types/booking";
import { emailSchema, localNumberSchema, nameSchema } from "./validation";

const ROOM_LABELS: Record<string, string> = {
  room1: "Room 1",
  room2: "Room 2",
};

const ROOM_IMAGES: Record<string, string> = {
  room1: "/bed.webp",
  room2: "/bed_bedroom2.webp",
};

type BookingFormValues = {
  guestName: string;
  email: string;
  countryId: string;
  localNumber: string;
  whatsappOptIn: boolean;
};

// React resets an uncontrolled <form>'s DOM values as soon as an `action`
// submission starts (react-dom's requestFormReset), not just on success —
// without re-seeding, a field error or dates_unavailable conflict would
// silently wipe what the guest typed. `values` echoes back the submitted
// values so the component can re-key the inputs (forcing a remount with a
// fresh `defaultValue`) and restore them. It's never null: every return
// branch populates it, so `state.values.x` is safe to read without a
// fallback.
export type BookingFormState = {
  attempt: number;
  errors: Partial<Record<string, string>>;
  generalError: string;
  values: BookingFormValues;
  blockedDates: DateRange[] | null;
  success: boolean;
  url: string | null;
  guestContactId: string | null;
};

function toFieldErrors(error: Parameters<typeof formatZodErrors>[0]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { field, message } of formatZodErrors(error)) {
    if (!(field in errors)) errors[field] = message;
  }
  return errors;
}

// The last server-side gate before money moves. It has to agree with the
// calendar the guest actually picked from, which is built by
// `getAvailability` (iCal feeds for Airbnb/VRBO/Booking.com merged with our
// own confirmed bookings). A `bookings`-table query alone is blind to every
// OTA reservation, so a night blocked purely by an Airbnb stay used to sail
// straight through here into a Stripe session and a `pending` row, i.e. a
// double booking.
type AvailabilityVerdict =
  { ok: true } | { ok: false; reason: "conflict" | "unverifiable"; blockedDates: DateRange[] };

async function checkAvailability(
  roomType: string,
  checkIn: string,
  checkOut: string,
): Promise<AvailabilityVerdict> {
  const supabase = createAdminClient();

  const { data: conflicts } = await supabase
    .from("bookings")
    .select("id")
    .eq("room_type", roomType)
    .eq("status", "confirmed")
    .lt("check_in", checkOut) // existing starts before requested ends
    .gt("check_out", checkIn) // existing ends after requested starts
    .limit(1);

  // Read the cached snapshot BEFORE expiring the tag. If the fresh read below
  // comes back with a failed feed, this is our last known good picture of that
  // feed, at most one cacheLife("minutes") window old.
  const lastKnownGood = await getAvailability(roomType);

  if (conflicts && conflicts.length > 0) {
    addBreadcrumb({
      category: "booking",
      message: "Availability check rejected by own confirmed bookings",
      data: { roomType, checkIn, checkOut },
      level: "warning",
    });
    return {
      ok: false,
      reason: "conflict",
      blockedDates: mergeDateRanges(lastKnownGood.bookings),
    };
  }

  // Second gate: the merged calendar. A cached read would still miss an OTA
  // reservation made minutes ago, which is exactly the race this check exists
  // to close, so expire the tag first and read current feed state.
  revalidateTag(`availability-${roomType}`, { expire: 0 });
  const fresh = await getAvailability(roomType);

  // A feed that did not answer leaves `fresh.bookings` incomplete, so it would
  // under-block. Union it with the last known good snapshot instead: a night
  // counts as taken if EITHER picture says so. That keeps an outage from
  // opening a double-booking hole without turning paying guests away on
  // dates we already know are free. Over-blocking is possible only for a stay
  // cancelled on an OTA inside the last cache window, which is rare and safe.
  let blockedRanges: DateRange[];
  if (fresh.error) {
    if (lastKnownGood.error) {
      // Neither read produced a complete picture, so we cannot verify this
      // stay at all. Refuse rather than gamble on a double booking.
      addBreadcrumb({
        category: "ical",
        message: "Availability unverifiable: no complete feed data, refusing booking",
        data: { roomType, checkIn, checkOut, freshError: fresh.error },
        level: "error",
      });
      return { ok: false, reason: "unverifiable", blockedDates: mergeDateRanges(fresh.bookings) };
    }

    addBreadcrumb({
      category: "ical",
      message: "Feed failed on re-check, falling back to union with last known good snapshot",
      data: { roomType, checkIn, checkOut, freshError: fresh.error },
      level: "warning",
    });
    blockedRanges = mergeDateRanges([...fresh.bookings, ...lastKnownGood.bookings]);
  } else {
    blockedRanges = mergeDateRanges(fresh.bookings);
  }

  // Same predicate the calendar classifies dates with, fed the same merged
  // ranges, so the server and the UI can never disagree about a range.
  if (!isValidDateRange(new Date(checkIn), new Date(checkOut), blockedRanges)) {
    addBreadcrumb({
      category: "booking",
      message: "Availability check rejected by merged calendar (iCal feeds or own bookings)",
      data: {
        roomType,
        checkIn,
        checkOut,
        blockedRangeCount: blockedRanges.length,
        degraded: Boolean(fresh.error),
      },
      level: "warning",
    });
    return { ok: false, reason: "conflict", blockedDates: blockedRanges };
  }

  return { ok: true };
}

export async function submitBooking(
  roomType: "room1" | "room2",
  checkInDate: Date | null,
  checkOutDate: Date | null,
  source: "direct" | "gca",
  prevState: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const attempt = (prevState?.attempt ?? 0) + 1;

  const guestName = String(formData.get("guestName") ?? "");
  const email = String(formData.get("email") ?? "");
  const countryId = String(formData.get("countryId") ?? "");
  const localNumber = String(formData.get("localNumber") ?? "").replace(/\D/g, "");
  const whatsappOptIn = formData.get("whatsappOptIn") === "on";

  const values: BookingFormValues = { guestName, email, countryId, localNumber, whatsappOptIn };

  if (!checkInDate || !checkOutDate) {
    const generalError = "Please select check-in and check-out dates.";
    captureBookingError(new Error(generalError), { roomType }, { step: "checkout_creation" });
    return {
      attempt,
      errors: {},
      generalError,
      values,
      blockedDates: null,
      success: false,
      url: null,
      guestContactId: null,
    };
  }

  // These produce the friendly, guest-facing messages; checkoutSchema's
  // validation below is a defense-in-depth backstop guests shouldn't
  // normally see.
  const fieldErrors: Record<string, string> = {};
  const emailResult = emailSchema.safeParse(email);
  if (!emailResult.success) fieldErrors.email = emailResult.error.issues[0].message;
  const nameResult = nameSchema.safeParse(guestName);
  if (!nameResult.success) fieldErrors.guestName = nameResult.error.issues[0].message;
  const localNumberResult = localNumberSchema.safeParse(localNumber);
  if (!localNumberResult.success) {
    fieldErrors.localNumber = localNumber
      ? localNumberResult.error.issues[0].message
      : "Phone number is required";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      attempt,
      errors: fieldErrors,
      generalError: "",
      values,
      blockedDates: null,
      success: false,
      url: null,
      guestContactId: null,
    };
  }

  const phone = combinePhoneNumber(countryId, localNumber);
  const checkIn = format(checkInDate, "yyyy-MM-dd");
  const checkOut = format(checkOutDate, "yyyy-MM-dd");

  addBreadcrumb({
    category: "booking",
    message: "User initiated booking",
    data: { roomType, checkIn, checkOut, email, guestName, phone, whatsappOptIn, source },
    level: "info",
  });

  return startSpan(
    {
      name: "api.checkout.create",
      op: "http.server",
      attributes: { "http.route": "booking.submitBooking" },
    },
    async (parentSpan) => {
      const validation = checkoutSchema.safeParse({
        roomType,
        checkIn,
        checkOut,
        personCount: Number(formData.get("personCount") ?? 1),
        email,
        guestName,
        phone,
        whatsappOptIn,
        source,
      });

      if (!validation.success) {
        parentSpan?.setStatus({ code: 2, message: "Validation failed" });
        return {
          attempt,
          errors: toFieldErrors(validation.error),
          generalError: "",
          values,
          blockedDates: null,
          success: false,
          url: null,
          guestContactId: null,
        };
      }

      const { personCount } = validation.data;

      parentSpan?.setAttributes({
        "booking.roomType": roomType,
        "booking.checkIn": checkIn,
        "booking.checkOut": checkOut,
        "booking.personCount": personCount,
      });

      setContext("booking", { roomType, checkIn, checkOut, personCount, email });

      const checkInDateOnly = new Date(checkIn);
      const checkOutDateOnly = new Date(checkOut);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (checkInDateOnly < today) {
        parentSpan?.setStatus({ code: 2, message: "Check-in in past" });
        const generalError = "Check-in date cannot be in the past";
        captureBookingError(
          new Error(generalError),
          { roomType, checkIn, checkOut, personCount },
          { step: "checkout_creation" },
        );
        return {
          attempt,
          errors: {},
          generalError,
          values,
          blockedDates: null,
          success: false,
          url: null,
          guestContactId: null,
        };
      }

      const verdict = await checkAvailability(roomType, checkIn, checkOut);
      if (!verdict.ok) {
        parentSpan?.setStatus({ code: 2, message: "Dates unavailable" });

        const generalError =
          verdict.reason === "unverifiable"
            ? "We could not confirm availability for these dates just now, so we have not taken any payment. Please try again in a few minutes, or message us and we will confirm by hand."
            : "Sorry, these dates were just booked by someone else. The calendar has been refreshed. Please select new dates.";

        captureBookingError(
          new Error(generalError),
          { roomType, checkIn, checkOut, personCount },
          { step: "checkout_creation" },
        );
        return {
          attempt,
          errors: {},
          generalError,
          values,
          blockedDates: verdict.blockedDates,
          success: false,
          url: null,
          guestContactId: null,
        };
      }

      // guest_contact_id is NOT NULL on bookings, so this must resolve
      // before the pending row can be written — checked fail-fast, before
      // the Stripe session is created (no charge has happened yet here).
      let guestContactId: string;
      try {
        guestContactId = await upsertGuestContact({ phone, email, guestName, whatsappOptIn });
      } catch (contactError) {
        parentSpan?.setStatus({ code: 2, message: "guest_contacts upsert failed" });
        captureException(contactError, { tags: { "db.operation": "guest_contacts_upsert" } });
        return {
          attempt,
          errors: {},
          generalError: "Failed to create checkout session",
          values,
          blockedDates: null,
          success: false,
          url: null,
          guestContactId: null,
        };
      }

      const { nights, basePrice, touristTax, total } = calculateTotalPrice(
        checkInDateOnly,
        checkOutDateOnly,
        personCount,
      );

      parentSpan?.setAttributes({
        "booking.nights": nights,
        "booking.totalAmount": total,
      });

      try {
        // Server Actions have no `request.url` to derive origin from —
        // same host-header pattern as booking/confirmation/page.tsx.
        const headersList = await headers();
        const host = headersList.get("host") || "localhost:3000";
        const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
        const origin = `${protocol}://${host}`;

        const roomLabel = ROOM_LABELS[roomType];
        const imageUrl = `https://issebya.com${ROOM_IMAGES[roomType]}`;

        const formatDate = (dateStr: string) => {
          const date = new Date(dateStr);
          return date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
        };

        const session = await startSpan(
          {
            name: "stripe.create_checkout_session",
            op: "payment.stripe",
            attributes: {
              "stripe.mode": "payment",
              "booking.totalAmount": total,
            },
          },
          async (stripeSpan) => {
            const stripeSession = await stripe.checkout.sessions.create({
              payment_method_types: ["card"],
              line_items: [
                {
                  price_data: {
                    currency: "eur",
                    product_data: {
                      name: `${formatDate(checkIn)} – ${formatDate(checkOut)}`,
                      description: `${roomLabel}: ${nights} night${nights > 1 ? "s" : ""}`,
                      images: imageUrl ? [imageUrl] : [],
                    },
                    unit_amount: Math.round(basePrice * 100),
                  },
                  quantity: 1,
                },
                {
                  price_data: {
                    currency: "eur",
                    product_data: { name: "Tourist tax" },
                    unit_amount: Math.round(touristTax * 100),
                  },
                  quantity: 1,
                },
              ],
              metadata: {
                roomType,
                checkIn,
                checkOut,
                personCount: String(personCount),
                email,
                nights: String(nights),
                basePrice: String(basePrice),
                touristTax: String(touristTax),
                total: String(total),
                ...(guestName ? { guestName } : {}),
                ...(phone ? { phone } : {}),
                whatsappOptIn: String(whatsappOptIn),
                source,
              },
              customer_email: email,
              // eslint-disable-next-line no-secrets/no-secrets -- Stripe URL template placeholder, not a secret
              success_url: `${origin}/booking/confirmation?session={CHECKOUT_SESSION_ID}`,
              cancel_url: `${origin}/booking/${roomType}`,
              mode: "payment",
            });
            stripeSpan?.setAttribute("stripe.sessionId", stripeSession.id);
            return stripeSession;
          },
        );

        await startSpan(
          {
            name: "supabase.insert_pending_booking",
            op: "db.query",
            attributes: {
              "db.operation": "insert",
              "db.table": "bookings",
            },
          },
          async (dbSpan) => {
            const supabase = createAdminClient();
            const { error: insertError } = await supabase.from("bookings").insert({
              room_type: roomType,
              check_in: checkIn,
              check_out: checkOut,
              nights,
              person_count: personCount,
              base_price: basePrice,
              tourist_tax: touristTax,
              total_amount: total,
              guest_contact_id: guestContactId,
              source,
              stripe_session_id: session.id,
              status: "pending",
            });

            if (insertError) {
              dbSpan?.setStatus({ code: 2, message: "Insert failed" });
              addBreadcrumb({
                category: "database",
                message: "Failed to create pending booking",
                data: { error: insertError.message },
                level: "warning",
              });
            } else {
              dbSpan?.setAttribute("booking.stripeSessionId", session.id);
            }
          },
        );

        setTag("booking.sessionId", session.id);
        parentSpan?.setAttribute("booking.stripeSessionId", session.id);

        return {
          attempt,
          errors: {},
          generalError: "",
          values,
          blockedDates: null,
          success: true,
          url: session.url,
          guestContactId,
        };
      } catch (error) {
        parentSpan?.setStatus({ code: 2, message: "Checkout creation failed" });
        captureException(error);
        return {
          attempt,
          errors: {},
          generalError: "Failed to create checkout session",
          values,
          blockedDates: null,
          success: false,
          url: null,
          guestContactId: null,
        };
      }
    },
  );
}
