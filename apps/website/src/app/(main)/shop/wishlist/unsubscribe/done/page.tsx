import type { Metadata } from "next";
import { WISHLIST_UNSUBSCRIBED_COPY } from "@/lib/shop/wishlist";
import { UnsubscribeMessage } from "../ui/UnsubscribeMessage";

export const metadata: Metadata = {
  title: "Unsubscribed – Issebya Homes",
  robots: { index: false, follow: false },
};

export default function UnsubscribedPage() {
  return <UnsubscribeMessage copy={WISHLIST_UNSUBSCRIBED_COPY} />;
}
