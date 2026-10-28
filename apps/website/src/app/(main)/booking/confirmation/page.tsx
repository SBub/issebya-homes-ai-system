import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { resolveBlogReturn } from "@/lib/blog/return-path";
import { fromCalendarDay } from "@/lib/date-utils";

export const metadata: Metadata = {
  title: "Booking confirmed - issebya.homes",
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
    <>
      {/* Details: same column, padding and rhythm as the room page's content column */}
      <div className="md:w-1/2 p-4 md:p-12 space-y-8">
        <div className="space-y-1">
          <h1 className="text-price">Booking Confirmed</h1>
          <p className="text-secondary">Thank you for your reservation</p>
        </div>

        <dl className="border-t border-foreground">
          <Field label="Room" value={roomLabel} />
          <div className="grid grid-cols-2 gap-x-6">
            <Field label="Check-in" value={formatDate(booking.check_in)} />
            <Field label="Check-out" value={formatDate(booking.check_out)} />
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <Field label="Nights" value={booking.nights} />
            <Field
              label="Guests"
              value={`${booking.person_count} ${booking.person_count === 1 ? "Guest" : "Guests"}`}
            />
          </div>
        </dl>

        <dl className="space-y-2 tabular-nums">
          <PriceRow label="Room price" amount={booking.base_price} />
          <PriceRow label="Tourist tax" amount={booking.tourist_tax} />
          <div className="flex justify-between items-baseline border-t border-foreground pt-3">
            <dt className="text-xs uppercase">Total</dt>
            <dd className="text-price">€{booking.total_amount}</dd>
          </div>
        </dl>

        <div className="space-y-4 max-w-[65ch]">
          <p className="text-secondary">
            A confirmation email has been sent to <span className="font-bold">{booking.email}</span>
          </p>
          <p className="text-secondary">
            48 hours before your arrival, we&apos;ll send you the exact address, parking details,
            and all essential information for your stay.
          </p>
          <p className="text-secondary">
            For special requests or any enquiries, please reach out to us directly on{" "}
            <WhatsAppLink />.
          </p>
          {/* `block` so the surrounding space-y rhythm applies: vertical
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

      {/* Room photo: framed and placed like the room page's gallery, hidden on
          mobile so the booking details come first */}
      <div className="hidden md:flex md:w-1/2 flex-col items-center justify-start p-4 md:pt-[88px] md:sticky md:top-0 md:h-screen">
        <div className="relative w-[60%] mx-auto aspect-[4/3]">
          <Image src={imageSrc} alt={roomLabel} fill sizes="30vw" className="object-cover" />
        </div>
        <p className="text-center my-4 px-4 text-xs uppercase">{roomLabel}</p>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-b border-gray-300 py-3">
      <dt className="text-xs uppercase mb-1">{label}</dt>
      <dd className="text-secondary font-medium">{value}</dd>
    </div>
  );
}

function PriceRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between text-secondary">
      <dt>{label}</dt>
      <dd>€{amount}</dd>
    </div>
  );
}
