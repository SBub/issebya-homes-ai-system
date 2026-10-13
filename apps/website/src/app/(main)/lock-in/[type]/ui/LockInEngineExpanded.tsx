"use client";

import { useActionState } from "react";
import { LOCK_IN_PRICING } from "pricing";
import type { BookingFormState } from "@/app/(main)/booking/[type]/actions";
import { submitLockIn } from "@/app/(main)/booking/[type]/actions";
import { BookingGuestForm } from "@/app/(main)/booking/[type]/ui/BookingGuestForm";
import {
  BookingSummaryRow,
  usePersonCount,
} from "@/app/(main)/booking/[type]/ui/BookingSummaryRow";
import type { LockInWeek } from "@/lib/lock-in";
import { addBookingBreadcrumb } from "@/lib/sentry-booking";
import { formatLockInRange } from "./LockInWeekGrid";

type LockInEngineExpandedProps = {
  roomType: "room1" | "room2";
  week: LockInWeek;
  hasAvailabilityError: boolean;
  onClose: () => void;
  // The week was taken between page load and submit.
  onConflict: (message: string) => void;
};

const initialState = {
  attempt: 0,
  errors: {},
  generalError: "",
  values: {
    guestName: "",
    email: "",
    countryId: "",
    localNumber: "",
    whatsappOptIn: false,
  },
  blockedDates: null,
  success: false,
  url: null,
  guestContactId: null,
} satisfies BookingFormState;

export function LockInEngineExpanded({
  roomType,
  week,
  hasAvailabilityError,
  onClose,
  onConflict,
}: LockInEngineExpandedProps) {
  const { personCount, decrementPersonCount, incrementPersonCount } = usePersonCount();

  // Client-only follow-up runs inline after the action, as in
  // BookingEngineExpanded: a conflict hands the error to the parent (which
  // marks the week booked and closes this form), success redirects to Stripe.
  const runSubmitLockIn = async (
    prevState: BookingFormState,
    formData: FormData,
  ): Promise<BookingFormState> => {
    const result = await submitLockIn(roomType, week.checkIn, week.checkOut, prevState, formData);

    if (result.blockedDates) {
      onConflict(result.generalError);
    }

    if (result.success && result.url) {
      addBookingBreadcrumb("Redirecting to Stripe checkout", { roomType });
      window.location.href = result.url;
    }

    return result;
  };

  const [state, formAction, isPending] = useActionState(runSubmitLockIn, initialState);

  return (
    <div className="booking-engine-expanded">
      <BookingSummaryRow
        nights={LOCK_IN_PRICING.nights}
        personCount={personCount}
        onDecrement={decrementPersonCount}
        onIncrement={incrementPersonCount}
        total={LOCK_IN_PRICING.weekPrice}
      />

      <p className="lock-in-selected-range">
        Lock-in week: <span className="font-bold">{formatLockInRange(week)}</span>, check-in and
        check-out on Monday
      </p>

      <BookingGuestForm
        state={state}
        formAction={formAction}
        isPending={isPending}
        onClose={onClose}
        hasAvailabilityError={hasAvailabilityError}
        bookingError={state.generalError || null}
        personCount={personCount}
      />
    </div>
  );
}
