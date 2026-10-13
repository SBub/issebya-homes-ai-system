import { LOCKIN_UNSUBSCRIBE_INVALID_COPY } from "@/lib/lockin-waitlist/copy";
import { UnsubscribeMessage } from "../_components/UnsubscribeMessage";

export default function LockinInvalidUnsubscribeNotFound() {
  return <UnsubscribeMessage copy={LOCKIN_UNSUBSCRIBE_INVALID_COPY} />;
}
