"use client";

import { LOCK_IN_PRICING } from "pricing";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClassifiedLockInWeek, LockInWeek } from "@/lib/lock-in";
import { formatPrice } from "@/lib/price-utils";
import { addBookingBreadcrumb, setBookingContext } from "@/lib/sentry-booking";
import { LockInEngineExpanded } from "./LockInEngineExpanded";
import { LockInWeekGrid } from "./LockInWeekGrid";

type LockInClientProps = {
  roomType: "room1" | "room2";
  // Calendar days plus a verdict per week, computed on the server.
  weeks: ClassifiedLockInWeek[];
  hasAvailabilityError: boolean;
};

export function LockInClient({ roomType, weeks, hasAvailabilityError }: LockInClientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<LockInWeek | null>(null);
  // Weeks found taken at submit time, after the page loaded.
  const [takenCheckIns, setTakenCheckIns] = useState<string[]>([]);
  const [conflictError, setConflictError] = useState<string | null>(null);

  useEffect(() => {
    setBookingContext({ roomType });
    addBookingBreadcrumb("Lock-in engine initialized", { roomType });
  }, [roomType]);

  const scrollEngineIntoView = useCallback(() => {
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleSelect = useCallback(
    (week: LockInWeek) => {
      setSelected(week);
      setConflictError(null);
      addBookingBreadcrumb("User selected lock-in week", { roomType, checkIn: week.checkIn });
      scrollEngineIntoView();
    },
    [roomType, scrollEngineIntoView],
  );

  const handleClose = useCallback(() => {
    setSelected(null);
    scrollEngineIntoView();
  }, [scrollEngineIntoView]);

  const handleConflict = useCallback(
    (message: string) => {
      if (selected) {
        const { checkIn } = selected;
        setTakenCheckIns((taken) => [...taken, checkIn]);
      }
      setSelected(null);
      setConflictError(message);
    },
    [selected],
  );

  const shownWeeks = weeks.map((week) =>
    takenCheckIns.includes(week.checkIn) ? { ...week, available: false } : week,
  );

  return (
    <div ref={containerRef} className="booking-engine">
      <p className="lock-in-intro">
        Lock-in: one week, Monday to Monday, {formatPrice(LOCK_IN_PRICING.weekPrice)}
      </p>

      {conflictError && (
        <p className="text-red-500 text-sm mb-4" role="alert" aria-live="polite">
          {conflictError}
        </p>
      )}

      <LockInWeekGrid
        weeks={shownWeeks}
        selectedCheckIn={selected?.checkIn ?? null}
        onSelect={handleSelect}
      />

      {selected && (
        <LockInEngineExpanded
          key={selected.checkIn}
          roomType={roomType}
          week={selected}
          hasAvailabilityError={hasAvailabilityError}
          onClose={handleClose}
          onConflict={handleConflict}
        />
      )}
    </div>
  );
}
