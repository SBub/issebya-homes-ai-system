import { addBreadcrumb, captureException, setContext, setTag, startSpan } from "@sentry/nextjs";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { sendBookingConfirmationEmail, sendBookingNotificationEmail } from "@/lib/resend";
import { upsertGuestContact } from "@/lib/shared/guest-contacts";
import { createAdminClient } from "@/lib/shared/supabase";
import { stripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sig = request.headers.get("stripe-signature");

  return startSpan(
    {
      name: "api.webhook.stripe",
      op: "http.server",
      attributes: { "http.route": "/api/webhook/stripe" },
    },
    async (parentSpan) => {
      if (!sig) {
        parentSpan?.setStatus({ code: 2, message: "Missing signature" });
        return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
      } catch (err) {
        parentSpan?.setStatus({ code: 2, message: "Invalid signature" });
        captureException(err, {
          tags: {
            "webhook.type": "stripe",
            "webhook.error": "signature_verification",
          },
        });
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }

      parentSpan?.setAttribute("stripe.eventType", event.type);
      parentSpan?.setAttribute("stripe.eventId", event.id);

      addBreadcrumb({
        category: "webhook",
        message: `Stripe webhook received: ${event.type}`,
        data: { eventId: event.id },
      });

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = session.metadata;
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        parentSpan?.setAttribute("stripe.sessionId", session.id);
        setTag("booking.sessionId", session.id);

        if (!metadata) {
          addBreadcrumb({
            category: "webhook",
            message: "Missing metadata on session",
            level: "error",
          });
          return NextResponse.json({ received: true });
        }

        const {
          roomType,
          checkIn,
          checkOut,
          personCount,
          email,
          nights,
          basePrice,
          touristTax,
          total,
          guestName,
          phone,
          whatsappOptIn,
          source,
        } = metadata;

        if (!roomType || !checkIn || !checkOut || !personCount || !email || !phone || !guestName) {
          addBreadcrumb({
            category: "webhook",
            message: "Incomplete metadata on session",
            level: "error",
          });
          return NextResponse.json({ received: true });
        }

        // Set full booking context
        setContext("booking", {
          roomType,
          checkIn,
          checkOut,
          personCount,
          email,
          stripeSessionId: session.id,
        });

        // Upsert guest_contacts and refresh it to reflect this confirmed
        // stay (funnel_stage/stay dates) — same call covers both the
        // already-linked pending-booking-confirm path (this just refreshes
        // the existing row) and the fallback-insert path below (which
        // needs a fresh guest_contact_id, since no pending row exists to
        // have one already). Not wrapped in try/catch: a failure here means
        // bookings.guest_contact_id (NOT NULL) can't be satisfied either
        // way, so let it throw and surface as a 500 — Stripe retries on
        // non-2xx, same as the existing insertError.throw below.
        const guestContactId = await upsertGuestContact({
          phone,
          email,
          guestName,
          whatsappOptIn: whatsappOptIn === "true",
          roomType,
          checkIn,
          checkOut,
          funnelStage: "booked",
        });

        // Update booking status with child span
        const booking = await startSpan(
          {
            name: "supabase.confirm_booking",
            op: "db.query",
            attributes: {
              "db.operation": "update",
              "db.table": "bookings",
              "booking.stripeSessionId": session.id,
            },
          },
          async (dbSpan) => {
            const supabase = createAdminClient();

            // First try to update existing pending booking
            const { data: updatedBooking, error: updateError } = await supabase
              .from("bookings")
              .update({
                status: "confirmed",
                payment_intent: paymentIntentId,
              })
              .eq("stripe_session_id", session.id)
              .eq("status", "pending")
              .select("access_token")
              .single();

            if (!updateError && updatedBooking) {
              dbSpan?.setAttribute("booking.confirmed", true);
              return updatedBooking;
            }

            dbSpan?.setAttribute("db.fallback", "insert");

            // No pending booking found - create one
            const { data: insertedBooking, error: insertError } = await supabase
              .from("bookings")
              .insert({
                room_type: roomType,
                check_in: checkIn,
                check_out: checkOut,
                nights: parseInt(nights, 10),
                person_count: parseInt(personCount, 10),
                base_price: parseFloat(basePrice),
                tourist_tax: parseFloat(touristTax),
                total_amount: parseFloat(total),
                guest_contact_id: guestContactId,
                source: source || "direct",
                stripe_session_id: session.id,
                payment_intent: paymentIntentId,
                status: "confirmed",
              })
              .select("access_token")
              .single();

            if (insertError) {
              if (insertError.code === "23505") {
                dbSpan?.setAttribute("db.duplicate", true);
                return null; // Duplicate session
              }
              dbSpan?.setStatus({ code: 2, message: "Database error" });
              throw insertError;
            }

            return insertedBooking;
          },
        );

        if (booking) {
          // The just-confirmed booking's dates are no longer available —
          // invalidate the cached availability so the next read reflects
          // this booking instead of serving the stale pre-confirmation
          // snapshot (up to `cacheLife("hours")` old otherwise). Mirrors
          // the same call in booking/[type]/actions.ts's dates-unavailable
          // path.
          revalidateTag(`availability-${roomType}`, { expire: 0 });

          const origin = new URL(request.url).origin;
          const bookingEmailData = {
            stripe_session_id: session.id,
            room_type: roomType,
            check_in: checkIn,
            check_out: checkOut,
            nights: parseInt(nights, 10),
            person_count: parseInt(personCount, 10),
            base_price: parseFloat(basePrice),
            tourist_tax: parseFloat(touristTax),
            total_amount: parseFloat(total),
            email,
          };

          // Send confirmation email to customer
          await startSpan(
            {
              name: "email.send_confirmation",
              op: "email.send",
              attributes: {
                "email.provider": "resend",
                "booking.roomType": roomType,
              },
            },
            async (emailSpan) => {
              try {
                await sendBookingConfirmationEmail(bookingEmailData, origin);
                emailSpan?.setAttribute("email.sent", true);
              } catch (emailError) {
                emailSpan?.setStatus({ code: 2, message: "Email send failed" });
                captureException(emailError, {
                  tags: { "email.type": "booking_confirmation" },
                });
              }
            },
          );

          // Send notification email to admin
          await startSpan(
            {
              name: "email.send_admin_notification",
              op: "email.send",
              attributes: {
                "email.provider": "resend",
                "booking.roomType": roomType,
              },
            },
            async (emailSpan) => {
              try {
                await sendBookingNotificationEmail(bookingEmailData);
                emailSpan?.setAttribute("email.sent", true);
              } catch (emailError) {
                emailSpan?.setStatus({
                  code: 2,
                  message: "Admin notification failed",
                });
                captureException(emailError, {
                  tags: { "email.type": "admin_notification" },
                });
              }
            },
          );

          // guest_contacts was already upserted earlier in this handler
          // (guestContactId) — no separate best-effort write needed here.
        }
      }

      return NextResponse.json({ received: true });
    },
  );
}
