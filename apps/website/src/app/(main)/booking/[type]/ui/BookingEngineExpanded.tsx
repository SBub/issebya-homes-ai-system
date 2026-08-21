"use client";

import { startSpan } from "@sentry/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { trackBookButtonClicked } from "@/lib/analytics";
import { mergeDateRanges } from "@/lib/date-utils";
import { calculateTotalPrice, formatPrice } from "@/lib/price-utils";
import { ROOM_PRICING } from "@/lib/pricing";
import { addBookingBreadcrumb, captureBookingError, setBookingContext } from "@/lib/sentry-booking";
import type { DateRange } from "@/lib/shared/types/booking";
import { BookingCalendar } from "./BookingCalendar";

const emailSchema = z.string().email("Please enter a valid email address");

type BookingEngineExpandedProps = {
  blockedDates: DateRange[];
  checkInDate: Date | null;
  checkOutDate: Date | null;
  onDateSelect: (date: Date) => void;
  onClose: () => void;
  roomType: "room1" | "room2";
  error: string | null;
};

export function BookingEngineExpanded({
  blockedDates,
  checkInDate,
  checkOutDate,
  onDateSelect,
  onClose,
  roomType,
  error,
}: BookingEngineExpandedProps) {
  const queryClient = useQueryClient();
  const [personCount, setPersonCount] = useState(1);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const handleDateSelect = useCallback(
    (date: Date) => {
      setBookingError(null);
      onDateSelect(date);
    },
    [onDateSelect],
  );

  const validateEmail = useCallback((value: string): boolean => {
    const result = emailSchema.safeParse(value);
    if (result.success) {
      setEmailError(null);
      return true;
    }
    setEmailError(result.error.issues[0].message);
    return false;
  }, []);

  // Calculate pricing when dates are selected
  const pricing = useMemo(() => {
    if (checkInDate && checkOutDate) {
      return calculateTotalPrice(checkInDate, checkOutDate, personCount);
    }
    return null;
  }, [checkInDate, checkOutDate, personCount]);

  // Handle book action
  const handleBook = useCallback(async () => {
    if (!checkInDate || !checkOutDate || !email) return;
    if (!validateEmail(email)) return;

    trackBookButtonClicked();

    const bookingContext = {
      roomType,
      checkIn: format(checkInDate, "yyyy-MM-dd"),
      checkOut: format(checkOutDate, "yyyy-MM-dd"),
      personCount,
      email,
    };

    // Update Sentry context before the critical operation
    setBookingContext(bookingContext);
    addBookingBreadcrumb("User initiated booking", bookingContext);

    setIsBooking(true);
    setBookingError(null);

    try {
      const data = await startSpan(
        {
          name: "booking.create_checkout",
          op: "http.client",
          attributes: {
            "booking.roomType": roomType,
            "booking.nights": pricing?.nights || 0,
            "booking.totalAmount": pricing?.total || 0,
          },
        },
        async (span) => {
          const res = await fetch("/api/checkout/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              roomType,
              checkIn: format(checkInDate, "yyyy-MM-dd"),
              checkOut: format(checkOutDate, "yyyy-MM-dd"),
              personCount,
              email,
            }),
          });
          const responseData = await res.json();

          if (!res.ok) {
            span?.setStatus({ code: 2, message: responseData.error });

            if (responseData.error === "dates_unavailable") {
              // Fetch fresh availability (bypass server cache) and update the query cache
              const freshResponse = await fetch(`/api/availability?room=${roomType}&fresh=true`);
              if (freshResponse.ok) {
                const freshData = await freshResponse.json();
                const rawBookings = freshData.bookings.map(
                  (range: { start: string; end: string }) => ({
                    start: new Date(range.start),
                    end: new Date(range.end),
                  }),
                );
                const blockedDates = mergeDateRanges(rawBookings);
                queryClient.setQueryData(["availability", roomType], {
                  blockedDates,
                  checkInDate: null,
                  checkOutDate: null,
                });
              }
              throw new Error(
                "Sorry, these dates were just booked by someone else. The calendar has been refreshed. Please select new dates.",
              );
            }

            throw new Error(responseData.message || "Failed to create checkout session");
          }

          span?.setAttribute("booking.stripeSessionUrl", responseData.url ? "present" : "missing");
          addBookingBreadcrumb("Checkout session created", {
            hasUrl: !!responseData.url,
          });

          return responseData;
        },
      );

      addBookingBreadcrumb("Redirecting to Stripe checkout", { roomType });
      window.location.href = data.url;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Something went wrong");
      captureBookingError(error, bookingContext, {
        step: "checkout_creation",
        pricing,
      });
      setBookingError(error.message);
    } finally {
      setIsBooking(false);
    }
  }, [
    checkInDate,
    checkOutDate,
    personCount,
    email,
    roomType,
    validateEmail,
    pricing,
    queryClient,
  ]);

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

  return (
    <div className="booking-engine-expanded">
      {/* Summary row at top */}
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

      {/* Calendar */}
      <BookingCalendar
        blockedDates={blockedDates}
        selectedCheckIn={checkInDate}
        selectedCheckOut={checkOutDate}
        onDateSelect={handleDateSelect}
      />

      {/* Email input */}
      <div className="booking-email-field">
        <label htmlFor="booking-email" className="booking-email-label">
          Email<span className="text-red-500">*</span>
        </label>
        <input
          id="booking-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          onBlur={(e) => {
            if (e.target.value) validateEmail(e.target.value);
          }}
          placeholder="your@email.com"
          className={`booking-email-input ${emailError ? "border-red-500" : ""}`}
          aria-required="true"
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "email-error" : undefined}
          disabled={isBooking}
        />
        {emailError && (
          <span id="email-error" className="text-red-500 text-xs mt-1">
            {emailError}
          </span>
        )}
      </div>

      {/* Error message */}
      {(error || bookingError) && (
        <p className="text-red-500 text-sm mb-4" role="alert" aria-live="polite">
          {error || bookingError}
        </p>
      )}

      {/* Action buttons */}
      <div className="booking-action-buttons">
        <button
          type="button"
          onClick={onClose}
          className="booking-close-button"
          aria-label="Close booking calendar"
          disabled={isBooking}
        >
          close
        </button>
        <button
          type="button"
          onClick={handleBook}
          className="booking-book-button-expanded"
          disabled={!email || !!emailError || isBooking || !checkInDate || !checkOutDate}
          aria-label="Confirm booking"
          aria-busy={isBooking}
        >
          {isBooking ? "booking..." : "book"}
        </button>
      </div>

      {/* Tourist tax info */}
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
