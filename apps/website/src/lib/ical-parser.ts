import ICAL from "ical.js";
import type { DateRange, ICalEvent } from "@/lib/shared/types/booking";
import { getBlockedDates } from "./date-utils";

/**
 * Fetch iCal data from a URL with timeout
 */
export async function fetchICalFeed(url: string, timeoutMs = 10000): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ICalBot/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch iCal feed: ${response.statusText}`);
    }

    const data = await response.text();
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse iCal string into event objects using ical.js
 */
export function parseICalData(icalString: string): ICalEvent[] {
  try {
    const jcalData = ICAL.parse(icalString);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");

    const events: ICalEvent[] = vevents.map((vevent) => {
      const event = new ICAL.Event(vevent);

      return {
        dtstart: event.startDate.toJSDate(),
        dtend: event.endDate.toJSDate(),
        summary: event.summary || "Blocked",
      };
    });

    return events;
  } catch (error) {
    console.error("Error parsing iCal data:", error);
    throw new Error("Failed to parse iCal data");
  }
}

/**
 * Extract blocked date ranges from iCal events
 * Check-out dates (dtend) are excluded from blocked ranges
 */
export function extractBlockedDates(events: ICalEvent[]): DateRange[] {
  return getBlockedDates(events);
}

/**
 * Fetch blocked dates from multiple iCal feeds
 * Returns individual (unmerged) bookings from all sources
 * Handles partial failures gracefully
 */
export async function mergeMultipleFeeds(urls: string[]): Promise<{
  bookings: DateRange[];
  errors: string[];
}> {
  const allEvents: ICalEvent[] = [];
  const errors: string[] = [];

  // Fetch all feeds in parallel
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const icalData = await fetchICalFeed(url);
        const events = parseICalData(icalData);
        return events;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push(`Failed to fetch ${url}: ${errorMessage}`);
        return [];
      }
    }),
  );

  // Collect all successfully fetched events
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      allEvents.push(...result.value);
    }
  });

  const bookings = extractBlockedDates(allEvents);

  return {
    bookings,
    errors,
  };
}
