import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { syncGuestContactsFromFinance } from "@/lib/finance-sync";

/**
 * Plain logic endpoint — no finance-app knowledge. apps/finance calls this
 * after every successful CSV import (see its
 * src/app/api/finance/import/route.ts) to keep guest_contacts fresh without
 * apps/finance reaching into GCA's tables directly, and without this route
 * calling back into apps/finance — finance pushes a "sync now" request,
 * GCA does its own existing DB work (syncGuestContactsFromFinance, the same
 * function the sync:guest-contacts CLI script already calls manually).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const summary = await syncGuestContactsFromFinance();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
