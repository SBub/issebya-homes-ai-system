import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, format, startOfDay } from "date-fns";
import { createAdminClient } from "@/lib/shared/supabase";

// Generate future dates relative to today so tests don't go stale
const today = startOfDay(new Date());
const checkInDate = addDays(today, 10);
const checkOutDate = addDays(today, 13);

const checkInLabel = format(checkInDate, "MMMM d, yyyy");
const checkOutLabel = format(checkOutDate, "MMMM d, yyyy");
const checkInISO = format(checkInDate, "yyyy-MM-dd");
const checkOutISO = format(checkOutDate, "yyyy-MM-dd");

test.describe("Booking flow", () => {
  test("user sees available dates and booking form after page loads", async ({ page }) => {
    // Availability used to be fetched client-side from /api/availability and
    // was mocked here via page.route() — that endpoint is dead now:
    // BookingEngine (an async Server Component, src/app/(main)/booking/
    // [type]/ui/BookingEngine.tsx) calls getAvailability() directly,
    // server-side, with no client-side fetch left to intercept. Rather than
    // keep a mock that silently does nothing, this now exercises the real
    // local dev data (real Supabase `bookings` table + whatever the
    // configured iCal feeds return).
    //
    // The assertions below only check that the collapsed booking UI renders
    // with *some* default dates, not specific ones — getAvailability always
    // resolves to *a* firstAvailable range (see findFirstAvailableNights in
    // src/lib/date-utils.ts), so this stays deterministic regardless of the
    // current local booking/iCal state.
    await page.goto("/booking/room1");

    // Collapsed booking engine shows pre-selected dates
    await expect(page.getByLabel("Select check-in date")).toBeVisible();
    await expect(page.getByLabel("Select check-out date")).toBeVisible();
    await expect(page.getByLabel("Book selected dates")).toBeVisible();
  });

  test("full booking flow: select dates → enter email → redirect to Stripe", async ({ page }) => {
    // submitBooking (src/app/(main)/booking/[type]/actions.ts) is a real
    // Server Action now, invoked via <form action={formAction}>. Its
    // response is a Flight-encoded RSC stream, not plain JSON — page.route()
    // can't fulfill that at the browser level. What actually needs mocking
    // is the server-side Stripe call the action makes
    // (stripe.checkout.sessions.create, POST
    // https://api.stripe.com/v1/checkout/sessions), which runs inside the
    // `yarn dev` process Playwright spawns — invisible to page.route(). That
    // call is mocked by an in-process MSW server started from
    // instrumentation.ts, gated on E2E_MOCK_STRIPE=true (set only for this
    // Playwright run via playwright.config.ts's webServer.env).
    //
    // The mocked session's `url` still triggers a real browser navigation
    // (window.location.href in BookingEngineExpanded's success handler) —
    // that part IS visible to page.route(), and is fulfilled below with a
    // fake page so the test never touches real Stripe infrastructure.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Mock Stripe Checkout</body></html>",
      }),
    );

    await page.goto("/booking/room1");

    // Expand the booking engine
    await page.getByLabel("Book selected dates").click();

    // Wait for calendar to be visible
    await expect(page.getByLabel("Confirm booking")).toBeVisible();

    // Select check-in and check-out dates (use enabled buttons to avoid outside-month duplicates)
    await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
    await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();

    // Enter guest details
    await page.getByLabel(/^name/i).fill("Guest Example");
    await page.getByLabel(/email/i).fill("guest@example.com");
    await page.getByLabel(/whatsapp number/i).fill("920742845");

    // Book button should be enabled
    await expect(page.getByLabel("Confirm booking")).toBeEnabled();

    // Click book — should navigate to the (mocked) Stripe checkout page
    await Promise.all([
      page.waitForURL("https://checkout.stripe.com/**"),
      page.getByLabel("Confirm booking").click(),
    ]);
  });

  test("user sees error when dates are no longer available", async ({ page }) => {
    // submitBooking's dates_unavailable branch is reached BEFORE any Stripe
    // call — triggered by checkAvailability finding a real overlapping
    // status: 'confirmed' row in the `bookings` table for the same
    // room/dates. No Flight-response mocking needed at all here: this seeds
    // a real conflicting booking directly via an admin Supabase client, so
    // the test exercises the actual server-side conflict-detection (and
    // cache-invalidation) path rather than a synthetic one.
    const supabase = createAdminClient();

    const { data: guestContact, error: guestContactError } = await supabase
      .from("guest_contacts")
      .insert({
        // guest_contacts has independent UNIQUE constraints on both `phone`
        // and `email` — randomUUID() keeps this fixture from colliding with
        // any other guest_contacts row across repeated test runs.
        phone: `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`,
        email: `e2e-conflict-${randomUUID()}@example.com`,
        guest_name: "E2E Conflict Fixture",
        enabled: false,
      })
      .select("id")
      .single();

    if (guestContactError || !guestContact) {
      throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
    }

    const { data: conflictBooking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        room_type: "room1",
        check_in: checkInISO,
        check_out: checkOutISO,
        nights: 3,
        person_count: 1,
        base_price: 100,
        tourist_tax: 10,
        total_amount: 110,
        guest_contact_id: guestContact.id,
        source: "direct",
        stripe_session_id: `cs_test_e2e_conflict_${randomUUID()}`,
        status: "confirmed",
      })
      .select("id")
      .single();

    if (bookingError || !conflictBooking) {
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      throw new Error(`Failed to seed conflicting booking fixture: ${bookingError?.message}`);
    }

    try {
      await page.goto("/booking/room1");

      // Expand, select the exact dates that collide with the seeded booking,
      // and enter guest details
      await page.getByLabel("Book selected dates").click();
      await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
      await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();
      await page.getByLabel(/^name/i).fill("Guest Example");
      await page.getByLabel(/email/i).fill("guest@example.com");
      await page.getByLabel(/whatsapp number/i).fill("920742845");

      // Click book
      await page.getByLabel("Confirm booking").click();

      // User sees the real dates_unavailable error...
      await expect(page.getByText(/these dates were just booked by someone else/i)).toBeVisible();

      // ...and the calendar has refreshed: the collapsed date selections
      // were cleared back to their placeholder state (updateAvailability in
      // BookingClient.tsx resets checkInDate/checkOutDate to null once the
      // action returns a fresh blockedDates snapshot).
      await expect(page.getByLabel("Select check-in date")).toHaveText(/select date/i);
      await expect(page.getByLabel("Select check-out date")).toHaveText(/select date/i);
    } finally {
      await supabase.from("bookings").delete().eq("id", conflictBooking.id);
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
    }
  });

  test("user sees error when some iCal feeds fail to fetch", async ({ page, request }) => {
    // getAvailability (src/lib/availability.ts) sets a non-fatal `error`
    // string when some configured iCal feeds fail to fetch/parse, while
    // still succeeding overall — that string flows down as a prop and is
    // rendered inside the expanded booking form (see the
    // `{(error || bookingError) && ...}` block in BookingEngineExpanded.tsx).
    //
    // This used to be tested by mocking a client-side /api/availability
    // fetch via page.route(), asserting an error string that actually came
    // from useAvailabilityQuery's React Query error handling — that hook,
    // and the client-side fetch it wrapped, are both gone; availability is
    // fetched server-side only now, so that whole path no longer exists.
    //
    // Reaching the *current* error path deterministically needs a
    // server-side iCal fetch to fail inside the `yarn dev` process itself —
    // invisible to page.route(). That's done via the same in-process MSW
    // server as the Stripe mock above, gated on the E2E_MOCK_ICAL_FAILURE
    // env var (see instrumentation.ts and playwright.config.ts), which
    // registers a mock for the configured ROOM1_ICAL_AIRBNB feed request
    // while the Supabase read (and any other feed) is untouched — a real
    // partial-failure, not a full outage, and not something that ever makes
    // getAvailability throw (mergeMultipleFeeds/getOwnBookings both catch
    // their own errors), so the full-failure ErrorBoundary fallback in
    // page.tsx isn't realistically reachable this way and isn't what this
    // test targets.
    //
    // The mock is only actually forced via the E2E-only POST
    // /api/e2e-ical-mock toggle (src/app/api/e2e-ical-mock/route.ts) — it
    // can't just be left on for the whole run: the resulting ambient
    // `error` is present on every booking page load, and the
    // dates_unavailable test above breaks if it's active (see
    // instrumentation.ts's doc comment for the exact interaction). That
    // route also busts getAvailability's "use cache" tag for room1 — without
    // that, this toggle would have no effect: generateStaticParams on the
    // booking page triggers one background prewarm call to getAvailability
    // shortly after the dev server boots, and that result would otherwise
    // serve every navigation for the rest of the cache's lifetime regardless
    // of this toggle. Toggled off again in `finally` so it doesn't leak into
    // any test that runs after this one.
    const toggle = await request.post("/api/e2e-ical-mock", { data: { enabled: true } });
    expect(toggle.ok()).toBe(true);

    try {
      await page.goto("/booking/room1");

      // Expand the form — the partial-failure error only renders inside it
      await page.getByLabel("Book selected dates").click();

      await expect(page.getByText(/some availability data could not be fetched/i)).toBeVisible();
    } finally {
      await request.post("/api/e2e-ical-mock", { data: { enabled: false } });
    }
  });
});
