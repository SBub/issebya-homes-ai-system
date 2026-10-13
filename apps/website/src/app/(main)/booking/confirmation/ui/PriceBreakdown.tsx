type PriceBreakdownProps = {
  basePrice: number;
  touristTax: number;
  total: number;
};

/**
 * The confirmation page's price rows. A lock-in week carries no tourist tax,
 * so the row is left out rather than shown as €0.
 */
export function PriceBreakdown({ basePrice, touristTax, total }: PriceBreakdownProps) {
  return (
    <div className="space-y-2 pt-2">
      <div className="flex justify-between text-secondary">
        <span>Room price</span>
        <span>€{basePrice}</span>
      </div>
      {touristTax !== 0 && (
        <div className="flex justify-between text-secondary">
          <span>Tourist tax</span>
          <span>€{touristTax}</span>
        </div>
      )}
      <div className="flex justify-between text-price border-t border-gray-300 pt-2">
        <span>Total</span>
        <span>€{total}</span>
      </div>
    </div>
  );
}
