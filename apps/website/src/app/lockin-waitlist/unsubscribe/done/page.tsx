import type { Metadata } from "next";
import { LOCKIN_UNSUBSCRIBED_COPY } from "@/lib/lockin-waitlist/copy";
import { UnsubscribeMessage } from "../_components/UnsubscribeMessage";

export const metadata: Metadata = {
  title: "Unsubscribed | issebya.homes",
  robots: { index: false, follow: false },
};

export default function LockinUnsubscribedPage() {
  return <UnsubscribeMessage copy={LOCKIN_UNSUBSCRIBED_COPY} />;
}
