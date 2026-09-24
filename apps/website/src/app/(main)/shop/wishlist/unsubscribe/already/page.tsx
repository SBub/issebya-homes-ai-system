import type { Metadata } from "next";
import { WISHLIST_ALREADY_UNSUBSCRIBED_COPY } from "@/lib/shop/wishlist";
import { UnsubscribeMessage } from "../ui/UnsubscribeMessage";

export const metadata: Metadata = {
  title: "Already unsubscribed – Issebya Homes",
  robots: { index: false, follow: false },
};

export default function AlreadyUnsubscribedPage() {
  return <UnsubscribeMessage copy={WISHLIST_ALREADY_UNSUBSCRIBED_COPY} />;
}
