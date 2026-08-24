import { addBreadcrumb, captureException, setContext, setTag, startSpan } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { calculateTotalPrice } from "@/lib/price-utils";
import { checkoutSchema } from "@/lib/shared/schemas/booking";
import { createAdminClient } from "@/lib/shared/supabase";
import { formatZodErrors } from "@/lib/shared/validation";
import { stripe } from "@/lib/stripe";

const ROOM_LABELS: Record<string, string> = {
  room1: "Room 1",
  room2: "Room 2",
};

const ROOM_IMAGES: Record<string, string> = {
  room1: "/bed.webp",
  room2: "/bed_bedroom2.webp",
};

async function checkAvailability(
  roomType: string,
  checkIn: string,
  checkOut: string,
): Promise<boolean> {
  const supabase = createAdminClient();

  // Find any confirmed booking that overlaps with requested dates
  const { data: conflicts } = await supabase
    .from("bookings")
    .select("id")
    .eq("room_type", roomType)
    .eq("status", "confirmed")
    .lt("check_in", checkOut) // existing starts before requested ends
    .gt("check_out", checkIn) // existing ends after requested starts
    .limit(1);

  return !conflicts || conflicts.length === 0;
}

export async function POST(request: NextRequest) {
  return startSpan(
    {
      name: "api.checkout.create",
      op: "http.server",
      attributes: { "http.route": "/api/checkout/create" },
    },
    async (parentSpan) => {
      try {
        const body = await request.json();

        const validation = checkoutSchema.safeParse(body);
        if (!validation.success) {
          parentSpan?.setStatus({ code: 2, message: "Validation failed" });
          return NextResponse.json(
            {
              error: "Validation failed",
              errors: formatZodErrors(validation.error),
            },
            { status: 400 },
          );
        }

        const {
          roomType,
          checkIn,
          checkOut,
          personCount,
          email,
          guestName,
          phone,
          whatsappOptIn,
          source,
        } = validation.data;

        // Set booking context on span
        parentSpan?.setAttributes({
          "booking.roomType": roomType,
          "booking.checkIn": checkIn,
          "booking.checkOut": checkOut,
          "booking.personCount": personCount,
        });

        // Set Sentry context for any errors in this request
        setContext("booking", {
          roomType,
          checkIn,
          checkOut,
          personCount,
          email,
        });

        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (checkInDate < today) {
          parentSpan?.setStatus({ code: 2, message: "Check-in in past" });
          return NextResponse.json(
            { error: "Check-in date cannot be in the past" },
            { status: 400 },
          );
        }

        // Check availability before creating checkout session
        const isAvailable = await checkAvailability(roomType, checkIn, checkOut);
        if (!isAvailable) {
          parentSpan?.setStatus({ code: 2, message: "Dates unavailable" });
          return NextResponse.json(
            {
              error: "dates_unavailable",
              message: "These dates are no longer available. Please select different dates.",
            },
            { status: 409 },
          );
        }

        const { nights, basePrice, touristTax, total } = calculateTotalPrice(
          checkInDate,
          checkOutDate,
          personCount,
        );

        parentSpan?.setAttributes({
          "booking.nights": nights,
          "booking.totalAmount": total,
        });

        const origin = new URL(request.url).origin;
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

        // Create Stripe session with child span
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

        // Create pending booking with child span
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
              email,
              guest_name: guestName || null,
              phone: phone || null,
              whatsapp_opt_in: whatsappOptIn,
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

        return NextResponse.json({ url: session.url });
      } catch (error) {
        parentSpan?.setStatus({ code: 2, message: "Checkout creation failed" });
        captureException(error);
        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
      }
    },
  );
}
