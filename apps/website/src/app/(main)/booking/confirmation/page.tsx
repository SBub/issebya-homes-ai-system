import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveBlogReturn } from "@/lib/blog/return-path";
import { fromCalendarDay } from "@/lib/date-utils";

export const metadata: Metadata = {
  title: "Booking Confirmed – Issebya Homes",
};

type BookingData = {
  access_token: string;
  room_type: string;
  check_in: string;
  check_out: string;
  nights: number;
  person_count: number;
  base_price: number;
  tourist_tax: number;
  total_amount: number;
  email: string;
  status: string;
  created_at: string;
};

const roomImages: Record<string, string> = {
  room1: "/bed.webp",
  room2: "/bed_bedroom2.webp",
};

const roomLabels: Record<string, string> = {
  room1: "Room 1",
  room2: "Room 2",
};

function formatDate(dateString: string): string {
  // A stored calendar day ("yyyy-MM-dd"), not an instant: parse it at local
  // midnight so the guest is shown the day they picked, whatever timezone
  // this renders in.
  return fromCalendarDay(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BookingConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; return?: string }>;
}) {
  // `return` is a reserved word, hence the alias. It came back through Stripe
  // and anyone can type it by hand, so it is revalidated here from scratch
  // rather than trusted because submitBooking already checked it once.
  const { session, return: returnParam } = await searchParams;

  if (!session) {
    notFound();
  }

  // Resolved off the in-process post registry, so the link costs no fetch and
  // cannot delay or gate the booking lookup below.
  const blogReturn = resolveBlogReturn(returnParam);

  const headersList = await headers();
  const host = headersList.get("host") || "localhost:3000";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";

  const res = await fetch(
    `${protocol}://${host}/api/bookings/direct?session=${encodeURIComponent(session)}`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    notFound();
  }

  const data = await res.json();
  const booking: BookingData = data.booking;

  const imageSrc = roomImages[booking.room_type] ?? "/bed.webp";
  const roomLabel = roomLabels[booking.room_type] ?? booking.room_type;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Left - Booking Details */}
        <div className="md:w-1/2">
          <div className="mb-6 text-center md:text-left">
            <h1 className="text-price mb-1">Booking Confirmed</h1>
            <p className="text-secondary">Thank you for your reservation</p>
          </div>

          <div className="space-y-4">
            <div className="border-b border-gray-300 pb-3">
              <label className="text-secondary block mb-1">Room</label>
              <p className="text-secondary">{roomLabel}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border-b border-gray-300 pb-3">
                <label className="text-secondary block mb-1">Check-in</label>
                <p className="text-secondary">{formatDate(booking.check_in)}</p>
              </div>
              <div className="border-b border-gray-300 pb-3">
                <label className="text-secondary block mb-1">Check-out</label>
                <p className="text-secondary">{formatDate(booking.check_out)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border-b border-gray-300 pb-3">
                <label className="text-secondary block mb-1">Nights</label>
                <p className="text-secondary">{booking.nights}</p>
              </div>
              <div className="border-b border-gray-300 pb-3">
                <label className="text-secondary block mb-1">Guests</label>
                <p className="text-secondary">
                  {booking.person_count} {booking.person_count === 1 ? "Guest" : "Guests"}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-secondary">
                <span>Room price</span>
                <span>€{booking.base_price}</span>
              </div>
              <div className="flex justify-between text-secondary">
                <span>Tourist tax</span>
                <span>€{booking.tourist_tax}</span>
              </div>
              <div className="flex justify-between text-price border-t border-gray-300 pt-2">
                <span>Total</span>
                <span>€{booking.total_amount}</span>
              </div>
            </div>

            <div className="pt-4 text-secondary">
              A confirmation email has been sent to{" "}
              <span className="font-bold">{booking.email}</span>
            </div>

            <p className="text-secondary">
              48 hours before your arrival, we&apos;ll send you the exact address, parking details,
              and all essential information for your stay.
            </p>

            {/* `block` so the surrounding space-y-4 rhythm applies: vertical
                margin does nothing to an inline <a>. */}
            {blogReturn && (
              <Link
                href={blogReturn.href}
                data-testid="return-to-post"
                className="block text-secondary-link"
              >
                ← back to {blogReturn.title}
              </Link>
            )}
          </div>
        </div>

        {/* Right - Image (hidden on mobile) */}
        <div className="hidden md:flex md:w-1/2 items-center justify-center">
          <div className="relative w-[70%] min-h-[400px]">
            <Image src={imageSrc} alt={roomLabel} fill className="object-cover" />
          </div>
        </div>
      </div>
    </div>
  );
}
