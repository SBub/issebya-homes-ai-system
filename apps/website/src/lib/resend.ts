import { Resend } from "resend";
import { BookingConfirmationEmail } from "@/app/emails/BookingConfirmationEmail";
import { BookingNotificationEmail } from "@/app/emails/BookingNotificationEmail";

type BookingEmailData = {
  stripe_session_id: string;
  room_type: string;
  check_in: string;
  check_out: string;
  nights: number;
  person_count: number;
  base_price: number;
  tourist_tax: number;
  total_amount: number;
  email: string;
};

function formatRoomType(roomType: string): string {
  return roomType === "room1" ? "Room 1" : "Room 2";
}

export async function sendBookingConfirmationEmail(
  booking: BookingEmailData,
  origin: string,
): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!fromEmail) {
    throw new Error("Missing environment variable: RESEND_FROM_EMAIL");
  }

  const confirmationUrl = `${origin}/booking/confirmation?session=${booking.stripe_session_id}`;
  const roomLabel = formatRoomType(booking.room_type);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: booking.email,
    subject: "Booking Confirmed – issebya.homes",
    react: BookingConfirmationEmail({
      roomLabel,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      nights: booking.nights,
      personCount: booking.person_count,
      basePrice: booking.base_price,
      touristTax: booking.tourist_tax,
      totalAmount: booking.total_amount,
      confirmationUrl,
    }),
  });
}

export async function sendBookingNotificationEmail(booking: BookingEmailData): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;

  if (!adminEmail) {
    // Skip silently if admin email not configured
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!fromEmail) {
    throw new Error("Missing environment variable: RESEND_FROM_EMAIL");
  }

  const roomLabel = formatRoomType(booking.room_type);

  await resend.emails.send({
    from: fromEmail,
    to: adminEmail,
    subject: "New Booking Received – issebya.homes",
    react: BookingNotificationEmail({
      customerEmail: booking.email,
      roomLabel,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      nights: booking.nights,
      personCount: booking.person_count,
      basePrice: booking.base_price,
      touristTax: booking.tourist_tax,
      totalAmount: booking.total_amount,
    }),
  });
}
