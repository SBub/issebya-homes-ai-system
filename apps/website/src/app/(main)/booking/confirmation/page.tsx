import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingConfirmationContent } from "./ui/BookingConfirmationContent";

export const metadata: Metadata = {
  title: "Booking Confirmed – Issebya Homes",
};

export default function BookingConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  return (
    <div className="container mx-auto px-4 py-8">
      <Suspense fallback={<div className="text-sm text-gray-500">Loading your booking...</div>}>
        <BookingConfirmationContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
