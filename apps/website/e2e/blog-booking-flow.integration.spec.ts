import { expect, test } from "@playwright/test";
import { addDays, format, startOfDay } from "date-fns";

// Generate future dates relative to today so tests don't go stale
const today = startOfDay(new Date());
const checkInLabel = format(addDays(today, 10), "MMMM d, yyyy");
const checkOutLabel = format(addDays(today, 13), "MMMM d, yyyy");

const WIDGET_POST = "/blog/a-weekend-in-almocageme";
const NEWER_POST_TITLE = "A weekend in Almoçageme";
const OLDER_POST_TITLE = "House notes: the shared kitchen";

test.describe("Blog with an inline booking widget", () => {
  test("index lists posts newest first", async ({ page }) => {
    await page.goto("/blog");

    const titles = page.locator("article, li h2");
    await expect(page.getByRole("heading", { name: NEWER_POST_TITLE })).toBeVisible();
    await expect(page.getByRole("heading", { name: OLDER_POST_TITLE })).toBeVisible();

    // Both posts carry a `date` in their frontmatter and the registry sorts on
    // it, so DOM order is the assertion: the 2026-08 post must precede the
    // 2026-07 one.
    const headings = await titles.allTextContents();
    expect(headings.indexOf(NEWER_POST_TITLE)).toBeLessThan(headings.indexOf(OLDER_POST_TITLE));
  });

  test("booking completes from inside a post", async ({ page }) => {
    // Same mocking story as e2e/booking-flow.integration.spec.ts: the
    // server-side Stripe call is intercepted in-process by MSW (gated on
    // E2E_MOCK_STRIPE, set by playwright.config.ts), and the browser-level
    // navigation to the returned checkout URL is fulfilled here so the test
    // never reaches real Stripe.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Mock Stripe Checkout</body></html>",
      }),
    );

    await page.goto(WIDGET_POST);

    // The widget renders inside the article, not as a link out to /booking.
    const widget = page.getByTestId("booking-widget");
    await expect(widget).toBeVisible();
    await expect(page.locator("article").getByTestId("booking-widget")).toBeVisible();

    await page.getByLabel("Book selected dates").click();
    await expect(page.getByLabel("Confirm booking")).toBeVisible();

    await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
    await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();

    await page.getByLabel(/^name/i).fill("Guest Example");
    await page.getByLabel(/email/i).fill("guest@example.com");
    await page.getByLabel(/whatsapp number/i).fill("920742845");

    await expect(page.getByLabel("Confirm booking")).toBeEnabled();

    // Same destination a booking from /booking/[type] reaches, which is the
    // point of this test: the widget is the same engine, action and checkout.
    await Promise.all([
      page.waitForURL("https://checkout.stripe.com/**"),
      page.getByLabel("Confirm booking").click(),
    ]);
  });

  test("switching rooms issues no request", async ({ page }) => {
    await page.goto(WIDGET_POST);
    await expect(page.getByLabel("Book selected dates")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Both rooms' engines are props on the client switcher, so both are
    // already in the static payload. This is the observable form of that: no
    // availability fetch and no RSC round trip on a room switch.
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.getByRole("tab", { name: "room 2" }).click();
    await expect(page.getByRole("tab", { name: "room 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    expect(requests.filter((url) => url.includes("/api/availability"))).toEqual([]);
    expect(requests.filter((url) => url.includes("_rsc="))).toEqual([]);
  });
});
