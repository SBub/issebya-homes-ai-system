"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackCalendarOpened, trackDateSelected } from "@/lib/analytics";
import { addBookingBreadcrumb, setBookingContext } from "@/lib/sentry-booking";
import { useAvailabilityQuery } from "../hooks/useAvailabilityQuery";
import { BookingEngineCollapsed } from "./BookingEngineCollapsed";
import { BookingEngineExpanded } from "./BookingEngineExpanded";
import { BookingEngineSkeleton } from "./BookingEngineSkeleton";

type BookingEngineProps = {
  roomType: "room1" | "room2";
};

export function BookingEngine({ roomType }: BookingEngineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
            trackDateSelected(format(checkInDate, "yyyy-MM-dd"), format(date, "yyyy-MM-dd"));
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
    [checkInDate, checkOutDate, setCheckIn, setCheckOut, validateRange],
  );

  // Handle expand
  const handleExpand = useCallback(() => {
    addBookingBreadcrumb("User expanded booking calendar", { roomType });
    setIsExpanded(true);
    trackCalendarOpened();
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
        />
      )}
    </div>
  );
}
