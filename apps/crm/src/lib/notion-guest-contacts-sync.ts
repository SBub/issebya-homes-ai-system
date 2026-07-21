import { createAdminClient } from "./supabase";

// Push-sync: guest_contacts (Postgres, source of truth) -> the dedicated
// "Guest Contacts" Notion database (separate from apps/finance's "Finance
// Bookings" database — mixing financial records with guest contact info was
// the original design, corrected per the user's request). Same pure/
// orchestration split, and the same find-existing-page-then-create-or-update
// shape, as apps/finance/src/lib/finance/notion.ts's bookingToNotionProperties
// / findExistingPageId / syncBooking — mirrored deliberately rather than
// inventing a different structure.
//
// Unlike Finance Bookings (matched by a "Booking ID" rich_text property),
// this database has a "Contact ID" rich_text property holding
// guest_contacts.id (a uuid) — the reliable match key, since guest names
// aren't guaranteed unique across real people.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface GuestContactRow {
  id: string;
  guest_name: string;
  phone: string | null;
  last_room: string | null;
  last_stay_checkin: string | null;
  last_stay_checkout: string | null;
  total_stays: number;
}

function notionHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// Pure — no DB/network access, so this is unit-testable in isolation.
//
// Phone/Last Room/the two stay dates are omitted entirely (not sent as
// empty string/null) when the source value is null — a guest_contacts row
// can have no phone yet (nothing manually typed into Notion, nothing
// derived from finance_bookings) or no stay history (edge case, but
// total_stays: 0 with null dates is a valid row shape), and Notion should
// simply not have that property set rather than showing an empty value.
export function guestContactToNotionProperties(contact: GuestContactRow): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: contact.guest_name } }] },
    "Total Stays": { number: contact.total_stays },
    "Contact ID": { rich_text: [{ text: { content: contact.id } }] },
  };
  if (contact.phone != null) {
    properties.Phone = { phone_number: contact.phone };
  }
  if (contact.last_room != null) {
    properties["Last Room"] = { rich_text: [{ text: { content: contact.last_room } }] };
  }
  if (contact.last_stay_checkin != null) {
    properties["Last Stay Check-in"] = { date: { start: contact.last_stay_checkin } };
  }
  if (contact.last_stay_checkout != null) {
    properties["Last Stay Check-out"] = { date: { start: contact.last_stay_checkout } };
  }
  return properties;
}

async function findExistingPageId(
  apiKey: string,
  databaseId: string,
  contactId: string,
): Promise<string | null> {
  const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      filter: { property: "Contact ID", rich_text: { equals: contactId } },
      page_size: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion query failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { results: { id: string }[] };
  return body.results[0]?.id ?? null;
}

interface GuestContactNotionSyncResult {
  contactId: string;
  ok: boolean;
  error?: string;
}

/** Creates a page for `contact` if none exists yet (matched by Contact ID), otherwise updates it. */
async function syncGuestContact(
  apiKey: string,
  databaseId: string,
  contact: GuestContactRow,
): Promise<GuestContactNotionSyncResult> {
  try {
    const properties = guestContactToNotionProperties(contact);
    const existingPageId = await findExistingPageId(apiKey, databaseId, contact.id);

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
    return { contactId: contact.id, ok: true };
  } catch (err) {
    return {
      contactId: contact.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PushGuestContactsSummary {
  total: number;
  succeeded: number;
  failed: GuestContactNotionSyncResult[];
}

// Orchestration: reads every guest_contacts row, then pushes each to the
// Guest Contacts Notion database, collecting per-row failures rather than
// aborting on the first one (same convention as apps/finance's syncBookings).
export async function pushGuestContactsToNotion(): Promise<PushGuestContactsSummary> {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.GUEST_CONTACTS_NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    throw new Error("NOTION_API_KEY/GUEST_CONTACTS_NOTION_DATABASE_ID are not set");
  }

  const supabase = createAdminClient();
  const { data: contacts, error } = await supabase
    .from("guest_contacts")
    .select("id, guest_name, phone, last_room, last_stay_checkin, last_stay_checkout, total_stays");
  if (error) throw error;

  const results: GuestContactNotionSyncResult[] = [];
  for (const contact of contacts ?? []) {
    results.push(await syncGuestContact(apiKey, databaseId, contact));
  }

  const failed = results.filter((result) => !result.ok);
  return { total: results.length, succeeded: results.length - failed.length, failed };
}
