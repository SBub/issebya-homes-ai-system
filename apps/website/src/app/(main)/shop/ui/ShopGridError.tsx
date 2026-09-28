import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

// No "use client": only ShopGridBoundary renders this, so it already runs on the client there.
export function ShopGridError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="py-16 text-center text-sm text-background">
      <p>
        The shop did not load. Please try again in a moment, or reach us on <WhatsAppLink />.
      </p>
      <button type="button" onClick={onRetry} className="mt-4 underline">
        Try again
      </button>
    </div>
  );
}
