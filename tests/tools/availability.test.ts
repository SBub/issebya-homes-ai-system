import { describe, expect, it } from "vitest";
import { countOccupiedNights } from "../../src/tools/availability.js";

const now = new Date("2026-07-18T00:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

describe("countOccupiedNights", () => {
  it("is 0 with no bookings", () => {
    expect(countOccupiedNights([], now)).toBe(0);
  });

  it("counts a booking fully inside the horizon", () => {
    const bookings = [{ start: "2026-07-19T00:00:00.000Z", end: "2026-07-24T00:00:00.000Z" }];
    expect(countOccupiedNights(bookings, now)).toBe(5);
  });

  it("does not double count overlapping bookings", () => {
    const bookings = [
      { start: "2026-07-19T00:00:00.000Z", end: "2026-07-24T00:00:00.000Z" },
      { start: "2026-07-22T00:00:00.000Z", end: "2026-07-26T00:00:00.000Z" },
    ];
    expect(countOccupiedNights(bookings, now)).toBe(7);
  });

  it("ignores a booking entirely outside the horizon", () => {
    const bookings = [{ start: "2027-01-01T00:00:00.000Z", end: "2027-01-05T00:00:00.000Z" }];
    expect(countOccupiedNights(bookings, now)).toBe(0);
  });

  it("clips a booking that starts before the horizon", () => {
    const bookings = [{ start: "2026-07-10T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" }];
    expect(countOccupiedNights(bookings, now)).toBe(2);
  });

  it("treats end date as exclusive (checkout day is not occupied)", () => {
    const bookings = [
      { start: now.toISOString(), end: new Date(now.getTime() + dayMs).toISOString() },
    ];
    expect(countOccupiedNights(bookings, now)).toBe(1);
  });
});
