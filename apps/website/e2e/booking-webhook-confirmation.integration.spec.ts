import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { addDays, startOfDay } from "date-fns";
import { LOCK_IN_PRICING } from "pricing";
import Stripe from "stripe";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";
import { getLockInWeeks } from "@/lib/lock-in";
import { calculateLockInPrice, calculateTotalPrice, formatPrice } from "@/lib/price-utils";
import { createAdminClient } from "@/lib/shared/supabase";
import {
  confirmAndReachStripe,
  deleteGuestBookings,
  fillGuestDetails,
  mockStripeCheckout,
  pickFreeLockInWeek,
  uniqueGuest,
} from "./support/journeys";

// A paid booking end to end: the guest books in the real UI, the Stripe mock
// (E2E_MOCK_STRIPE) creates the session and the app writes a pending row,
// then this spec posts a signed checkout.session.completed event to the real
// webhook route and checks the booking ends confirmed with the right tourist
// tax, in the database and on the confirmation page.
//
// Date windows this spec owns: nightly room1 +200..+203, nightly room2
// +210..+213, the seeded pending room2 booking +220..+223 (bad signatures),
// and the latest free lock-in week of each room. They stay clear of the other
// specs: +10..+13 (booking-flow), +40..+43 (blog return fixture),
// +120..+147 (booking-confirmation), the earliest free lock-in week
// (lock-in-flow) and +300..+302 (the GCA link test).
//
// room2's availability cache cannot be expired from a spec: the webhook
// revalidates it on confirm, but the cleanup delete afterwards does not. An
// immediate re-run can therefore still see +210..+213 as booked for up to the
// cacheLife("minutes") window, and fails on the "Tourist tax" summary. Wait
// out the window and run again.

const today = startOfDay(new Date());
const day = (n: number) => toCalendarDay(addDays(today, n));

type RoomType = "room1" | "room2";
type Metadata = Record<string, string>;

// Read per test, not at module load, so the other specs in a full run still
// load without it.
function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set: the server and the Playwright process must both have it (apps/website/.env.development or an exported value)",
    );
  }
  return secret;
}

// fieldValue, priceRow and confirmationUrl are copied on purpose from
// booking-confirmation.integration.spec.ts, so neither spec depends on the other.
function fieldValue(page: Page, label: string) {
  return page.locator(`label:text-is("${label}")`).locator("..").locator("p");
}

function priceRow(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..");
}

function confirmationUrl(sessionId: string) {
  return `/booking/confirmation?session=${encodeURIComponent(sessionId)}`;
}

// Copied from lock-in-flow.integration.spec.ts: the E2E iCal toggle route
// expires room1's availability tag; `enabled: false` leaves the feeds alone.
const expireRoom1Availability = async (request: APIRequestContext) => {
  const response = await request.post("/api/e2e-ical-mock", { data: { enabled: false } });
  expect(response.ok()).toBe(true);
};

