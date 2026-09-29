import { describe, expect, it } from "vitest";
import {
  type BookingStepRow,
  computeEvents,
  formatSseFrame,
  isDone,
  nextEvents,
  SSE_PING,
} from "../steps";

const AT = "2026-09-29T10:00:00.000Z";

const pending: BookingStepRow = {
  status: "pending",
  confirmed_at: null,
  guest_email_sent_at: null,
  owner_email_sent_at: null,
};

const allSet: BookingStepRow = {
  status: "confirmed",
  confirmed_at: AT,
  guest_email_sent_at: AT,
  owner_email_sent_at: AT,
};

const ids = (row: BookingStepRow) => computeEvents(row).map((e) => e.id);

describe("computeEvents", () => {
  it("emits nothing for a pending row with no timestamps", () => {
    expect(computeEvents(pending)).toEqual([]);
  });

  it("emits payment_received alone for a confirmed row with no timestamps", () => {
    expect(computeEvents({ ...pending, status: "confirmed" })).toEqual([
      { id: 1, name: "payment_received" },
    ]);
  });

  it("emits payment_received and confirmed once confirmed_at is set", () => {
    expect(ids({ ...pending, status: "confirmed", confirmed_at: AT })).toEqual([1, 2]);
  });

  it("adds guest_email_sent once the guest email is stamped", () => {
    expect(
      ids({ ...pending, status: "confirmed", confirmed_at: AT, guest_email_sent_at: AT }),
    ).toEqual([1, 2, 3]);
  });

  it("skips a failed guest email but still emits the owner email, without done", () => {
    const row = { ...pending, status: "confirmed", confirmed_at: AT, owner_email_sent_at: AT };
    expect(ids(row)).toEqual([1, 2, 4]);
    expect(computeEvents(row).some((e) => e.name === "done")).toBe(false);
  });

  it("emits every step then done when all timestamps are set", () => {
    expect(computeEvents(allSet)).toEqual([
      { id: 1, name: "payment_received" },
      { id: 2, name: "confirmed" },
      { id: 3, name: "guest_email_sent" },
      { id: 4, name: "owner_email_sent" },
      { id: 5, name: "done" },
    ]);
  });

  it("treats confirmed_at alone as proof of payment even while status reads pending", () => {
    expect(ids({ ...pending, confirmed_at: AT })).toEqual([1, 2]);
  });
});

describe("nextEvents", () => {
  it("returns only events above the last id", () => {
    expect(nextEvents(allSet, 2).map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it("returns nothing once done has been seen", () => {
    expect(nextEvents(allSet, 5)).toEqual([]);
  });

  it("returns every event for a last id of 0", () => {
    const row = { ...pending, status: "confirmed", confirmed_at: AT };
    expect(nextEvents(row, 0)).toEqual(computeEvents(row));
  });
});

describe("isDone", () => {
  it("is true only when all four steps are present", () => {
    expect(isDone(allSet)).toBe(true);
    expect(isDone({ ...allSet, guest_email_sent_at: null })).toBe(false);
    expect(isDone(pending)).toBe(false);
  });
});

describe("formatSseFrame", () => {
  it("writes id, event and JSON data lines ending in a blank line", () => {
    expect(formatSseFrame({ id: 3, event: "guest_email_sent", data: {} })).toBe(
      "id: 3\nevent: guest_email_sent\ndata: {}\n\n",
    );
  });

  it("omits the id line when no id is given", () => {
    expect(formatSseFrame({ event: "error", data: { message: "x" } })).toBe(
      'event: error\ndata: {"message":"x"}\n\n',
    );
  });

  it("formats the ping as an SSE comment", () => {
    expect(SSE_PING).toBe(": ping\n\n");
  });
});
