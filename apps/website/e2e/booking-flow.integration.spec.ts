import { expect, test } from "@playwright/test";
import { addDays, format, startOfDay } from "date-fns";

// Generate future dates relative to today so tests don't go stale
const today = startOfDay(new Date());
const checkInDate = addDays(today, 10);
const checkOutDate = addDays(today, 13);
const blockedStart = addDays(today, 5);
const blockedEnd = addDays(today, 8);

const checkInLabel = format(checkInDate, "MMMM d, yyyy");
const checkOutLabel = format(checkOutDate, "MMMM d, yyyy");

const availabilityResponse = {
  blockedDates: [
    {
      start: blockedStart.toISOString(),
      end: blockedEnd.toISOString(),
    },
  ],
};

function mockAvailability(page: import("@playwright/test").Page) {
  return page.route("**/api/availability?room=room1**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(availabilityResponse),
    }),
  );
}

test.describe("Booking flow", () => {
  test("user sees available dates and booking form after page loads", async ({ page }) => {
    await mockAvailability(page);
    await page.goto("/booking/room1");

    // Collapsed booking engine shows pre-selected dates
    await expect(page.getByLabel("Select check-in date")).toBeVisible();
    await expect(page.getByLabel("Select check-out date")).toBeVisible();
    await expect(page.getByLabel("Book selected dates")).toBeVisible();
  });

  test("full booking flow: select dates → enter email → redirect to Stripe", async ({ page }) => {
    await mockAvailability(page);

    // Mock checkout API to return a fake Stripe URL
    await page.route("**/api/checkout/create", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://checkout.stripe.com/test_session",
        }),
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

    // Enter email
    await page.getByLabel(/email/i).fill("guest@example.com");

    // Book button should be enabled
    await expect(page.getByLabel("Confirm booking")).toBeEnabled();

    // Click book — should navigate to Stripe
    const [response] = await Promise.all([
      page.waitForURL("https://checkout.stripe.com/**"),
      page.getByLabel("Confirm booking").click(),
    ]);
  });

  test("user sees error when dates are no longer available", async ({ page }) => {
    await mockAvailability(page);

    // First checkout call returns dates_unavailable, second is fresh availability
    let checkoutCallCount = 0;
    await page.route("**/api/checkout/create", (route) => {
      checkoutCallCount++;
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "dates_unavailable",
          message: "These dates are no longer available.",
        }),
      });
    });

    // Mock fresh availability fetch after conflict
    await page.route("**/api/availability?room=room1&fresh=true", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ blockedDates: [] }),
      }),
    );

    await page.goto("/booking/room1");

    // Expand, select dates, enter email
    await page.getByLabel("Book selected dates").click();
    await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
    await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();
    await page.getByLabel(/email/i).fill("guest@example.com");

    // Click book
    await page.getByLabel("Confirm booking").click();

    // User sees error about dates being taken
    await expect(page.getByText(/these dates were just booked by someone else/i)).toBeVisible();
  });

  test("user sees error when availability fetch fails", async ({ page }) => {
    // Mock availability returning 500
    await page.route("**/api/availability**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          blockedDates: [],
          error: "Unable to fetch availability data. Please try again later.",
        }),
      }),
    );

    await page.goto("/booking/room1");

    // React Query surfaces this as the error message from the throw in useAvailabilityQuery
    // Give it extra time since React Query may retry before showing the error
    await expect(page.getByText(/failed to fetch availability data/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
