import type { FinanceBooking } from "./types";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionSyncResult {
  bookingId: string;
  ok: boolean;
  error?: string;
}

/**
 * Notion sync is optional and best-effort: Postgres (finance_bookings) is
 * the source of truth. If NOTION_API_KEY/NOTION_DATABASE_ID aren't set,
 * syncBooking() no-ops rather than erroring — sync is a supplementary view,
 * not a hard dependency for import to succeed.
 */
export function notionConfigured(): boolean {
  return Boolean(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID);
}

function notionHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// Notion's formula properties (Actual profit, IRS taxable base, Tourist tax,
// Net after tourist) are computed inside Notion from the fields below — the
// API rejects direct writes to them, and shouldn't need to write them anyway.
export function bookingToNotionProperties(booking: FinanceBooking): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: booking.guest_name } }] },
    "Booking ID": { rich_text: [{ text: { content: booking.booking_id } }] },
    Platform: { select: { name: booking.platform } },
    Room: { select: { name: booking.room } },
    Status: { select: { name: booking.status } },
    "Check-in": { date: { start: booking.checkin_date } },
    "Check-out": { date: { start: booking.checkout_date } },
    Nights: { number: booking.nights },
    Guests: { number: booking.guests },
    "Gross income": { number: booking.gross_room_income },
    "Platform fee": { number: booking.platform_fee },
    "Net received": { number: booking.net_received },
    "Cleaning cost": { number: booking.cleaning_cost },
  };
  if (booking.booked_date) {
    properties["Booked date"] = { date: { start: booking.booked_date } };
  }
  if (booking.commission_amount != null) {
    properties["Commission amount"] = { number: booking.commission_amount };
  }
  return properties;
}

async function findExistingPageId(
  apiKey: string,
  databaseId: string,
  bookingId: string,
): Promise<string | null> {
  const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      filter: { property: "Booking ID", rich_text: { equals: bookingId } },
      page_size: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion query failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { results: { id: string }[] };
  return body.results[0]?.id ?? null;
}

/** Creates a page for `booking` if none exists yet (matched by Booking ID), otherwise updates it. */
export async function syncBooking(booking: FinanceBooking): Promise<NotionSyncResult> {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    return { bookingId: booking.booking_id, ok: true };
  }

  try {
    const properties = bookingToNotionProperties(booking);
    const existingPageId = await findExistingPageId(apiKey, databaseId, booking.booking_id);

    const res = existingPageId
      ? await fetch(`${NOTION_API}/pages/${existingPageId}`, {
          method: "PATCH",
          headers: notionHeaders(apiKey),
          body: JSON.stringify({ properties }),
        })
      : await fetch(`${NOTION_API}/pages`, {
          method: "POST",
          headers: notionHeaders(apiKey),
          body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
        });

    if (!res.ok) {
      throw new Error(
        `Notion ${existingPageId ? "update" : "create"} failed (${res.status}): ${await res.text()}`,
      );
    }
    return { bookingId: booking.booking_id, ok: true };
  } catch (err) {
    return {
      bookingId: booking.booking_id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Syncs every booking, collecting per-booking failures rather than aborting on the first one. */
export async function syncBookings(bookings: FinanceBooking[]): Promise<NotionSyncResult[]> {
  const results: NotionSyncResult[] = [];
  for (const booking of bookings) {
    results.push(await syncBooking(booking));
  }
  return results;
}
