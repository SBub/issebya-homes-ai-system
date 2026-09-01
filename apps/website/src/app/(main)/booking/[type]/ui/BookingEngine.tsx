"use client";

import { parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { addBookingBreadcrumb, setBookingContext } from "@/lib/sentry-booking";
import { useAvailabilityQuery } from "../hooks/useAvailabilityQuery";
import { BookingEngineCollapsed } from "./BookingEngineCollapsed";
import { BookingEngineExpanded } from "./BookingEngineExpanded";
import { BookingEngineSkeleton } from "./BookingEngineSkeleton";

type BookingEngineProps = {
  roomType: "room1" | "room2";
};

export function BookingEngine({ roomType }: BookingEngineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  // Prefills the guest's phone when they arrive via the GCA WhatsApp
  // sendBookingLink (which already knows their number) — never asked twice.
  // Direct website visitors have no ?phone= param and get an empty field.
  const initialPhone = searchParams.get("phone") ?? "";
  // Prefills the guest's name too when known (from a GCA link or any future
  // source) — asking for a name is normal on any booking, not agent-only,
  // so this has no source-gating unlike phone/whatsappOptIn.
  const initialGuestName = searchParams.get("guestName") ?? "";
  // Prefills email the same way as name — no source-gating, useful for any
  // booking regardless of how the guest arrived.
  const initialEmail = searchParams.get("email") ?? "";
  const source = searchParams.get("source") === "gca" ? "gca" : "direct";
  const urlCheckIn = searchParams.get("checkIn");
  const urlCheckOut = searchParams.get("checkOut");
  // Applies the sendBookingLink's checkIn/checkOut once (guards against
  // re-applying after the guest manually picks different dates).
  const appliedUrlDatesRef = useRef(false);
  // Auto-expands the calendar when arriving via the GCA link (phone or
  // source=gca present) so the guest sees their prefilled phone immediately,
  // without an extra click — independent of whether dates were also passed.
  // Search params are stable for the component's lifetime, so the initial
  // value is computed via a lazy initializer (no Effect needed to sync it),
  // but it stays real state so a direct visitor can still manually
  // expand/collapse via handleExpand/handleClose below.
  const [isExpanded, setIsExpanded] = useState(() => Boolean(initialPhone) || source === "gca");

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

  const {
    blockedDates,
    checkInDate,
    checkOutDate,
    isLoading,
    error,
    setCheckIn,
    setCheckOut,
    validateRange,
  } = useAvailabilityQuery(roomType);

  // Applies the sendBookingLink's ?checkIn=&checkOut= once availability has
  // loaded, if the range is actually available — otherwise leaves the
  // default first-available-nights selection alone.
  useEffect(() => {
    if (appliedUrlDatesRef.current || isLoading || !urlCheckIn || !urlCheckOut) return;
    appliedUrlDatesRef.current = true;

    const parsedCheckIn = parseISO(urlCheckIn);
    const parsedCheckOut = parseISO(urlCheckOut);
    if (
      !Number.isNaN(parsedCheckIn.getTime()) &&
      !Number.isNaN(parsedCheckOut.getTime()) &&
      parsedCheckOut > parsedCheckIn &&
      validateRange(parsedCheckIn, parsedCheckOut)
    ) {
      setCheckIn(parsedCheckIn);
      setCheckOut(parsedCheckOut);
    }
  }, [isLoading, urlCheckIn, urlCheckOut, validateRange, setCheckIn, setCheckOut]);

  // Handle date selection logic
  const handleDateSelect = useCallback(
    (date: Date) => {
      if (!checkInDate || (checkInDate && checkOutDate)) {
        // First click or reset: set check-in
        setCheckIn(date);
        setCheckOut(null);
      } else if (checkInDate && !checkOutDate) {
        // Second click: set check-out
        if (date > checkInDate) {
          // Validate the range
          if (validateRange(checkInDate, date)) {
            setCheckOut(date);
            posthog.capture("booking_dates_selected", {
              room_type: roomType,
              stay_nights: Math.round((date.getTime() - checkInDate.getTime()) / 86_400_000),
            });
          } else {
            // Invalid range, reset and start over with this date as check-in
            setCheckIn(date);
            setCheckOut(null);
          }
        } else {
          // Clicked date is before or same as check-in, reset
          setCheckIn(date);
          setCheckOut(null);
        }
      }
    },
    [checkInDate, checkOutDate, roomType, setCheckIn, setCheckOut, validateRange],
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

  if (isLoading) {
    return <BookingEngineSkeleton />;
  }

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
      <BookingEngineCollapsed
        checkInDate={checkInDate}
        checkOutDate={checkOutDate}
        onExpand={handleExpand}
      />

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
          initialPhone={initialPhone}
          initialGuestName={initialGuestName}
          initialEmail={initialEmail}
          source={source}
        />
      )}
    </div>
  );
}
