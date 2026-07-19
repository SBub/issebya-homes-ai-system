import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { getModelo30Summary } from "@/lib/finance/reports-db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "Required: month (1–12) and year" }, { status: 400 });
  }

  try {
    const summary = await getModelo30Summary(year, month);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  }
}
