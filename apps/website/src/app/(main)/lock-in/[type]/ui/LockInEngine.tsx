import { connection } from "next/server";
import { getAvailability } from "@/lib/availability";
import { classifyLockInWeeks, getLockInWeeks } from "@/lib/lock-in";
import { LockInClient } from "./LockInClient";

type LockInEngineProps = {
  roomType: "room1" | "room2";
};

// Server Component. Unlike BookingEngine this one is a request-time hole in
// the static page: which weeks are on offer depends on today, and under Cache
// Components a clock read in a prerendered scope either fails the build or
// freezes "today" at build time. `connection()` defers everything below it to
// the request; the Suspense fallback in EngineGuard is the prerendered part.
export async function LockInEngine({ roomType }: LockInEngineProps) {
  await connection();

  const { bookings, error } = await getAvailability(roomType);
  const weeks = classifyLockInWeeks(getLockInWeeks(new Date()), bookings);

  // Only calendar-day strings and booleans cross to the client.
  return <LockInClient roomType={roomType} weeks={weeks} hasAvailabilityError={Boolean(error)} />;
}
