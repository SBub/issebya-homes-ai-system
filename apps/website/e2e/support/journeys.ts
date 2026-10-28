import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { format } from "date-fns";
import {
  WISHLIST_DIALOG_HEADING,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_SAVE_LABEL,
  WISHLIST_SAVED_LABEL,
  WISHLIST_SUCCESS_COPY,
} from "@/lib/shop/wishlist";
import { createAdminClient } from "@/lib/shared/supabase";

// Steps the integration specs share, imported rather than copied. Not a spec
// file: Playwright's default testMatch only picks up *.spec.ts.

type Guest = { email: string; localNumber: string };

// The server-side Stripe call is mocked in-process (E2E_MOCK_STRIPE); this
// fulfils the browser's redirect to the mocked session URL.
export const mockStripeCheckout = (page: Page) =>
  page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Mock Stripe Checkout</body></html>",
    }),
  );

// guest_contacts is resolved by email, then by phone, so a fixed number
// would land on the shared contact other specs book against (and leave
// rows on) in the shared local Supabase. A random one keeps the row ours.
export const uniqueGuest = (emailPrefix = "e2e-"): Guest => ({
  email: `${emailPrefix}${randomUUID()}@example.com`,
  localNumber: `92${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
});

export const fillGuestDetails = async (page: Page, { email, localNumber }: Guest) => {
  await page.getByLabel(/^name/i).fill("Guest Example");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/whatsapp number/i).fill(localNumber);
};

export const confirmAndReachStripe = async (page: Page) => {
  await expect(page.getByLabel("Confirm booking")).toBeEnabled();
  await Promise.all([
    page.waitForURL("https://checkout.stripe.com/**"),
    page.getByLabel("Confirm booking").click(),
  ]);
};

// Enabled buttons only, to skip the outside-month duplicates of a day.
export const selectCalendarRange = async (page: Page, checkIn: Date, checkOut: Date) => {
  for (const day of [checkIn, checkOut]) {
    await page
      .locator(`button:not([disabled])[aria-label="${format(day, "MMMM d, yyyy")}"]`)
      .click();
  }
};

// Deletes every booking the guest's contact holds, then the contact.
export const deleteGuestBookings = async (email: string) => {
  const supabase = createAdminClient();
  const { data: contact } = await supabase
    .from("guest_contacts")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (!contact) return null;

  await supabase.from("bookings").delete().eq("guest_contact_id", contact.id);
  await supabase.from("guest_contacts").delete().eq("id", contact.id);
  return contact.id;
};

export const saveToWishlist = async (page: Page, slug: string, email: string) => {
  await page.goto(`/shop/${slug}`);
  await page.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: WISHLIST_DIALOG_HEADING });
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY, exact: true }).check();
  await dialog.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(WISHLIST_SUCCESS_COPY);
  await expect(
    page.getByRole("button", { name: WISHLIST_SAVED_LABEL, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
};
