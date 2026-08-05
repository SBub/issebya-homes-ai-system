import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGetCurrentDate } from "@/agent/tools/current-date";

// runGetCurrentDate has no external dependencies (no DB, no fetch, no
// step) — it just wraps `new Date()` — so the only thing worth pinning down
// with fake timers is that its output tracks the real clock correctly and
// stays in UTC, matching the "no timezone concept in this codebase" note in
// current-date.ts.
describe("runGetCurrentDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today's date, day of week, and a full ISO timestamp, all in UTC", async () => {
    // Wednesday, matches a fixed instant so the assertion isn't relative.
    vi.setSystemTime(new Date("2026-08-05T10:30:00.000Z"));

    const result = await runGetCurrentDate();

    expect(result).toEqual({
      date: "2026-08-05",
      dayOfWeek: "Wednesday",
      isoTimestamp: "2026-08-05T10:30:00.000Z",
      timezone: "UTC",
    });
  });

  it("resolves the UTC calendar date even when local time would land on a different day", async () => {
    // Just after midnight UTC — a naive local-timezone read (e.g. UTC-5)
    // would still say the previous day. Confirms this stays UTC-only.
    vi.setSystemTime(new Date("2026-08-05T00:15:00.000Z"));

    const result = await runGetCurrentDate();

    expect(result.date).toBe("2026-08-05");
    expect(result.dayOfWeek).toBe("Wednesday");
  });
});
