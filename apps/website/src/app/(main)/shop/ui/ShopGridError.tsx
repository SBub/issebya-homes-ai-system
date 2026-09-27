import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

/**
 * What the Products section shows when the grid's first page cannot load.
 *
 * Rendered only by `ShopGridBoundary`, a Client Component, so it runs on the
 * client as part of that module graph and needs no directive of its own.
 */
export function ShopGridError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="text-center text-sm text-background">
      <p>
        The shop did not load. Please try again in a moment, or reach us on <WhatsAppLink />.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 border border-background px-6 py-2 text-sm text-background"
      >
        Try again
      </button>
    </div>
  );
}
