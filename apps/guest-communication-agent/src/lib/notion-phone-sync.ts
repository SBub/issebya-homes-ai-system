import { normalizePhone } from "./phone";
import { createAdminClient } from "./supabase";

// Pulls phone numbers a human has manually typed into Notion's "Finance
// Bookings" database (apps/finance/src/lib/finance/notion.ts's existing
// push-sync writes every booking there; a human adds the "Phone" property
// themselves in Notion's UI — this doesn't create that property) back into
// GCA's own guest_contacts table. This is the one place data flows FROM
// Notion INTO Postgres — everything else in this repo's Notion sync is
// one-way Postgres -> Notion.
//
// Same pure/orchestration split as ./finance-sync.ts: a pure extraction
// function (unit-testable, no network) and an orchestration function that
// does the actual Notion querying + Supabase reads/writes.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const NOTION_PAGE_SIZE = 100; // Notion's query API cap per call.

interface NotionRichTextItem {
  plain_text?: string;
  text?: { content?: string };
}

interface NotionTitleProperty {
  type: "title";
  title: NotionRichTextItem[];
}

interface NotionPhoneNumberProperty {
  type: "phone_number";
  phone_number: string | null;
}

interface NotionRichTextProperty {
  type: "rich_text";
  rich_text: NotionRichTextItem[];
}

type NotionPageProperties = Record<
  string,
  NotionTitleProperty | NotionPhoneNumberProperty | NotionRichTextProperty | { type: string }
>;

export interface ExtractedGuestPhone {
  guestName: string;
  phone: string;
}

function richTextToPlainString(items: NotionRichTextItem[]): string {
  return items
    .map((item) => item.plain_text ?? item.text?.content ?? "")
    .join("")
    .trim();
}

// Pure — no DB/network access, so this is unit-testable in isolation.
//
// Reads the "Name" title property (the same property
// apps/finance/src/lib/finance/notion.ts's push-sync already writes to every
// page) and a "Phone" property that could be EITHER Notion's native
// phone_number type or a plain rich_text property — the user picked one of
// the two when they added the property by hand, and this handles both
// defensively by branching on the property's own `type` field rather than
// assuming a shape.
//
// Returns null when there's no Name, or when Phone is empty/missing/null —
// both are "nothing usable to sync" cases, not errors.
export function extractGuestPhoneFromNotionPage(
  properties: NotionPageProperties,
): ExtractedGuestPhone | null {
  const nameProperty = properties.Name;
  const guestName =
    nameProperty && nameProperty.type === "title"
      ? richTextToPlainString((nameProperty as NotionTitleProperty).title)
      : "";
  if (!guestName) return null;

  const phoneProperty = properties.Phone;
  let rawPhone = "";
  if (phoneProperty?.type === "phone_number") {
    rawPhone = (phoneProperty as NotionPhoneNumberProperty).phone_number?.trim() ?? "";
  } else if (phoneProperty?.type === "rich_text") {
    rawPhone = richTextToPlainString((phoneProperty as NotionRichTextProperty).rich_text);
  }
  if (!rawPhone) return null;

  // normalizePhone() is applied here (not just at db.ts's read side) so
  // guest_contacts.phone always lands in the same canonical form regardless
  // of which direction the data came from — see ./phone.ts's own doc
  // comment for why this comparison must agree on both sides.
  return { guestName, phone: normalizePhone(rawPhone) };
}

interface NotionQueryResponse {
  results: { properties: NotionPageProperties }[];
  has_more: boolean;
  next_cursor: string | null;
}

async function fetchAllNotionPages(
  apiKey: string,
  databaseId: string,
): Promise<{ properties: NotionPageProperties }[]> {
  const pages: { properties: NotionPageProperties }[] = [];
  let cursor: string | undefined;

  // Notion's query API caps at 100 results per call and reports
  // has_more/next_cursor — must loop until exhausted rather than assuming
  // everything fits in one page.
  do {
    const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_size: NOTION_PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion query failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as NotionQueryResponse;
    pages.push(...body.results);
    cursor = body.has_more ? (body.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

export interface NotionPhoneSyncSummary {
  updated: number;
  unmatched: string[];
}

// Orchestration: queries every page of the Notion database, extracts
// {guestName, phone} from each via the pure function above, then updates
// the matching guest_contacts row by guest_name_normalized (same
// lookup-then-update pattern already established in ./finance-sync.ts's
// syncGuestContactsFromFinance — reused here rather than inventing a
// different one).
//
// If no matching guest_contacts row exists for a name found in Notion, that
// name is recorded as unmatched rather than inserted as a new bare row with
// only a phone and no other data — out of scope for this pass, same
// reasoning as finance-sync.ts never writing phone itself.
export async function syncPhonesFromNotion(): Promise<NotionPhoneSyncSummary> {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    throw new Error("NOTION_API_KEY/NOTION_DATABASE_ID are not set");
  }

  const pages = await fetchAllNotionPages(apiKey, databaseId);
  const supabase = createAdminClient();

  let updated = 0;
  const unmatched: string[] = [];

  for (const page of pages) {
    const extracted = extractGuestPhoneFromNotionPage(page.properties);
    if (!extracted) continue;

    const guestNameNormalized = extracted.guestName.trim().toLowerCase();

    const { data: existing, error: lookupError } = await supabase
      .from("guest_contacts")
      .select("id")
      .eq("guest_name_normalized", guestNameNormalized)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (!existing) {
      unmatched.push(extracted.guestName);
      continue;
    }

    const { error: updateError } = await supabase
      .from("guest_contacts")
      .update({ phone: extracted.phone, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    updated++;
  }

  return { updated, unmatched };
}
