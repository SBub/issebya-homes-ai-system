import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { syncGuestContactsFromFinance } from "@/lib/finance-sync";
import { pushGuestContactsToNotion } from "@/lib/notion-guest-contacts-sync";
import { syncPhonesFromNotion } from "@/lib/notion-phone-sync";

/**
 * Plain logic endpoint — no finance-app knowledge. apps/finance calls this
 * after every successful CSV import (see its
 * src/app/api/finance/import/route.ts) to keep guest_contacts fresh without
 * apps/finance reaching into GCA's tables directly, and without this route
 * calling back into apps/finance — finance pushes a "sync now" request,
 * GCA does its own existing DB work.
 *
 * Runs the full guest_contacts <-> Notion round trip, in this exact order —
 * NOT arbitrary, don't reorder for convenience:
 *
 *   1. syncPhonesFromNotion()        — pull first
 *   2. syncGuestContactsFromFinance() — finance-refresh second
 *   3. pushGuestContactsToNotion()    — push last
 *
 * Step 1 pulls any phone numbers a human has manually typed into the Guest
 * Contacts Notion database into guest_contacts FIRST. Step 2 refreshes
 * name/room/dates/total_stays from finance_bookings SECOND — this never
 * touches phone, so step 1's phone values survive it. Step 3 pushes the
 * now-fully-merged state (finance-derived facts + whatever phone survived
 * step 1) out to Notion LAST.
 *
 * If step 3 ran before step 1, it would overwrite a phone number the user
 * just typed into Notion with whatever was already in Postgres (null, most
 * likely) before this run even started — silently erasing their manual
 * edit. This ordering is what prevents that.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const phonesPulled = await syncPhonesFromNotion();
    const financeSync = await syncGuestContactsFromFinance();
    const notionPush = await pushGuestContactsToNotion();

    return NextResponse.json({
      phones_pulled: phonesPulled,
      finance_sync: financeSync,
      notion_push: notionPush,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
