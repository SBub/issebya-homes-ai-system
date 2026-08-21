import { startOfDay } from "date-fns";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { extractBlockedDates, mergeMultipleFeeds, parseICalData } from "../ical-parser";

// eslint-disable-next-line no-secrets/no-secrets -- mocked ical data for testing
const SAMPLE_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250610
DTEND;VALUE=DATE:20250613
SUMMARY:Airbnb Booking
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250620
DTEND;VALUE=DATE:20250622
SUMMARY:VRBO Booking
END:VEVENT
END:VCALENDAR`;

const SINGLE_EVENT_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250701
DTEND;VALUE=DATE:20250705
SUMMARY:Booking
END:VEVENT
END:VCALENDAR`;

const EMPTY_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
END:VCALENDAR`;

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("parseICalData", () => {
  it("parses multiple events from iCal string", () => {
    const events = parseICalData(SAMPLE_ICAL);

    expect(events).toHaveLength(2);
    expect(events[0].summary).toBe("Airbnb Booking");
    // ical.js converts VALUE=DATE in local timezone, so compare via startOfDay
    expect(startOfDay(events[0].dtstart)).toEqual(startOfDay(new Date(2025, 5, 10)));
    expect(startOfDay(events[0].dtend)).toEqual(startOfDay(new Date(2025, 5, 13)));
    expect(events[1].summary).toBe("VRBO Booking");
  });

  it("parses a single event", () => {
    const events = parseICalData(SINGLE_EVENT_ICAL);

    expect(events).toHaveLength(1);
    expect(startOfDay(events[0].dtstart)).toEqual(startOfDay(new Date(2025, 6, 1)));
    expect(startOfDay(events[0].dtend)).toEqual(startOfDay(new Date(2025, 6, 5)));
  });

  it("returns empty array for calendar with no events", () => {
    const events = parseICalData(EMPTY_ICAL);
    expect(events).toHaveLength(0);
  });

  it("throws on invalid iCal data", () => {
    expect(() => parseICalData("not valid ical")).toThrow("Failed to parse iCal data");
  });

  it('defaults summary to "Blocked" when missing', () => {
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250801
DTEND;VALUE=DATE:20250803
END:VEVENT
END:VCALENDAR`;
    const events = parseICalData(ical);
    expect(events[0].summary).toBe("Blocked");
  });
});

describe("extractBlockedDates", () => {
  it("converts events to blocked date ranges with startOfDay normalization", () => {
    const events = parseICalData(SAMPLE_ICAL);
    const blocked = extractBlockedDates(events);

    expect(blocked).toHaveLength(2);
    expect(blocked[0].start).toEqual(startOfDay(new Date("2025-06-10")));
    expect(blocked[0].end).toEqual(startOfDay(new Date("2025-06-13")));
  });

  it("returns empty array for no events", () => {
    expect(extractBlockedDates([])).toEqual([]);
  });
});

describe("mergeMultipleFeeds", () => {
  it("fetches and merges events from multiple feeds", async () => {
    server.use(
      http.get("https://example.com/feed1.ics", () => HttpResponse.text(SINGLE_EVENT_ICAL)),
      http.get("https://example.com/feed2.ics", () => HttpResponse.text(SAMPLE_ICAL)),
    );

    const result = await mergeMultipleFeeds([
      "https://example.com/feed1.ics",
      "https://example.com/feed2.ics",
    ]);

    expect(result.errors).toHaveLength(0);
    // 3 events total: 1 from feed1 + 2 from feed2, returned unmerged
    expect(result.bookings).toHaveLength(3);
  });

  it("handles partial failures gracefully", async () => {
    server.use(
      http.get("https://example.com/feed1.ics", () => HttpResponse.text(SINGLE_EVENT_ICAL)),
      http.get("https://example.com/feed2.ics", () => HttpResponse.error()),
    );

    const result = await mergeMultipleFeeds([
      "https://example.com/feed1.ics",
      "https://example.com/feed2.ics",
    ]);

    expect(result.bookings).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("handles non-ok HTTP responses", async () => {
    server.use(
      http.get(
        "https://example.com/feed.ics",
        () => new HttpResponse(null, { status: 404, statusText: "Not Found" }),
      ),
    );

    const result = await mergeMultipleFeeds(["https://example.com/feed.ics"]);

    expect(result.bookings).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to fetch iCal feed");
  });

  it("returns empty results for empty URL list", async () => {
    const result = await mergeMultipleFeeds([]);

    expect(result.bookings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns individual bookings from different feeds without merging", async () => {
    const feed1 = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250610
DTEND;VALUE=DATE:20250615
SUMMARY:Feed1
END:VEVENT
END:VCALENDAR`;

    const feed2 = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250613
DTEND;VALUE=DATE:20250618
SUMMARY:Feed2
END:VEVENT
END:VCALENDAR`;

    server.use(
      http.get("https://example.com/feed1.ics", () => HttpResponse.text(feed1)),
      http.get("https://example.com/feed2.ics", () => HttpResponse.text(feed2)),
    );

    const result = await mergeMultipleFeeds([
      "https://example.com/feed1.ics",
      "https://example.com/feed2.ics",
    ]);

    // Each feed returns its booking unmerged — 2 individual bookings
    expect(result.bookings).toHaveLength(2);
    expect(result.bookings[0].start).toEqual(startOfDay(new Date("2025-06-10")));
    expect(result.bookings[0].end).toEqual(startOfDay(new Date("2025-06-15")));
    expect(result.bookings[1].start).toEqual(startOfDay(new Date("2025-06-13")));
    expect(result.bookings[1].end).toEqual(startOfDay(new Date("2025-06-18")));
  });
});
