import { EngineGuard } from "@/app/(main)/booking/[type]/ui/EngineGuard";
import type { BookingType } from "@/lib/shared/types/booking";
import { LockInEngine } from "./LockInEngine";

/** The lock-in engine inside the same guards as the nightly booking engine. */
export function GuardedLockInEngine({ roomType }: { roomType: BookingType }) {
  return (
    <EngineGuard>
      <LockInEngine roomType={roomType} />
    </EngineGuard>
  );
}
