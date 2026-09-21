import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCheckAvailability } from "@/agent/tools/availability.js";

// The date guard runs before the GET /api/availability?room= fetch, so every
// refusal below also asserts the fetch never happened — that early return is
// the whole point (nothing is booked in the past, so the endpoint would
// happily report a past range as free).
describe("computeCheckAvailability", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T10:00:00.000Z"));
    fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ bookings: [] }))));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refuses the 2026-09-21 incident's past range instead of reporting it available", async () => {
    const result = await computeCheckAvailability({
      room: "room1",
      checkIn: "2025-10-11",
      checkOut: "2025-10-13",
    });

    expect(result).toEqual({
      available: false,
      reason: "past_date",
      room: "room1",
      checkIn: "2025-10-11",
      checkOut: "2025-10-13",
      today: "2026-09-21",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a zero-night stay as invalid_range", async () => {
    const result = await computeCheckAvailability({
      room: "room1",
      checkIn: "2026-10-11",
      checkOut: "2026-10-11",
    });

    expect(result).toMatchObject({ available: false, reason: "invalid_range" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed date as invalid_date", async () => {
    const result = await computeCheckAvailability({
      room: "room2",
      checkIn: "11-10-2026",
      checkOut: "2026-10-13",
    });

    expect(result).toMatchObject({ available: false, reason: "invalid_date" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still reports a future range with no conflicting booking as available", async () => {
    const result = await computeCheckAvailability({
      room: "room1",
      checkIn: "2026-10-11",
      checkOut: "2026-10-13",
    });

    expect(result).toEqual({
      available: true,
      room: "room1",
      checkIn: "2026-10-11",
      checkOut: "2026-10-13",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/availability?room=room1");
  });

  it("reports a future range overlapping a booked range as unavailable, with no `reason` — booked and refused stay distinguishable", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ bookings: [{ start: "2026-10-12", end: "2026-10-15" }] })),
    );

    const result = await computeCheckAvailability({
      room: "room1",
      checkIn: "2026-10-11",
      checkOut: "2026-10-13",
    });

    expect(result).toEqual({
      available: false,
      room: "room1",
      checkIn: "2026-10-11",
      checkOut: "2026-10-13",
    });
  });
});
