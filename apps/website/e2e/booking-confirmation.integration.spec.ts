import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays, startOfDay } from "date-fns";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";
import { createAdminClient } from "@/lib/shared/supabase";

const today = startOfDay(new Date());

// Mirrors formatDate in the confirmation page: the stored calendar day read at
// local midnight, rendered en-GB.
function formatDay(day: string): string {
  return fromCalendarDay(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type BookingFixture = {
  roomType: "room1" | "room2";
  checkIn: string;
  checkOut: string;
  nights: number;
  personCount: number;
  basePrice: number;
  touristTax: number;
  totalAmount: number;
};

type RoomType = BookingFixture["roomType"];

// Days +120 onwards clear every other spec's window: room1 +10..+13
// (booking-flow, blog-booking-flow) and room2 +40..+43 (the blog return
// fixture). Each room gets its own window: room1 +120..+123, room2
// +124..+127.
const nightlyOffset: Record<RoomType, number> = { room1: 120, room2: 124 };

function nightlyStay(roomType: RoomType): BookingFixture {
  const start = nightlyOffset[roomType];
  return {
    roomType,
    checkIn: toCalendarDay(addDays(today, start)),
    checkOut: toCalendarDay(addDays(today, start + 3)),
    nights: 3,
    personCount: 2,
    basePrice: 300,
    touristTax: 12,
    totalAmount: 312,
  };
}

// The fixture is a *confirmed* booking on purpose: /api/bookings/direct only
// calls stripe.checkout.sessions.retrieve for a `pending` or missing row, and
// E2E_MOCK_STRIPE does not mock that call. A confirmed row is served straight
// from the database, so this spec never reaches Stripe.
async function seedConfirmedBooking(fixture: BookingFixture) {
  const supabase = createAdminClient();
  const email = `e2e-confirmation-${randomUUID()}@example.com`;

  const { data: guestContact, error: guestContactError } = await supabase
    .from("guest_contacts")
    .insert({
      // Both `phone` and `email` are independently UNIQUE on guest_contacts,
      // so both are randomised per run.
      phone: `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`,
      email,
      guest_name: "E2E Confirmation Fixture",
      enabled: false,
    })
    .select("id")
    .single();

  if (guestContactError || !guestContact) {
    throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
  }

  const sessionId = `cs_test_e2e_confirmation_${randomUUID()}`;
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      room_type: fixture.roomType,
      check_in: fixture.checkIn,
      check_out: fixture.checkOut,
      nights: fixture.nights,
      person_count: fixture.personCount,
      base_price: fixture.basePrice,
      tourist_tax: fixture.touristTax,
      total_amount: fixture.totalAmount,
      guest_contact_id: guestContact.id,
      source: "direct",
      stripe_session_id: sessionId,
      status: "confirmed",
    })
    .select("id")
    .single();

  if (bookingError || !booking) {
    await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
    throw new Error(`Failed to seed confirmed booking fixture: ${bookingError?.message}`);
  }

  return {
    sessionId,
    email,
    cleanup: async () => {
      await supabase.from("bookings").delete().eq("id", booking.id);
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
    },
  };
}

// Each detail is a <dt> term with its value in the <dd> right after it.
function fieldValue(page: Page, label: string) {
  return page.locator(`dt:text-is("${label}")`).locator("+ dd");
}

// A price row is a <div> holding a <dt> label and a <dd> amount.
function priceRow(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..");
}

function confirmationUrl(sessionId: string) {
  return `/booking/confirmation?session=${encodeURIComponent(sessionId)}`;
}

test.describe("Booking confirmation page", () => {
  for (const roomType of ["room1", "room2"] as const) {
    const roomName = roomType === "room1" ? "Room 1" : "Room 2";

    test(`a nightly stay shows the tourist tax row (${roomType})`, async ({ page }) => {
      const fixture = nightlyStay(roomType);
      const { sessionId, email, cleanup } = await seedConfirmedBooking(fixture);

      try {
        await page.goto(confirmationUrl(sessionId));

        await expect(
          page.getByRole("heading", { level: 1, name: "Booking Confirmed" }),
        ).toBeVisible();
        await expect(page.getByText("Thank you for your reservation")).toBeVisible();

        await expect(fieldValue(page, "Room")).toHaveText(roomName);
        await expect(fieldValue(page, "Check-in")).toHaveText(formatDay(fixture.checkIn));
        await expect(fieldValue(page, "Check-out")).toHaveText(formatDay(fixture.checkOut));
        await expect(fieldValue(page, "Nights")).toHaveText("3");
        await expect(fieldValue(page, "Guests")).toHaveText("2 Guests");

        await expect(priceRow(page, "Room price")).toContainText("€300");
        await expect(priceRow(page, "Tourist tax")).toContainText("€12");
        await expect(priceRow(page, "Total")).toContainText("€312");

        // The email comes from the guest_contacts join, flattened by the route.
        await expect(page.getByText(/A confirmation email has been sent to/)).toContainText(email);

        await expect(page.getByRole("img", { name: roomName })).toBeVisible();
        await expect(page.getByTestId("return-to-post")).toHaveCount(0);
      } finally {
        await cleanup();
      }
    });
  }

  test.describe("on a mobile viewport", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("the details render and the room photo is hidden", async ({ page }) => {
      const { sessionId, cleanup } = await seedConfirmedBooking(nightlyStay("room1"));

      try {
        await page.goto(confirmationUrl(sessionId));

        await expect(
          page.getByRole("heading", { level: 1, name: "Booking Confirmed" }),
        ).toBeVisible();
        await expect(fieldValue(page, "Room")).toHaveText("Room 1");
        await expect(fieldValue(page, "Nights")).toHaveText("3");
        await expect(fieldValue(page, "Guests")).toHaveText("2 Guests");
        await expect(priceRow(page, "Total")).toContainText("€312");

        // The photo column is `hidden md:flex`: display none below md.
        await expect(page.getByRole("img", { name: "Room 1" })).toBeHidden();
      } finally {
        await cleanup();
      }
    });
  });

  test.describe("without a session", () => {
    // No status assertion: the page streams behind loading.tsx, so the
    // response can be committed as 200 before notFound() runs. The rendered
    // not-found text is the stable signal.
    for (const url of ["/booking/confirmation", "/booking/confirmation?session="]) {
      test(`${url} renders not found`, async ({ page }) => {
        await page.goto(url);

        await expect(page.getByText("This page could not be found.")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Booking Confirmed" })).toHaveCount(0);
      });
    }
  });
});
