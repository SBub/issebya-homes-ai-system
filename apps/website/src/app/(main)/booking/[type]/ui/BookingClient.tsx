"use client";

import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fromCalendarDay, isPastDate, isValidDateRange } from "@/lib/date-utils";
import { addBookingBreadcrumb, setBookingContext } from "@/lib/sentry-booking";
import type { DateRange } from "@/lib/shared/types/booking";
import { BookingEngineExpanded } from "./BookingEngineExpanded";

type BookingClientProps = {
  roomType: "room1" | "room2";
  blockedDates: DateRange[];
  // Calendar days ("yyyy-MM-dd"), not `Date`s: these are computed on the
  // server and rendered in the browser, so shipping instants would have the
  // browser re-read the server's midnight in the guest's timezone and show
  // (and submit) the previous day for anyone behind UTC.
  defaultCheckIn: string | null;
  defaultCheckOut: string | null;
  error: string | null;
  // Server Component passed down from BookingEngine (async Server Component)
  // via the Next.js "interleaving" pattern: it renders server-side and is
  // handed to this Client Component as already-resolved output, so it never
  // joins the client bundle.
  pricing: ReactNode;
};

// Why a GCA link's dates were not applied. `null` (absent) means there was
// nothing to reject: either no dates in the URL at all, or a range that was
// accepted.
type LinkDateRejection = "unreadable" | "past" | "unavailable";

// Reconciles the URL-provided ?checkIn=&checkOut= (from a GCA sendBookingLink)
// against the server-computed default first-available-nights selection. Both
// sources are calendar-day strings, and both are parsed the same way, into
// browser-local midnight, so the day the guest is shown is the day the label
// names. Pure calculation from props + searchParams — safe to run via a
// useState lazy initializer, no side effects.
//
// The accept condition is unchanged: a URL range wins only when both days
// parse, the check-out is after the check-in, and the whole stay clears
// `isValidDateRange`. What is new is that a rejection is reported rather than
// swallowed, so the guest can be told which dates their link carried and why
// they are not the ones selected in front of them.
//
// The three checks run in that order because each later one can only be
// trusted once the earlier ones passed: an unparseable or inverted range has
// no days to name in a message, and a check-in already in the past is the
// honest explanation even when the range would also collide with a blocked
// range. `isValidDateRange` folds all three failures into one `false`, which
// is why "past" is asked separately, via `isPastDate`, first.
function resolveInitialCheckDates(
  urlCheckIn: string | null,
  urlCheckOut: string | null,
  defaultCheckIn: string | null,
  defaultCheckOut: string | null,
  blockedDates: DateRange[],
): { checkIn: Date | null; checkOut: Date | null; rejection: LinkDateRejection | null } {
  const defaults = {
    checkIn: defaultCheckIn ? fromCalendarDay(defaultCheckIn) : null,
    checkOut: defaultCheckOut ? fromCalendarDay(defaultCheckOut) : null,
  };

  // Direct visitor: no dates in the URL, so nothing was rejected.
  if (!urlCheckIn && !urlCheckOut) {
    return { ...defaults, rejection: null };
  }

  // A half-supplied range is as unreadable as an unparseable one: no caller in
  // this repository produces one, so it can only come from a truncated or
  // hand-edited link.
  if (!urlCheckIn || !urlCheckOut) {
    return { ...defaults, rejection: "unreadable" };
  }

  const parsedCheckIn = fromCalendarDay(urlCheckIn);
  const parsedCheckOut = fromCalendarDay(urlCheckOut);
  if (
    Number.isNaN(parsedCheckIn.getTime()) ||
    Number.isNaN(parsedCheckOut.getTime()) ||
    parsedCheckOut <= parsedCheckIn
  ) {
    return { ...defaults, rejection: "unreadable" };
  }

  if (isPastDate(parsedCheckIn)) {
    return { ...defaults, rejection: "past" };
  }

  if (!isValidDateRange(parsedCheckIn, parsedCheckOut, blockedDates)) {
    return { ...defaults, rejection: "unavailable" };
  }

  return { checkIn: parsedCheckIn, checkOut: parsedCheckOut, rejection: null };
}

// Guest-facing copy for a rejected link. The two reasons whose days parsed
// name them back in the same "d MMM yyyy" → "d MMM yyyy" shape the collapsed
// row uses, so the guest recognises the stay they agreed in WhatsApp.
function describeRejectedLinkDates(
  rejection: LinkDateRejection,
  urlCheckIn: string | null,
  urlCheckOut: string | null,
): string {
  if (rejection === "unreadable" || !urlCheckIn || !urlCheckOut) {
    return "We could not read the dates in your link. Please pick your dates on the calendar below.";
  }

  const range = `${format(fromCalendarDay(urlCheckIn), "d MMM yyyy")} → ${format(
    fromCalendarDay(urlCheckOut),
    "d MMM yyyy",
  )}`;

  return rejection === "past"
    ? `The dates in your link (${range}) are in the past. Please pick new dates on the calendar below.`
    : `The dates in your link (${range}) are no longer available. Please pick new dates on the calendar below.`;
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
  //
  // `useState`, not `useMemo`: the resolution has to be computed exactly once
  // for the component's lifetime, so a later availability refresh through
  // `updateAvailability` can never retroactively change the notice for a link
  // the guest already opened.
  const [initialSelection] = useState(() =>
    resolveInitialCheckDates(
      urlCheckIn,
      urlCheckOut,
      defaultCheckIn,
      defaultCheckOut,
      initialBlockedDates,
    ),
  );
  const [checkInDate, setCheckInDate] = useState<Date | null>(initialSelection.checkIn);
  const [checkOutDate, setCheckOutDate] = useState<Date | null>(initialSelection.checkOut);

  // Set initial Sentry booking context
  useEffect(() => {
    setBookingContext({ roomType });
    addBookingBreadcrumb("Booking engine initialized", { roomType });
  }, [roomType]);

  // Expanding and closing land on the same place: the engine container, with
  // the collapsed date row at the top of the viewport. One helper so the two
  // targets can't drift apart again (close used to jump to the page top, which
  // is the gallery on mobile and the article's top in a blog post).
  const scrollEngineIntoView = useCallback(() => {
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (isExpanded) {
      scrollEngineIntoView();
    }
  }, [isExpanded, scrollEngineIntoView]);

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

  // Handle close: return to the date row, the same target expand scrolls to
  const handleClose = useCallback(() => {
    setIsExpanded(false);
    scrollEngineIntoView();
  }, [scrollEngineIntoView]);

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
      {/* The guest arrived on a link carrying dates that could not be applied.
          Sits above the collapsed row so it is visible whether or not the
          engine auto-expanded. `role="status"` rather than `role="alert"`:
          this is a page-load condition the guest can act on at their own
          pace, and it keeps the notice distinct from the submission error
          BookingEngineExpanded renders with `role="alert"`. */}
      {initialSelection.rejection && (
        <div className="booking-engine-error" role="status">
          <p className="text-sm text-red-600">
            {describeRejectedLinkDates(initialSelection.rejection, urlCheckIn, urlCheckOut)}
          </p>
        </div>
      )}

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
