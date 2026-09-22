import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * E2E-test-only toggle for the iCal-failure MSW mock registered in
 * instrumentation.ts's `registerE2EMocks`. See that file's doc comment for
 * why this needs to be a runtime toggle rather than an always-on mock: an
 * ambient iCal error on every page load breaks the dates_unavailable test's
 * assertions via BookingClient.tsx's `if (error && !checkInDate)` early
 * return.
 *
 * Also revalidates `getAvailability`'s "use cache" tag for room1
 * (src/lib/availability.ts's `cacheTag("availability", "availability-room1")`,
 * `cacheLife("minutes")`) every time this flips. Confirmed by hand: Next's
 * `generateStaticParams` on the booking page (src/app/(main)/booking/[type]/
 * page.tsx) triggers one background prewarm call to `getAvailability` shortly
 * after the dev server boots — before this route can ever run — and that
 * result then serves every subsequent navigation for the rest of the
 * cache's lifetime. Toggling the mock without also busting that cache has
 * no visible effect at all; the booking page keeps serving whatever
 * `getAvailability` returned at boot, mock or no mock.
 *
 * 404s unless the E2E_MOCK_ICAL_FAILURE env var is set to "true" (set only
 * in playwright.config.ts's webServer.env for the Playwright-spawned dev
 * server) — this route is inert with zero effect on `yarn dev`/production,
 * where that var is unset.
 */
export async function POST(request: Request) {
  if (process.env.E2E_MOCK_ICAL_FAILURE !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  const enabled = Boolean(body?.enabled);

  (globalThis as { __e2eIcalShouldFail?: boolean }).__e2eIcalShouldFail = enabled;
  revalidateTag("availability-room1", { expire: 0 });

  return NextResponse.json({ ok: true, enabled });
}
