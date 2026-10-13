"use client";

import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { COUNTRY_CODES } from "@/lib/shared/country-codes";
import type { BookingFormState } from "../actions";

type BookingGuestFormProps = {
  state: BookingFormState;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  onClose: () => void;
  hasAvailabilityError: boolean;
  bookingError: string | null;
  personCount: number;
};

/**
 * The guest details form both booking engines submit: name, email, WhatsApp
 * number and opt-in, the person count, the availability and submission
 * alerts, and close/book. Inputs are re-keyed by `state.attempt` so a failed
 * submission restores what the guest typed (see `BookingFormState`).
 */
export function BookingGuestForm({
  state,
  formAction,
  isPending,
  onClose,
  hasAvailabilityError,
  bookingError,
  personCount,
}: BookingGuestFormProps) {
  // `action={formAction}` is the only submission path (no onSubmit).
  // formAction wraps the engine's Server Action (submitBooking or
  // submitLockIn) with client-only follow-up work; the action is still
  // authoritative for all validation. required/type="email" below are UX
  // only, not a no-JS guarantee: the date picker above already needs JS.
  return (
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
            placeholder="912 345 678"
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
            className="booking-whatsapp-optin-input"
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

      {hasAvailabilityError && (
        <p className="text-red-500 text-sm mb-4" role="alert" aria-live="polite">
          We couldn&apos;t confirm live availability from one of our booking channels just now.
          Message us on <WhatsAppLink /> before booking to be sure.
        </p>
      )}

      {bookingError && (
        <p className="text-red-500 text-sm mb-4" role="alert" aria-live="polite">
          {bookingError}
        </p>
      )}

      <div className="booking-action-buttons">
        <button
          type="button"
          onClick={onClose}
          className="booking-close-button button-outline"
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
  );
}
