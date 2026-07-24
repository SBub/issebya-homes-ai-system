import { describe, expect, it } from "vitest";
import { aggregateFinanceBookings } from "@/lib/finance-sync.js";

describe("aggregateFinanceBookings", () => {
  it("collapses case-only duplicate names into one record (Marion Tremintin / MARION TREMINTIN)", () => {
    const result = aggregateFinanceBookings([
      {
        guest_name: "MARION TREMINTIN",
        room: "room_1",
        checkin_date: "2026-07-19",
        checkout_date: "2026-07-23",
        platform: "airbnb",
      },
      {
        guest_name: "Marion Tremintin",
        room: "room_1",
        checkin_date: "2026-08-01",
        checkout_date: "2026-08-05",
        platform: "booking_com",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      guestName: "Marion Tremintin",
      guestNameNormalized: "marion tremintin",
      lastRoom: "room_1",
      lastStayCheckin: "2026-08-01",
      lastStayCheckout: "2026-08-05",
      totalStays: 2,
      // Most recent booking (2026-08-01) is the booking_com one, not the
      // airbnb one — same "most recent by checkin_date" rule as
      // lastRoom/lastStayCheckin/lastStayCheckout.
      platform: "booking_com",
    });
  });

  it("gives a single-booking guest totalStays: 1", () => {
    const result = aggregateFinanceBookings([
      {
        guest_name: "Jane Doe",
        room: "room_1",
        checkin_date: "2026-09-05",
        checkout_date: "2026-09-08",
        platform: "direct",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      guestName: "Jane Doe",
      guestNameNormalized: "jane doe",
      totalStays: 1,
      platform: "direct",
    });
  });

  it("picks lastRoom/lastStayCheckin/lastStayCheckout/platform from the most recent booking, not input order", () => {
    // The most recent booking (by checkin_date) is listed FIRST here, so a
    // buggy implementation that just used the last array element (or the
    // first) instead of comparing dates would get this wrong.
    const result = aggregateFinanceBookings([
      {
        guest_name: "Repeat Guest",
        room: "room_2",
        checkin_date: "2026-10-01",
        checkout_date: "2026-10-04",
        platform: "direct",
      },
      {
        guest_name: "repeat guest",
        room: "room_1",
        checkin_date: "2026-01-01",
        checkout_date: "2026-01-03",
        platform: "airbnb",
      },
      {
        guest_name: "REPEAT GUEST",
        room: "room_1",
        checkin_date: "2026-05-15",
        checkout_date: "2026-05-18",
        platform: "booking_com",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      guestName: "Repeat Guest",
      guestNameNormalized: "repeat guest",
      lastRoom: "room_2",
      lastStayCheckin: "2026-10-01",
      lastStayCheckout: "2026-10-04",
      totalStays: 3,
      platform: "direct",
    });
  });

  it("keeps distinct guests as separate records", () => {
    const result = aggregateFinanceBookings([
      {
        guest_name: "Anna Kowalski",
        room: "room_1",
        checkin_date: "2026-09-20",
        checkout_date: "2026-09-22",
        platform: "airbnb",
      },
      {
        guest_name: "Peter Novak",
        room: "room_2",
        checkin_date: "2026-09-18",
        checkout_date: "2026-09-19",
        platform: "booking_com",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.guestNameNormalized).sort()).toEqual([
      "anna kowalski",
      "peter novak",
    ]);
  });

  it("normalizes surrounding whitespace as well as case", () => {
    const result = aggregateFinanceBookings([
      {
        guest_name: "  John Smith  ",
        room: "room_2",
        checkin_date: "2026-07-25",
        checkout_date: "2026-07-28",
        platform: "airbnb",
      },
      {
        guest_name: "john smith",
        room: "room_2",
        checkin_date: "2026-08-01",
        checkout_date: "2026-08-03",
        platform: "booking_com",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].guestNameNormalized).toBe("john smith");
    expect(result[0].totalStays).toBe(2);
    expect(result[0].platform).toBe("booking_com");
  });
});
