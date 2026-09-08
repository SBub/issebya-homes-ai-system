"use client";

import { format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isValidDateRange } from "@/lib/date-utils";
import { addBookingBreadcrumb, setBookingContext } from "@/lib/sentry-booking";
import type { DateRange } from "@/lib/shared/types/booking";
import { BookingEngineExpanded } from "./BookingEngineExpanded";

type BookingClientProps = {
  roomType: "room1" | "room2";
  blockedDates: DateRange[];
  defaultCheckIn: Date | null;
  defaultCheckOut: Date | null;
  error: string | null;
  // Server Component passed down from BookingEngine (async Server Component)
  // via the Next.js "interleaving" pattern: it renders server-side and is
  // handed to this Client Component as already-resolved output, so it never
  // joins the client bundle.
  pricing: ReactNode;
};

// Reconciles the URL-provided ?checkIn=&checkOut= (from a GCA sendBookingLink)
// against the server-computed default first-available-nights selection. Pure
// calculation from props + searchParams — safe to run via a useState lazy
// initializer, no side effects.
function resolveInitialCheckDates(
  urlCheckIn: string | null,
  urlCheckOut: string | null,
  defaultCheckIn: Date | null,
  defaultCheckOut: Date | null,
  blockedDates: DateRange[],
): { checkIn: Date | null; checkOut: Date | null } {
  if (urlCheckIn && urlCheckOut) {
    const parsedCheckIn = parseISO(urlCheckIn);
    const parsedCheckOut = parseISO(urlCheckOut);
    if (
      !Number.isNaN(parsedCheckIn.getTime()) &&
      !Number.isNaN(parsedCheckOut.getTime()) &&
      parsedCheckOut > parsedCheckIn &&
      isValidDateRange(parsedCheckIn, parsedCheckOut, blockedDates)
    ) {
      return { checkIn: parsedCheckIn, checkOut: parsedCheckOut };
    }
  }
  return { checkIn: defaultCheckIn, checkOut: defaultCheckOut };
}

export function BookingClient({
  roomType,
  blockedDates: initialBlockedDates,
  defaultCheckIn,
  defaultCheckOut,
  error,
  pricing,
}: BookingClientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  // Prefills the guest's phone when they arrive via the GCA WhatsApp
  // sendBookingLink (which already knows their number) — never asked twice.
  // Direct website visitors have no ?phone= param and get an empty field.
  const initialPhone = searchParams.get("phone") ?? "";
  const urlCheckIn = searchParams.get("checkIn");
  const urlCheckOut = searchParams.get("checkOut");
  // Auto-expands the calendar when arriving via the GCA link (phone present)
  // so the guest sees their prefilled phone immediately, without an extra
  // click — independent of whether dates were also passed.
  // Search params are stable for the component's lifetime, so the initial
  // value is computed via a lazy initializer (no Effect needed to sync it),
  // but it stays real state so a direct visitor can still manually
  // expand/collapse via handleExpand/handleClose below.
  const [isExpanded, setIsExpanded] = useState(() => Boolean(initialPhone));

  const [blockedDates, setBlockedDates] = useState<DateRange[]>(initialBlockedDates);
  // Seeded once from the URL-provided dates (if valid) or the server-computed
  // defaults. Availability is already here via props (no client-side async
  // load), so there's no useEffect needed to "apply URL dates once loaded"
  // like the old React-Query version had.
  const [checkInDate, setCheckInDate] = useState<Date | null>(
    () =>
      resolveInitialCheckDates(
        urlCheckIn,
        urlCheckOut,
        defaultCheckIn,
        defaultCheckOut,
        initialBlockedDates,
      ).checkIn,
  );
  const [checkOutDate, setCheckOutDate] = useState<Date | null>(
    () =>
      resolveInitialCheckDates(
        urlCheckIn,
        urlCheckOut,
        defaultCheckIn,
        defaultCheckOut,
        initialBlockedDates,
      ).checkOut,
  );

  // Set initial Sentry booking context
  useEffect(() => {
    setBookingContext({ roomType });
    addBookingBreadcrumb("Booking engine initialized", { roomType });
  }, [roomType]);

  useEffect(() => {
    if (isExpanded && containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [isExpanded]);

  const validateRange = useCallback(
    (checkIn: Date, checkOut: Date): boolean => {
      return isValidDateRange(checkIn, checkOut, blockedDates);
    },
    [blockedDates],
  );

  // Handle date selection logic
  const handleDateSelect = useCallback(
    (date: Date) => {
      if (!checkInDate || (checkInDate && checkOutDate)) {
        // First click or reset: set check-in
        setCheckInDate(date);
        setCheckOutDate(null);
      } else if (checkInDate && !checkOutDate) {
        // Second click: set check-out
        if (date > checkInDate) {
          // Validate the range
          if (validateRange(checkInDate, date)) {
            setCheckOutDate(date);
            posthog.capture("booking_dates_selected", {
              room_type: roomType,
              stay_nights: Math.round((date.getTime() - checkInDate.getTime()) / 86_400_000),
            });
          } else {
            // Invalid range, reset and start over with this date as check-in
            setCheckInDate(date);
            setCheckOutDate(null);
          }
        } else {
          // Clicked date is before or same as check-in, reset
          setCheckInDate(date);
          setCheckOutDate(null);
        }
      }
    },
    [checkInDate, checkOutDate, roomType, validateRange],
  );

  // Handle expand
  const handleExpand = useCallback(() => {
    setIsExpanded(true);
    posthog.capture("booking_calendar_opened", { room_type: roomType });
    addBookingBreadcrumb("User expanded booking calendar", { roomType });
  }, [roomType]);

  // Handle close
  const handleClose = useCallback(() => {
    setIsExpanded(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Applies a freshly-fetched availability snapshot (e.g. after a
  // dates_unavailable checkout retry) and clears the now-invalid selection.
  const updateAvailability = useCallback((newBlockedDates: DateRange[]) => {
    setBlockedDates(newBlockedDates);
    setCheckInDate(null);
    setCheckOutDate(null);
  }, []);

  // Error state
  if (error && !checkInDate) {
    return (
      <div className="booking-engine-error">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="booking-engine">
      {/* Date cells always visible */}
      <div className="booking-engine-collapsed">
        <div className="booking-collapsed-main">
          <div className="booking-dates-display">
            <button
              type="button"
              onClick={handleExpand}
              className="booking-date-button"
              aria-label="Select check-in date"
            >
              <span className="booking-date-value">
                {checkInDate ? format(checkInDate, "d MMM yyyy") : "Select date"}
              </span>
            </button>

            <span className="booking-date-separator">→</span>

            <button
              type="button"
              onClick={handleExpand}
              className="booking-date-button"
              aria-label="Select check-out date"
            >
              <span className="booking-date-value">
                {checkOutDate ? format(checkOutDate, "d MMM yyyy") : "Select date"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleExpand}
              className="booking-book-button"
              aria-label="Book selected dates"
            >
              book
            </button>
          </div>
        </div>
      </div>

      {pricing}

      {/* Expanded calendar section */}
      {isExpanded && (
        <BookingEngineExpanded
          blockedDates={blockedDates}
          checkInDate={checkInDate}
          checkOutDate={checkOutDate}
          onDateSelect={handleDateSelect}
          onClose={handleClose}
          roomType={roomType}
          error={error}
          updateAvailability={updateAvailability}
        />
      )}
    </div>
  );
}
