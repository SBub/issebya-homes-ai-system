import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Unsubscribe – Issebya Homes",
  robots: { index: false, follow: false },
};

// Always a 404: renders `not-found.tsx` beside it, and nothing streams first,
// so the status is real.
export default function InvalidUnsubscribePage() {
  notFound();
}