// The event body the webhook route reads: only data.object's id,
// payment_intent and metadata matter to it.
function buildCompletedEvent(sessionId: string, paymentIntent: string, metadata: Metadata) {
  return JSON.stringify({
    id: `evt_test_e2e_${randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    api_version: "2025-08-27.basil",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        status: "complete",
        payment_status: "paid",
        payment_intent: paymentIntent,
        metadata,
      },
    },
  });
}

const signBody = (body: string, secret: string) =>
  Stripe.webhooks.generateTestHeaderString({ payload: body, secret });

// A string `data` goes out verbatim, so the signed bytes are the posted bytes.
const postWebhook = (request: APIRequestContext, body: string, signature?: string) =>
  request.post("/api/webhook/stripe", {
    data: body,
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
  });

async function contactFor(email: string) {
  const { data, error } = await createAdminClient()
    .from("guest_contacts")
    .select("id, phone")
    .eq("email", email)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function bookingsFor(contactId: string) {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select(
      "id, room_type, check_in, check_out, nights, person_count, base_price, tourist_tax, total_amount, status, stripe_session_id, payment_intent, source",
    )
    .eq("guest_contact_id", contactId);
  expect(error).toBeNull();
  return data!;
}

type BookingRow = Awaited<ReturnType<typeof bookingsFor>>[number];

// Rebuilds the metadata createCheckout sends, every value a string. The
// numeric columns go through Number first, so "12" and not "12.00".
function metadataFrom(
  row: BookingRow,
  guest: { email: string; guestName: string; phone: string },
  whatsappOptIn: boolean,
): Metadata {
  return {
    roomType: row.room_type,
    checkIn: row.check_in,
    checkOut: row.check_out,
    personCount: String(Number(row.person_count)),
    email: guest.email,
    nights: String(Number(row.nights)),
    basePrice: String(Number(row.base_price)),
    touristTax: String(Number(row.tourist_tax)),
    total: String(Number(row.total_amount)),
    guestName: guest.guestName,
    phone: guest.phone,
    whatsappOptIn: String(whatsappOptIn),
    source: "direct",
  };
}

type Expected = { checkIn: string; checkOut: string; nights: number; touristTax: number };

// Shared by the four happy-path tests: `book` drives the UI up to the guest
// form; this fills it, reaches Stripe, asserts the pending row, posts the
// signed event, asserts the confirmed row and opens the confirmation page.
// Returns the confirmed row for the per-test assertions.
async function bookAndConfirm(
  page: Page,
  request: APIRequestContext,
  room: RoomType,
  expected: Expected,
): Promise<BookingRow> {
  const secret = webhookSecret();
  const guest = uniqueGuest("e2e-webhook-");

  await fillGuestDetails(page, guest);
  const optIn = await page.locator('input[name="whatsappOptIn"]').isChecked();

  try {
    // The first DB write, so inside the try: a failure here still cleans up.
    await confirmAndReachStripe(page);

    const contact = await contactFor(guest.email);
    const pendingRows = await bookingsFor(contact.id);
    expect(pendingRows).toHaveLength(1);
    const pending = pendingRows[0];
    expect(pending).toMatchObject({
      status: "pending",
      payment_intent: null,
      check_in: expected.checkIn,
      check_out: expected.checkOut,
      nights: expected.nights,
    });
    expect(pending.stripe_session_id).toMatch(/^cs_test_e2e_/);
    expect(Number(pending.tourist_tax)).toBe(expected.touristTax);

    const sessionId = pending.stripe_session_id!;
    const paymentIntent = `pi_test_e2e_${randomUUID()}`;
    const metadata = metadataFrom(
      pending,
      { email: guest.email, guestName: "Guest Example", phone: contact.phone },
      optIn,
    );
    const body = buildCompletedEvent(sessionId, paymentIntent, metadata);
    const response = await postWebhook(request, body, signBody(body, secret));
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const confirmedRows = await bookingsFor(contact.id);
    expect(confirmedRows).toHaveLength(1);
    const confirmed = confirmedRows[0];
    expect(confirmed).toMatchObject({
      id: pending.id,
      status: "confirmed",
      payment_intent: paymentIntent,
    });

    await page.goto(confirmationUrl(sessionId));
    await expect(page.getByRole("heading", { level: 1, name: "Booking Confirmed" })).toBeVisible();

    return confirmed;
  } finally {
    await deleteGuestBookings(guest.email);
    if (room === "room1") await expireRoom1Availability(request);
  }
}

test.describe("Booking to confirmed booking through the Stripe webhook", () => {
  for (const [room, offset] of [
    ["room1", 200],
    ["room2", 210],
  ] as const) {
    test(`a nightly stay is confirmed with its tourist tax (${room})`, async ({
      page,
      request,
    }) => {
      webhookSecret();
      const checkIn = day(offset);
      const checkOut = day(offset + 3);
      const expected = calculateTotalPrice(fromCalendarDay(checkIn), fromCalendarDay(checkOut), 2);
      // Guards the fixture itself: a 3-night window.
      expect(expected.nights).toBe(3);

      await mockStripeCheckout(page);
      await page.goto(`/booking/${room}?checkIn=${checkIn}&checkOut=${checkOut}`);
      await page.getByLabel("Book selected dates").click();
      await expect(page.getByLabel("Confirm booking")).toBeVisible();
      await page.getByLabel("Increase number of persons").click();

      // The full substring: the engine also has a bare "Tourist tax" footnote
      // link. Visible only if the URL range was accepted.
      await expect(
        page.getByText(`Tourist tax: ${formatPrice(expected.touristTax)}`),
      ).toBeVisible();

      const confirmed = await bookAndConfirm(page, request, room, {
        checkIn,
        checkOut,
        nights: expected.nights,
        touristTax: expected.touristTax,
      });

      expect(Number(confirmed.tourist_tax)).toBeGreaterThan(0);
      expect(Number(confirmed.tourist_tax)).toBe(expected.touristTax);
      expect(Number(confirmed.total_amount)).toBe(expected.total);
      expect(confirmed.nights).toBe(expected.nights);
      expect(confirmed.person_count).toBe(2);

      await expect(priceRow(page, "Tourist tax")).toContainText(`€${expected.touristTax}`);
      await expect(priceRow(page, "Total")).toContainText(`€${expected.total}`);
    });
  }

  for (const room of ["room1", "room2"] as const) {
    test(`a lock-in week is confirmed with no tourist tax (${room})`, async ({ page, request }) => {
      webhookSecret();
      const expected = calculateLockInPrice();

      await mockStripeCheckout(page);
      await page.goto(`/lock-in/${room}`);
      await expect(page.locator(".lock-in-week")).toHaveCount(12);

      // The latest free week: lock-in-flow takes the earliest.
      const picked = await pickFreeLockInWeek(page, [...getLockInWeeks(new Date())].reverse());

      const confirmed = await bookAndConfirm(page, request, room, {
        checkIn: picked.checkIn,
        checkOut: picked.checkOut,
        nights: expected.nights,
        touristTax: 0,
      });

      // The one allowed literal: a lock-in carries no tourist tax.
      expect(Number(confirmed.tourist_tax)).toBe(0);
      expect(Number(confirmed.total_amount)).toBe(LOCK_IN_PRICING.weekPrice);

      await expect(fieldValue(page, "Nights")).toHaveText("7");
      await expect(priceRow(page, "Total")).toContainText(`€${LOCK_IN_PRICING.weekPrice}`);
      // Checked after the heading is visible, so the page has rendered.
      await expect(page.getByText("Tourist tax")).toHaveCount(0);
    });
  }

  test("bad signatures are rejected and the booking stays pending (room2)", async ({ request }) => {
    const secret = webhookSecret();
    const supabase = createAdminClient();
    const email = `e2e-webhook-${randomUUID()}@example.com`;
    const phone = `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`;
    const checkIn = day(220);
    const checkOut = day(223);
    const price = calculateTotalPrice(fromCalendarDay(checkIn), fromCalendarDay(checkOut), 1);

    const { data: guestContact, error: guestContactError } = await supabase
      .from("guest_contacts")
      .insert({ phone, email, guest_name: "Guest Example", enabled: false })
      .select("id")
      .single();

    if (guestContactError || !guestContact) {
      throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
    }

    const sessionId = `cs_test_e2e_webhook_${randomUUID()}`;
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        room_type: "room2",
        check_in: checkIn,
        check_out: checkOut,
        nights: price.nights,
        person_count: 1,
        base_price: price.basePrice,
        tourist_tax: price.touristTax,
        total_amount: price.total,
        guest_contact_id: guestContact.id,
        source: "direct",
        stripe_session_id: sessionId,
        status: "pending",
      })
      .select("id")
      .single();

    if (bookingError || !booking) {
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      throw new Error(`Failed to seed pending booking fixture: ${bookingError?.message}`);
    }

    const expectStillPending = async () => {
      const rows = await bookingsFor(guestContact.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: booking.id, status: "pending", payment_intent: null });
      return rows[0];
    };

    try {
      const seeded = await expectStillPending();
      const metadata = metadataFrom(seeded, { email, guestName: "Guest Example", phone }, false);
      const paymentIntent = `pi_test_e2e_${randomUUID()}`;
      const body = buildCompletedEvent(sessionId, paymentIntent, metadata);
      const header = signBody(body, secret);

      const unsigned = await postWebhook(request, body);
      expect(unsigned.status()).toBe(400);
      expect(await unsigned.json()).toEqual({ error: "Missing stripe-signature header" });
      await expectStillPending();

      const wrongSecret = await postWebhook(
        request,
        body,
        signBody(body, "whsec_e2e_wrong_secret"),
      );
      expect(wrongSecret.status()).toBe(400);
      expect(await wrongSecret.json()).toEqual({ error: "Invalid signature" });
      await expectStillPending();

      const tamperedBody = buildCompletedEvent(sessionId, `pi_test_e2e_${randomUUID()}`, metadata);
      const tampered = await postWebhook(request, tamperedBody, header);
      expect(tampered.status()).toBe(400);
      expect(await tampered.json()).toEqual({ error: "Invalid signature" });
      await expectStillPending();

      // Control: the original body with its correct header goes through.
      const valid = await postWebhook(request, body, header);
      expect(valid.status()).toBe(200);
      expect(await valid.json()).toEqual({ received: true });
      const rows = await bookingsFor(guestContact.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: booking.id,
        status: "confirmed",
        payment_intent: paymentIntent,
      });
    } finally {
      await supabase.from("bookings").delete().eq("id", booking.id);
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      // upsertGuestContact matches the seeded contact by email; this covers
      // anything the control post attached to it.
      await deleteGuestBookings(email);
    }
  });
});
