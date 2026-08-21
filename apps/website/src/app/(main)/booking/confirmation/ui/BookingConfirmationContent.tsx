import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BookingConfirmationDetails } from "./BookingConfirmationDetails";

export async function BookingConfirmationContent({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;

  if (!session) {
    notFound();
  }

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
  const booking = data.booking;

  return <BookingConfirmationDetails booking={booking} />;
}
