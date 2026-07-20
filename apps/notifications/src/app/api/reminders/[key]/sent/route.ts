import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/notifications/auth";
import { pool } from "@/lib/notifications/db";
import { recordSent } from "@/lib/notifications/reminders";

/** Records that a reminder was just sent, pacing re-nags via renotify_every. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const messageId = typeof body?.messageId === "number" ? body.messageId : null;
  if (messageId === null) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  const { key } = await params;
  const found = await recordSent(pool, key, messageId);
  if (!found) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
