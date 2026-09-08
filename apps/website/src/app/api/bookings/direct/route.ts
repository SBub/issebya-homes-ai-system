import { addBreadcrumb, setTag, startSpan } from "@sentry/nextjs";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { upsertGuestContact } from "@/lib/shared/guest-contacts";
import { createAdminClient } from "@/lib/shared/supabase";
import { stripe } from "@/lib/stripe";

// bookings no longer stores email directly (see
// 20260821160000_link_bookings_to_guest_contacts.sql) — it's joined through
// guest_contact_id and flattened back onto a top-level `email` key so the
// booking confirmation page's (page.tsx) existing `booking.email` usage
// keeps working unchanged.
type EmbeddedGuestContact =
  { email: string | null } | { email: string | null }[] | null | undefined;

function flattenGuestEmail<T extends { guest_contacts?: EmbeddedGuestContact }>(
  booking: T,
): Omit<T, "guest_contacts"> & { email: string | null } {
  const { guest_contacts, ...rest } = booking;
  const contact = Array.isArray(guest_contacts) ? guest_contacts[0] : guest_contacts;
  return { ...rest, email: contact?.email ?? null };
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session");

  return startSpan(
    {
      name: "api.bookings.direct",
      op: "http.server",
      attributes: {
        "http.route": "/api/bookings/direct",
        "booking.stripeSessionId": sessionId || "missing",
      },
    },
    async (parentSpan) => {
      if (!sessionId) {
        parentSpan?.setStatus({ code: 2, message: "Missing session" });
        return NextResponse.json({ error: "Session is required" }, { status: 400 });
      }

      setTag("booking.sessionId", sessionId);

      // Database lookup with child span
      const { booking, error } = await startSpan(
        {
          name: "supabase.get_booking",
          op: "db.query",
          attributes: {
            "db.operation": "select",
            "db.table": "bookings",
          },
        },
        async (dbSpan) => {
          const supabase = createAdminClient();
          const { data, error: queryError } = await supabase
            .from("bookings")
            .select(
              "access_token, room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, status, created_at, guest_contacts(email)",
            )
            .eq("stripe_session_id", sessionId)
            .in("status", ["pending", "confirmed"])
            .single();

          dbSpan?.setAttribute("db.found", !!data && !queryError);
          return { booking: data, error: queryError };
        },
      );

      if (!error && booking) {
        parentSpan?.setAttribute("booking.status", booking.status);

        // If still pending, verify with Stripe
        if (booking.status === "pending") {
          const verified = await startSpan(
            {
              name: "stripe.verify_payment",
              op: "payment.stripe",
              attributes: { "stripe.operation": "retrieve_session" },
            },
            async (stripeSpan) => {
              try {
                const session = await stripe.checkout.sessions.retrieve(sessionId);
                stripeSpan?.setAttribute("stripe.paymentStatus", session.payment_status);

                if (session.payment_status === "paid") {
                  // Payment succeeded but webhook didn't update - recover
                  const supabase = createAdminClient();
                  const { error: updateError } = await supabase
                    .from("bookings")
                    .update({ status: "confirmed" })
                    .eq("stripe_session_id", sessionId)
                    .eq("status", "pending");

                  if (updateError) {
                    stripeSpan?.setStatus({
                      code: 2,
                      message: "Update failed",
                    });
                    return {
                      success: false,
                      error: "Failed to confirm booking",
                    };
                  }

                  // Webhook-driven invalidation (api/webhook/stripe/route.ts)
                  // never runs on this recovery path, so the cached
                  // availability snapshot would otherwise stay stale until
                  // it expires on its own (cacheLife("hours")) — invalidate
                  // it here too, same tag/shape as the webhook and the
                  // dates_unavailable path in booking/[type]/actions.ts.
                  revalidateTag(`availability-${booking.room_type}`, { expire: 0 });

                  addBreadcrumb({
                    category: "booking",
                    message: "Recovered pending booking to confirmed",
                    data: { sessionId },
                  });
                  booking.status = "confirmed";
                  return { success: true };
                } else {
                  return {
                    success: false,
                    error: "Payment not completed",
                    status: 402,
                  };
                }
              } catch {
                stripeSpan?.setStatus({ code: 2, message: "Stripe error" });
                return {
                  success: false,
                  error: "Unable to verify payment status",
                };
              }
            },
          );

          if (!verified.success) {
            return NextResponse.json({ error: verified.error }, { status: verified.status || 500 });
          }
        }

        return NextResponse.json({ booking: flattenGuestEmail(booking) });
      }

      // Fallback to Stripe
      parentSpan?.setAttribute("booking.fallback", "stripe");

      return startSpan(
        {
          name: "stripe.fallback_lookup",
          op: "payment.stripe",
          attributes: { "stripe.operation": "retrieve_session_fallback" },
        },
        async (stripeSpan) => {
          try {
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status !== "paid") {
              stripeSpan?.setStatus({ code: 2, message: "Not paid" });
              return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
            }

            const metadata = session.metadata;
            if (!metadata) {
              stripeSpan?.setStatus({ code: 2, message: "No metadata" });
              return NextResponse.json({ error: "Booking not found" }, { status: 404 });
            }

            stripeSpan?.setAttribute("booking.roomType", metadata.roomType);

            // Payment confirmed but no booking in DB - resolve the guest's
            // contact row first (guest_contact_id is NOT NULL on bookings,
            // see 20260821160000_link_bookings_to_guest_contacts.sql) then
            // create the confirmed booking.
            const guestContactId = await upsertGuestContact({
              phone: metadata.phone,
              email: metadata.email,
              guestName: metadata.guestName ?? "Guest",
              whatsappOptIn: metadata.whatsappOptIn === "true",
              roomType: metadata.roomType,
              checkIn: metadata.checkIn,
              checkOut: metadata.checkOut,
              funnelStage: "booked",
            });

            const bookingData = {
              room_type: metadata.roomType,
              check_in: metadata.checkIn,
              check_out: metadata.checkOut,
              nights: parseInt(metadata.nights, 10),
              person_count: parseInt(metadata.personCount, 10),
              base_price: parseFloat(metadata.basePrice),
              tourist_tax: parseFloat(metadata.touristTax),
              total_amount: parseFloat(metadata.total),
              guest_contact_id: guestContactId,
              stripe_session_id: sessionId,
              status: "confirmed",
            };

            const supabase = createAdminClient();
            const { data: newBooking, error: insertError } = await supabase
              .from("bookings")
              .insert(bookingData)
              .select(
                "access_token, room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, status, created_at, guest_contacts(email)",
              )
              .single();

            if (insertError) {
              // Insert failed - return data from Stripe anyway
              const { guest_contact_id: _guestContactId, ...bookingDataWithoutContactId } =
                bookingData;
              return NextResponse.json({
                booking: {
                  ...bookingDataWithoutContactId,
                  email: metadata.email,
                  status: "confirmed",
                },
              });
            }

            return NextResponse.json({ booking: flattenGuestEmail(newBooking) });
          } catch {
            stripeSpan?.setStatus({ code: 2, message: "Not found" });
            return NextResponse.json({ error: "Booking not found" }, { status: 404 });
          }
        },
      );
    },
  );
}
