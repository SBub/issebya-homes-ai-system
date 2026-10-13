"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/price-utils";

const MAX_PERSONS = 2;

/** Person count for a booking (1 to 2) with its stepper handlers. */
export function usePersonCount() {
  const [personCount, setPersonCount] = useState(1);

  const decrementPersonCount = () => {
    if (personCount > 1) {
      setPersonCount(personCount - 1);
    }
  };

  const incrementPersonCount = () => {
    if (personCount < MAX_PERSONS) {
      setPersonCount(personCount + 1);
    }
  };

  return { personCount, decrementPersonCount, incrementPersonCount };
}

type BookingSummaryRowProps = {
  nights: number | null;
  personCount: number;
  onDecrement: () => void;
  onIncrement: () => void;
  total: number | null;
  // Omitted (undefined) for a product with no tourist tax: the line is not
  // rendered at all. `null` renders the "--€" placeholder.
  touristTax?: number | null;
};

/** Nights, person stepper, total and (optionally) tourist tax. */
export function BookingSummaryRow({
  nights,
  personCount,
  onDecrement,
  onIncrement,
  total,
  touristTax,
}: BookingSummaryRowProps) {
  return (
    <div className="booking-summary-row">
      <div className="booking-summary-left">
        <div className="booking-summary-item">
          night(s): <span className="font-bold">{nights ?? "--"}</span>
        </div>
        <div className="booking-summary-item booking-summary-persons">
          <span>person(s):</span>
          <button
            type="button"
            onClick={onDecrement}
            disabled={personCount <= 1}
            className="booking-person-button"
            aria-label="Decrease number of persons"
          >
            −
          </button>
          <span className="booking-person-count font-bold">{personCount}</span>
          <button
            type="button"
            onClick={onIncrement}
            disabled={personCount >= MAX_PERSONS}
            className="booking-person-button"
            aria-label="Increase number of persons"
          >
            +
          </button>
        </div>
      </div>
      <div className="booking-summary-right">
        <span className="booking-summary-total font-bold text-lg">
          Total: {total !== null ? formatPrice(total) : "--€"}
        </span>
        {touristTax !== undefined && (
          <span className="booking-summary-tax">
            Tourist tax: {touristTax !== null ? formatPrice(touristTax) : "--€"}*
          </span>
        )}
      </div>
    </div>
  );
}
