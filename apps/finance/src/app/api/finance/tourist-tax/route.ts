import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { getTouristTaxReport } from "@/lib/finance/reports-db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const quarter = Number(searchParams.get("quarter"));
  const year = Number(searchParams.get("year"));

  if (!quarter || !year || quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: "Required: quarter (1–4) and year" }, { status: 400 });
  }

  try {
    const { buffer, filename } = await getTouristTaxReport(quarter, year);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DB error" },
      { status: 500 },
    );
  }
}
