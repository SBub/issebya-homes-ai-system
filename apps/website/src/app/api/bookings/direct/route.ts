import { addBreadcrumb, setTag, startSpan } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/shared/supabase";
import { stripe } from "@/lib/stripe";

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
              "access_token, room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, email, status, created_at",
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

        return NextResponse.json({ booking });
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

            // Payment confirmed but no booking in DB - create confirmed booking
            const bookingData = {
              room_type: metadata.roomType,
              check_in: metadata.checkIn,
              check_out: metadata.checkOut,
              nights: parseInt(metadata.nights, 10),
              person_count: parseInt(metadata.personCount, 10),
              base_price: parseFloat(metadata.basePrice),
              tourist_tax: parseFloat(metadata.touristTax),
              total_amount: parseFloat(metadata.total),
              email: metadata.email,
              stripe_session_id: sessionId,
              status: "confirmed",
            };

            const supabase = createAdminClient();
            const { data: newBooking, error: insertError } = await supabase
              .from("bookings")
              .insert(bookingData)
              .select(
                "access_token, room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, email, status, created_at",
              )
              .single();

            if (insertError) {
              // Insert failed - return data from Stripe anyway
              return NextResponse.json({
                booking: { ...bookingData, status: "confirmed" },
              });
            }

            return NextResponse.json({ booking: newBooking });
          } catch {
            stripeSpan?.setStatus({ code: 2, message: "Not found" });
            return NextResponse.json({ error: "Booking not found" }, { status: 404 });
          }
        },
      );
    },
  );
}
