"use client";

import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useActionState, useCallback, useMemo, useState } from "react";
import { toCalendarDay } from "@/lib/date-utils";
import { calculateTotalPrice, formatPrice } from "@/lib/price-utils";
import { ROOM_PRICING } from "pricing";
import { addBookingBreadcrumb } from "@/lib/sentry-booking";
import { COUNTRY_CODES, splitPhoneNumber } from "@/lib/shared/country-codes";
import type { DateRange } from "@/lib/shared/types/booking";
import type { BookingFormState } from "../actions";
import { submitBooking } from "../actions";
import { BookingCalendar } from "./BookingCalendar";

type BookingEngineExpandedProps = {
  blockedDates: DateRange[];
  checkInDate: Date | null;
  checkOutDate: Date | null;
  onDateSelect: (date: Date) => void;
  onClose: () => void;
  roomType: "room1" | "room2";
  error: string | null;
  updateAvailability: (blockedDates: DateRange[]) => void;
};

export function BookingEngineExpanded({
  blockedDates,
  checkInDate,
  checkOutDate,
  onDateSelect,
  onClose,
  roomType,
  error,
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
  // initialPhone arrives pre-combined as E.164 — split back into a country
  // selection + local digits to match the two-part UI below.
  const { countryId: initialCountryId, localNumber: initialLocalNumber } = useMemo(
    () => splitPhoneNumber(initialPhone),
    [initialPhone],
  );

  const [personCount, setPersonCount] = useState(1);

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

  const decrementPersonCount = () => {
    if (personCount > 1) {
      setPersonCount(personCount - 1);
    }
  };

  const incrementPersonCount = () => {
    if (personCount < 2) {
      setPersonCount(personCount + 1);
    }
  };

  const bookingError = dismissedAtAttempt === state.attempt ? null : state.generalError || null;

  return (
    <div className="booking-engine-expanded">
      <div className="booking-summary-row">
        <div className="booking-summary-left">
          <div className="booking-summary-item">
            night(s): <span className="font-bold">{pricing ? pricing.nights : "--"}</span>
          </div>
          <div className="booking-summary-item booking-summary-persons">
            <span>person(s):</span>
            <button
              type="button"
              onClick={decrementPersonCount}
              disabled={personCount <= 1}
              className="booking-person-button"
              aria-label="Decrease number of persons"
            >
              −
            </button>
            <span className="booking-person-count font-bold">{personCount}</span>
            <button
              type="button"
              onClick={incrementPersonCount}
              disabled={personCount >= 2}
              className="booking-person-button"
              aria-label="Increase number of persons"
            >
              +
            </button>
          </div>
        </div>
        <div className="booking-summary-right">
          <span className="booking-summary-total font-bold text-lg">
            Total: {pricing ? formatPrice(pricing.total) : "--€"}
          </span>
          <span className="booking-summary-tax">
            Tourist tax: {pricing ? formatPrice(pricing.touristTax) : "--€"}*
          </span>
        </div>
      </div>

      <BookingCalendar
        blockedDates={blockedDates}
        selectedCheckIn={checkInDate}
        selectedCheckOut={checkOutDate}
        onDateSelect={handleDateSelect}
      />

      {/*
        `action={formAction}` is the only submission path (no onSubmit).
        formAction wraps submitBooking with client-only follow-up work —
        submitBooking is still authoritative for all validation. required/
        type="email" below are UX only, not a no-JS guarantee: the calendar
        above already needs JS.
      */}
      <form action={formAction}>
        <div className="booking-name-field">
          <label htmlFor="booking-name" className="booking-name-label">
            Name<span className="text-red-500">*</span>
          </label>
          <input
            key={`guestName-${state.attempt}`}
            id="booking-name"
            name="guestName"
            type="text"
            defaultValue={state.values.guestName}
            placeholder="Your name"
            required
            maxLength={100}
            className={`booking-name-input ${state.errors.guestName ? "border-red-500" : ""}`}
            aria-required="true"
            aria-invalid={!!state.errors.guestName}
            aria-describedby={state.errors.guestName ? "name-error" : undefined}
            disabled={isPending}
          />
          {state.errors.guestName && (
            <span id="name-error" className="text-red-500 text-xs mt-1">
              {state.errors.guestName}
            </span>
          )}
        </div>

        <div className="booking-email-field">
          <label htmlFor="booking-email" className="booking-email-label">
            Email<span className="text-red-500">*</span>
          </label>
          <input
            key={`email-${state.attempt}`}
            id="booking-email"
            name="email"
            type="email"
            defaultValue={state.values.email}
            placeholder="your@email.com"
            required
            className={`booking-email-input ${state.errors.email ? "border-red-500" : ""}`}
            aria-required="true"
            aria-invalid={!!state.errors.email}
            aria-describedby={state.errors.email ? "email-error" : undefined}
            disabled={isPending}
          />
          {state.errors.email && (
            <span id="email-error" className="text-red-500 text-xs mt-1">
              {state.errors.email}
            </span>
          )}
        </div>

        {/* Country code + local number combine into E.164 server-side */}
        <div className="booking-phone-field">
          <label htmlFor="booking-phone-number" className="booking-phone-label">
            WhatsApp number<span className="text-red-500">*</span>
          </label>
          <div className="booking-phone-input-group">
            <select
              key={`countryId-${state.attempt}`}
              id="booking-phone-country"
              name="countryId"
              defaultValue={state.values.countryId}
              className="booking-phone-country-select"
              aria-label="Country code"
              disabled={isPending}
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.flag} {c.code} {c.country}
                </option>
              ))}
            </select>
            <input
              key={`localNumber-${state.attempt}`}
              id="booking-phone-number"
              name="localNumber"
              type="tel"
              defaultValue={state.values.localNumber}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                if (digits !== e.target.value) e.target.value = digits;
              }}
              placeholder="920 742 845"
              required
              pattern="\d{4,14}"
              className={`booking-phone-input ${state.errors.localNumber ? "border-red-500" : ""}`}
              aria-required="true"
              aria-invalid={!!state.errors.localNumber}
              aria-describedby={state.errors.localNumber ? "phone-error" : undefined}
              disabled={isPending}
            />
          </div>
          {state.errors.localNumber && (
            <span id="phone-error" className="text-red-500 text-xs mt-1">
              {state.errors.localNumber}
            </span>
          )}
          <label htmlFor="booking-whatsapp-optin" className="booking-whatsapp-optin-label">
            <input
              key={`whatsappOptIn-${state.attempt}`}
              id="booking-whatsapp-optin"
              name="whatsappOptIn"
              type="checkbox"
              // Unchecked by default: this is a marketing consent checkbox, and
              // GDPR (CJEU Planet49) plus Portugal's ePrivacy law (Lei
              // 41/2004) require an affirmative opt-in, not a pre-ticked box.
              defaultChecked={state.values.whatsappOptIn}
              disabled={isPending}
            />
            Send me property updates and promotions via WhatsApp
          </label>
        </div>

        <input type="hidden" name="personCount" value={personCount} readOnly />

        {(error || bookingError) && (
          <p className="text-red-500 text-sm mb-4" role="alert" aria-live="polite">
            {error || bookingError}
          </p>
        )}

        <div className="booking-action-buttons">
          <button
            type="button"
            onClick={onClose}
            className="booking-close-button"
            aria-label="Close booking calendar"
            disabled={isPending}
          >
            close
          </button>
          <button
            type="submit"
            className="booking-book-button-expanded"
            disabled={isPending}
            aria-label="Confirm booking"
            aria-busy={isPending}
          >
            {isPending ? "booking..." : "book"}
          </button>
        </div>
      </form>

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
