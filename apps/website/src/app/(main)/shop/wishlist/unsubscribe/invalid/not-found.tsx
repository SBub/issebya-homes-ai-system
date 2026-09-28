import { WISHLIST_UNSUBSCRIBE_INVALID_COPY } from "@/lib/shop/wishlist";
import { UnsubscribeMessage } from "../ui/UnsubscribeMessage";

export default function InvalidUnsubscribeNotFound() {
  return <UnsubscribeMessage copy={WISHLIST_UNSUBSCRIBE_INVALID_COPY} />;
}
