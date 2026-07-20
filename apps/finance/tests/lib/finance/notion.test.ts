import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingToNotionProperties, notionConfigured, syncBooking } from "@/lib/finance/notion.js";
import type { FinanceBooking } from "@/lib/finance/types.js";

const booking: FinanceBooking = {
  booking_id: "HMABC12345",
  platform: "airbnb",
  room: "room_1",
  guest_name: "Ruby Pullum",
  checkin_date: "2026-07-19",
  checkout_date: "2026-07-22",
  booked_date: "2026-07-05",
  nights: 3,
  guests: 2,
  gross_room_income: 110,
  platform_fee: 4.06,
  net_received: 105.94,
  tourist_tax: 12,
  net_after_tourist: 93.94,
  cleaning_cost: 15,
  actual_profit: 78.94,
  irs_taxable_base: 14.09,
  status: "completed",
  commission_amount: null,
};

describe("bookingToNotionProperties", () => {
  it("maps every writable field, omitting Notion's formula properties", () => {
    const props = bookingToNotionProperties(booking);
    expect(props.Name).toEqual({ title: [{ text: { content: "Ruby Pullum" } }] });
    expect(props["Booking ID"]).toEqual({ rich_text: [{ text: { content: "HMABC12345" } }] });
    expect(props.Platform).toEqual({ select: { name: "airbnb" } });
    expect(props.Room).toEqual({ select: { name: "room_1" } });
    expect(props.Status).toEqual({ select: { name: "completed" } });
    expect(props["Check-in"]).toEqual({ date: { start: "2026-07-19" } });
    expect(props["Check-out"]).toEqual({ date: { start: "2026-07-22" } });
    expect(props["Booked date"]).toEqual({ date: { start: "2026-07-05" } });
    expect(props.Nights).toEqual({ number: 3 });
    expect(props.Guests).toEqual({ number: 2 });
    expect(props["Gross income"]).toEqual({ number: 110 });
    expect(props["Platform fee"]).toEqual({ number: 4.06 });
    expect(props["Net received"]).toEqual({ number: 105.94 });
    expect(props["Cleaning cost"]).toEqual({ number: 15 });

    // Formula fields must never be sent — Notion computes and rejects writes to them.
    expect(props["Actual profit"]).toBeUndefined();
    expect(props["IRS taxable base"]).toBeUndefined();
    expect(props["Tourist tax"]).toBeUndefined();
    expect(props["Net after tourist"]).toBeUndefined();
  });

  it("omits Booked date when null", () => {
    const props = bookingToNotionProperties({ ...booking, booked_date: null });
    expect(props["Booked date"]).toBeUndefined();
  });

  it("includes Commission amount only when non-null (Booking.com rows)", () => {
    expect(bookingToNotionProperties(booking)["Commission amount"]).toBeUndefined();
    const withCommission = bookingToNotionProperties({ ...booking, commission_amount: 27 });
    expect(withCommission["Commission amount"]).toEqual({ number: 27 });
  });
});

describe("notionConfigured", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", () => {
    // Node coerces `= undefined` on process.env to the string "undefined"
    // (truthy!) — must actually delete the key to simulate "unset".
    delete process.env.NOTION_API_KEY;
    process.env.NOTION_DATABASE_ID = "db-id";
    expect(notionConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    process.env.NOTION_API_KEY = "key";
    process.env.NOTION_DATABASE_ID = "db-id";
    expect(notionConfigured()).toBe(true);
  });
});

describe("syncBooking", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NOTION_API_KEY = "test-key";
    process.env.NOTION_DATABASE_ID = "test-db-id";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops (ok: true) when Notion isn't configured, without calling fetch", async () => {
    delete process.env.NOTION_API_KEY;
    const result = await syncBooking(booking);
    expect(result).toEqual({ bookingId: booking.booking_id, ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a new page when no existing page is found", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "new-page" }), { status: 200 }));

    const result = await syncBooking(booking);

    expect(result).toEqual({ bookingId: booking.booking_id, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [queryUrl] = fetchMock.mock.calls[0];
    expect(queryUrl).toBe("https://api.notion.com/v1/databases/test-db-id/query");
    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toBe("https://api.notion.com/v1/pages");
    expect(createInit.method).toBe("POST");
    const createBody = JSON.parse(createInit.body);
    expect(createBody.parent).toEqual({ database_id: "test-db-id" });
  });

  it("updates the existing page when one is found by Booking ID", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: "existing-page" }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "existing-page" }), { status: 200 }),
      );

    const result = await syncBooking(booking);

    expect(result).toEqual({ bookingId: booking.booking_id, ok: true });
    const [updateUrl, updateInit] = fetchMock.mock.calls[1];
    expect(updateUrl).toBe("https://api.notion.com/v1/pages/existing-page");
    expect(updateInit.method).toBe("PATCH");
  });

  it("returns ok: false with the error message on failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));

    const result = await syncBooking(booking);

    expect(result.ok).toBe(false);
    expect(result.bookingId).toBe(booking.booking_id);
    expect(result.error).toContain("401");
  });
});
