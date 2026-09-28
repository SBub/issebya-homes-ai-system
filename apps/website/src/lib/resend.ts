import { Resend } from "resend";
import { BookingConfirmationEmail } from "@/app/emails/BookingConfirmationEmail";
import { BookingNotificationEmail } from "@/app/emails/BookingNotificationEmail";
import {
  formatCents,
  SELLER_CONDITION_LABELS,
  type SellerCondition,
} from "@/lib/shop/seller-submission";
import { unsubscribeUrl } from "@/lib/shop/unsubscribe";
import { WISHLIST_EMAIL_SUBJECT, wishlistConfirmationEmailText } from "@/lib/shop/wishlist";
import { SITE_URL } from "@/lib/site";

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

type SellerSubmissionEmailData = {
  sellerName: string;
  sellerEmail: string;
  sellerPhone: string | null;
  title: string;
  makerOrBrand: string | null;
  materials: string;
  dimensions: string | null;
  condition: SellerCondition;
  askingPriceCents: number;
  description: string;
};

/**
 * Tells the owner a seller has offered a piece. Plain text on purpose: the
 * owner reads it, clicks the photo links and decides in Studio. Unlike the
 * booking helpers this checks Resend's `{ error }` and throws it, so the
 * caller's Sentry report sees a failed send instead of a silent one.
 */
export async function sendSellerSubmissionNotificationEmail(
  submission: SellerSubmissionEmailData,
  photoUrls: string[],
): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;

  if (!adminEmail) {
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!fromEmail) {
    throw new Error("Missing environment variable: RESEND_FROM_EMAIL");
  }

  const text = [
    `Seller: ${submission.sellerName}`,
    `Email: ${submission.sellerEmail}`,
    `Phone: ${submission.sellerPhone ?? "not given"}`,
    "",
    `Title: ${submission.title}`,
    `Maker or brand: ${submission.makerOrBrand ?? "not given"}`,
    `Materials: ${submission.materials}`,
    `Dimensions: ${submission.dimensions ?? "not given"}`,
    `Condition: ${SELLER_CONDITION_LABELS[submission.condition]}`,
    `Asking price: ${formatCents(submission.askingPriceCents)}`,
    "",
    "Description:",
    submission.description,
    "",
    ...photoUrls.map((url, index) => `Photo ${index + 1}: ${url}`),
    "",
    "Review in Supabase Studio → shop_seller_submissions",
  ].join("\n");

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: adminEmail,
    replyTo: submission.sellerEmail,
    subject: `New shop submission: ${submission.title}`,
    text,
  });

  if (error) {
    throw new Error(`Resend failed to send the seller submission email: ${error.message}`);
  }
}

/**
 * Tells a guest the piece they wished for is on their list. Sent only for a new
 * wish or a renewed consent, after the DB writes succeed. Plain text on
 * purpose: HTML templates are out of scope. It ends with the guest's
 * unsubscribe link, also sent as a `List-Unsubscribe` header so mail clients
 * can offer it. Replies go to the owner when `ADMIN_NOTIFICATION_EMAIL` is set.
 * Throws on a Resend `{ error }` so the caller's Sentry report sees a failed
 * send.
 */
export async function sendWishlistConfirmationEmail({
  email,
  productName,
  productSlug,
  unsubscribeToken,
}: {
  email: string;
  productName: string;
  productSlug: string;
  unsubscribeToken: string;
}): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!fromEmail) {
    throw new Error("Missing environment variable: RESEND_FROM_EMAIL");
  }

  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  const url = unsubscribeUrl(unsubscribeToken);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: email,
    ...(adminEmail ? { replyTo: adminEmail } : {}),
    subject: WISHLIST_EMAIL_SUBJECT,
    text: wishlistConfirmationEmailText({
      productName,
      productUrl: `${SITE_URL}/shop/${productSlug}`,
      unsubscribeUrl: url,
    }),
    // No List-Unsubscribe-Post: one-click POST unsubscribe is out of scope.
    headers: { "List-Unsubscribe": `<${url}>` },
  });

  if (error) {
    throw new Error(`Resend failed to send the wishlist confirmation email: ${error.message}`);
  }
}
