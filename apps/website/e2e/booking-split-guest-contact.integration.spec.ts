import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, format, startOfDay } from "date-fns";
import { createAdminClient } from "@/lib/shared/supabase";

// Distinct from booking-flow.integration.spec.ts's range so the two specs
// don't interfere through availability.
const today = startOfDay(new Date());
const checkInLabel = format(addDays(today, 20), "MMMM d, yyyy");
const checkOutLabel = format(addDays(today, 22), "MMMM d, yyyy");

test.describe("Booking with a split guest contact", () => {
  test("phone on one guest_contacts row and email on another still reaches Stripe", async ({
    page,
  }) => {
    // The issue-199 shape: GCA created a phone-keyed row from WhatsApp, a
    // past booking created an email-keyed row, and the guest now books with
    // both. upsertGuestContact (src/lib/shared/guest-contacts.ts) must link
    // the booking to the email row without writing the phone onto it, which
    // would violate guest_contacts_phone_key, and leave the phone row alone.
    // Runs against the real local Postgres constraints the unit stub only
    // simulates. Stripe is mocked the same way as in booking-flow's
    // "full booking flow" test (E2E_MOCK_STRIPE + page.route below).
    const supabase = createAdminClient();

    const nineDigits = randomUUID().replace(/\D/g, "").padEnd(9, "0").slice(0, 9);
    const phone = `+351${nineDigits}`;
    const phoneRowEmail = `e2e-split-phone-${randomUUID()}@example.com`;
    const email = `e2e-split-${randomUUID()}@example.com`;

    const { data: phoneRow, error: phoneRowError } = await supabase
      .from("guest_contacts")
      .insert({ phone, email: phoneRowEmail, guest_name: "E2E Split Phone Row", enabled: false })
      .select("id")
      .single();

    if (phoneRowError || !phoneRow) {
      throw new Error(`Failed to seed phone guest_contacts row: ${phoneRowError?.message}`);
    }

    const { data: emailRow, error: emailRowError } = await supabase
      .from("guest_contacts")
      .insert({ phone: null, email, guest_name: "E2E Split Email Row", enabled: false })
      .select("id")
      .single();

    if (emailRowError || !emailRow) {
      await supabase.from("guest_contacts").delete().eq("id", phoneRow.id);
      throw new Error(`Failed to seed email guest_contacts row: ${emailRowError?.message}`);
    }

    const seededIds = [phoneRow.id, emailRow.id];

    try {
      await page.route("https://checkout.stripe.com/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html><body>Mock Stripe Checkout</body></html>",
        }),
      );

      await page.goto("/booking/room1");
      await page.getByLabel("Book selected dates").click();
      await expect(page.getByLabel("Confirm booking")).toBeVisible();

      await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
      await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();

      await page.getByLabel(/^name/i).fill("Split Guest");
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/whatsapp number/i).fill(nineDigits);

      // Before the fix: "Failed to create checkout session" and no navigation.
      await Promise.all([
        page.waitForURL("https://checkout.stripe.com/**"),
        page.getByLabel("Confirm booking").click(),
      ]);

      const { data: phoneRowAfter } = await supabase
        .from("guest_contacts")
        .select("phone, email")
        .eq("id", phoneRow.id)
        .single();
      expect(phoneRowAfter).toEqual({ phone, email: phoneRowEmail });

      const { data: emailRowAfter } = await supabase
        .from("guest_contacts")
        .select("phone")
        .eq("id", emailRow.id)
        .single();
      expect(emailRowAfter?.phone).toBeNull();

      const { data: bookings } = await supabase
        .from("bookings")
        .select("guest_contact_id, status")
        .in("guest_contact_id", seededIds);
      expect(bookings).toEqual([{ guest_contact_id: emailRow.id, status: "pending" }]);
    } finally {
      await supabase.from("bookings").delete().in("guest_contact_id", seededIds);
      await supabase.from("guest_contacts").delete().in("id", seededIds);
    }
  });
});
