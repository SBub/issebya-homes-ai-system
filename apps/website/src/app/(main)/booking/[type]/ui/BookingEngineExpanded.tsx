"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useActionState, useCallback, useMemo, useState } from "react";
import { toCalendarDay } from "@/lib/date-utils";
import { calculateTotalPrice } from "@/lib/price-utils";
import { ROOM_PRICING } from "pricing";
import { addBookingBreadcrumb } from "@/lib/sentry-booking";
import { splitPhoneNumber } from "@/lib/shared/country-codes";
import { blogReturnPathSchema } from "@/lib/shared/schemas/booking";
import type { DateRange } from "@/lib/shared/types/booking";
import type { BookingFormState } from "../actions";
import { submitBooking } from "../actions";
import { BookingCalendar } from "./BookingCalendar";
import { BookingGuestForm } from "./BookingGuestForm";
import { BookingSummaryRow, usePersonCount } from "./BookingSummaryRow";

type BookingEngineExpandedProps = {
  blockedDates: DateRange[];
  checkInDate: Date | null;
  checkOutDate: Date | null;
  onDateSelect: (date: Date) => void;
  onClose: () => void;
  roomType: "room1" | "room2";
  hasAvailabilityError: boolean;
  updateAvailability: (blockedDates: DateRange[]) => void;
};

export function BookingEngineExpanded({
  blockedDates,
  checkInDate,
  checkOutDate,
  onDateSelect,
  onClose,
  roomType,
  hasAvailabilityError,
  updateAvailability,
}: BookingEngineExpandedProps) {
  const searchParams = useSearchParams();
  // Prefilled from the URL when the guest arrives via a GCA WhatsApp link
  // that already collected these — never asked twice. Direct visitors have
  // no query params and get empty fields.
  const initialPhone = searchParams.get("phone") ?? "";
  const initialGuestName = searchParams.get("guestName") ?? "";
  const initialEmail = searchParams.get("email") ?? "";
  const source = searchParams.get("source") === "gca" ? "gca" : "direct";
  // The engine renders both on /booking/[type] and inline in a blog post (see
  // blog/ui/BookingWidget.tsx), and the pathname is the only thing that tells
  // the two apart. Shape-checked here only, with the same schema the action
  // uses: the client has no business importing the post registry, and this is
  // a hint anyway — the server revalidates it and checks the slug exists
  // before it reaches Stripe. On /booking/room1 this is null, so that flow is
  // unchanged.
  const pathname = usePathname();
  const returnTo = blogReturnPathSchema.safeParse(pathname).success ? pathname : null;
  // initialPhone arrives pre-combined as E.164 — split back into a country
  // selection + local digits to match the two-part UI below.
  const { countryId: initialCountryId, localNumber: initialLocalNumber } = useMemo(
    () => splitPhoneNumber(initialPhone),
    [initialPhone],
  );

  const { personCount, decrementPersonCount, incrementPersonCount } = usePersonCount();

  // Computed before runSubmitBooking below so its closure can reference it.
  const pricing = useMemo(() => {
    if (checkInDate && checkOutDate) {
      return calculateTotalPrice(checkInDate, checkOutDate, personCount);
    }
    return null;
  }, [checkInDate, checkOutDate, personCount]);

  // Runs this submission's client-only follow-up work (parent availability
  // refresh, PostHog + redirect) inline after awaiting the action, not in a
  // useEffect — an effect watching the resolved state would land a render
  // behind the action's own result.
  const runSubmitBooking = async (
    prevState: BookingFormState,
    formData: FormData,
  ): Promise<BookingFormState> => {
    // The picked dates become calendar-day labels HERE, in the browser, where
    // "local" is the guest's own calendar. Handing the server the raw `Date`s
    // instead let it re-read the guest's local midnight in its own timezone
    // (UTC on Vercel) and record the previous day for anyone ahead of UTC.
    const result = await submitBooking(
      roomType,
      checkInDate ? toCalendarDay(checkInDate) : null,
      checkOutDate ? toCalendarDay(checkOutDate) : null,
      source,
      returnTo,
      prevState,
      formData,
    );

    if (result.blockedDates) {
      updateAvailability(result.blockedDates);
    }

    if (result.success && result.url) {
      posthog.identify(result.guestContactId ?? undefined, {
        email: result.values.email,
        name: result.values.guestName,
      });
      posthog.capture("checkout_session_created", {
        room_type: roomType,
        person_count: personCount,
        stay_nights: pricing?.nights ?? 0,
        booking_source: source,
      });
      addBookingBreadcrumb("Redirecting to Stripe checkout", { roomType });
      window.location.href = result.url;
    }

    return result;
  };

  // Built inline rather than a module-level constant since it closes over
  // the useSearchParams()-derived defaults above. No memoization needed:
  // useActionState only reads this argument on the first render, like
  // useState's initializer — recomputing it on later renders is harmless.
  const [state, formAction, isPending] = useActionState(runSubmitBooking, {
    attempt: 0,
    errors: {},
    generalError: "",
    values: {
      guestName: initialGuestName,
      email: initialEmail,
      countryId: initialCountryId,
      localNumber: initialLocalNumber,
      whatsappOptIn: false,
    },
    blockedDates: null,
    success: false,
    url: null,
    guestContactId: null,
  } satisfies BookingFormState);

  // Tracks which attempt's error was dismissed (not a plain boolean), so a
  // later attempt's error shows again without needing an effect to reset it.
  const [dismissedAtAttempt, setDismissedAtAttempt] = useState(-1);

  const handleDateSelect = useCallback(
    (date: Date) => {
      setDismissedAtAttempt(state.attempt);
      onDateSelect(date);
    },
    [onDateSelect, state.attempt],
  );

  const bookingError = dismissedAtAttempt === state.attempt ? null : state.generalError || null;

  return (
    <div className="booking-engine-expanded">
      <BookingSummaryRow
        nights={pricing ? pricing.nights : null}
        personCount={personCount}
        onDecrement={decrementPersonCount}
        onIncrement={incrementPersonCount}
        total={pricing ? pricing.total : null}
        touristTax={pricing ? pricing.touristTax : null}
      />

      <BookingCalendar
        blockedDates={blockedDates}
        selectedCheckIn={checkInDate}
        selectedCheckOut={checkOutDate}
        onDateSelect={handleDateSelect}
      />

      <BookingGuestForm
        state={state}
        formAction={formAction}
        isPending={isPending}
        onClose={onClose}
        hasAvailabilityError={hasAvailabilityError}
        bookingError={bookingError}
        personCount={personCount}
      />

      <div className="booking-tourist-tax-info">
        *
        <a
          href="https://taxaturistica.sintra.pt/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline" }}
        >
          Tourist tax
        </a>
        : {ROOM_PRICING.touristTax}€ per person, charged first {ROOM_PRICING.touristTaxNights}{" "}
        nights
      </div>
    </div>
  );
}
