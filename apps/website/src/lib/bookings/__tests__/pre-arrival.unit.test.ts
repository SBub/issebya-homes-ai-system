import { describe, expect, it } from "vitest";
import {
  firstName,
  maskEmail,
  type PreArrivalBookingRow,
  preArrivalWindow,
  selectPreArrivalCandidates,
} from "../pre-arrival";

function row(overrides: Partial<PreArrivalBookingRow> & { id: string }): PreArrivalBookingRow {
  return {
    room_type: "room1",
    check_in: "2026-10-01",
    check_out: "2026-10-04",
    status: "confirmed",
    pre_arrival_email_sent_at: null,
    guest_name: "Anna Silva",
    email: "anna@example.com",
    ...overrides,
  };
}

const ids = (rows: PreArrivalBookingRow[]) => rows.map((r) => r.id);

describe("selectPreArrivalCandidates", () => {
  const today = "2026-09-29";
  const rows = [
    row({ id: "tomorrow", check_in: "2026-09-30" }),
    row({ id: "in-two-days", check_in: "2026-10-01" }),
    row({ id: "in-three-days", check_in: "2026-10-02" }),
    row({ id: "today", check_in: "2026-09-29" }),
    row({ id: "yesterday", check_in: "2026-09-28" }),
    row({ id: "pending", check_in: "2026-09-30", status: "pending" }),
    row({ id: "cancelled", check_in: "2026-09-30", status: "cancelled" }),
    row({
      id: "already-sent",
      check_in: "2026-10-01",
      pre_arrival_email_sent_at: "2026-09-28T07:10:00Z",
    }),
  ];

  it("picks confirmed, unsent bookings checking in tomorrow or the day after", () => {
    const { candidates } = selectPreArrivalCandidates(rows, today);
    expect(ids(candidates)).toEqual(["tomorrow", "in-two-days"]);
  });

  it("classifies confirmed check-ins today or earlier as too late", () => {
    const { tooLate } = selectPreArrivalCandidates(rows, today);
    expect(ids(tooLate)).toEqual(["today", "yesterday"]);
  });

  it("rolls the window over a month and year boundary", () => {
    const { candidates } = selectPreArrivalCandidates(
      [
        row({ id: "jan-1", check_in: "2027-01-01" }),
        row({ id: "jan-2", check_in: "2027-01-02" }),
        row({ id: "jan-3", check_in: "2027-01-03" }),
      ],
      "2026-12-31",
    );
    expect(ids(candidates)).toEqual(["jan-1", "jan-2"]);
  });
});

describe("preArrivalWindow", () => {
  it("spans today through today+2", () => {
    expect(preArrivalWindow("2026-09-29")).toEqual({ from: "2026-09-29", to: "2026-10-01" });
  });
});

describe("firstName", () => {
  it.each([
    [null, null],
    ["", null],
    ["   ", null],
    ["Anna", "Anna"],
    ["  Anna  Maria Silva ", "Anna"],
  ])("%j becomes %j", (input, expected) => {
    expect(firstName(input)).toBe(expected);
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain only", () => {
    expect(maskEmail("anna@example.com")).toBe("a***@example.com");
    expect(maskEmail("anna@example.com")).not.toContain("anna");
  });

  it("masks a value with no @ entirely", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });
});
