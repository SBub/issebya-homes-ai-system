import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/notifications/auth";
import { pool } from "@/lib/notifications/db";
import { acknowledgeReminder } from "@/lib/notifications/reminders";

/** Stops a reminder from ever (re)sending again. Called when the "✅ Done" button is pressed. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { key } = await params;
  const found = await acknowledgeReminder(pool, key);
  if (!found) {
    return NextResponse.json({ error: "not found or already acknowledged" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
