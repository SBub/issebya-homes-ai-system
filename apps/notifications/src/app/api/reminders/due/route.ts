import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/notifications/auth";
import { pool } from "@/lib/notifications/db";
import { getDueReminders } from "@/lib/notifications/reminders";

/** Plain logic endpoint — no Telegram knowledge. apps/telegram-router calls this on its own schedule. */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const reminders = await getDueReminders(pool);
  return NextResponse.json({ reminders });
}
