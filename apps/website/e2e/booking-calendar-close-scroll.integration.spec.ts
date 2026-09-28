import { expect, type Locator, type Page, test } from "@playwright/test";

const WIDGET_POST = "/blog/welcome-to-issebya-homes";
const POST_TITLE = "A house for rest between the Sintra forest and the Atlantic";

// Mobile layout, so the room page's gallery sits above the engine. Closing the
// calendar used to scroll to the document top, which here is the gallery (and
// in a blog post, the article's top), leaving the date row off-screen.
test.use({ viewport: { width: 390, height: 844 } });

// The date row of the live engine. The Suspense skeleton renders the same
// classes while streaming but has no labelled "book" button, so filtering on
// it picks the hydrated BookingClient.
const liveDateRow = (scope: Page | Locator) =>
  scope.locator('.booking-engine-collapsed:has([aria-label="Book selected dates"])');

// Smooth scrolling starts after the click resolves and runs for several
// hundred milliseconds, so an assertion made straight away sees the page
// before it has moved, and passes whatever the scroll target is. Resolve only
// once scrollY has held still for a stretch of consecutive frames.
async function waitForScrollToSettle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let stillFrames = 0;
        const tick = () => {
          stillFrames = window.scrollY === last ? stillFrames + 1 : 0;
          last = window.scrollY;
          if (stillFrames >= 30) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

test.describe("Closing the booking calendar returns to the date row", () => {
  test("on /booking/room1", async ({ page }) => {
    await page.goto("/booking/room1");

    const dateRow = liveDateRow(page);
    await dateRow.scrollIntoViewIfNeeded();

    await dateRow.getByLabel("Book selected dates").click();
    const close = page.getByLabel("Close booking calendar");
    await expect(close).toBeVisible();
    await close.click();

    await waitForScrollToSettle(page);
    // The old close scrolled to the document top: scrollY 0, gallery in view.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(dateRow).toBeInViewport();
  });

  test("in a blog post, not the post top", async ({ page }) => {
    await page.goto(WIDGET_POST);

    const widget = page.getByTestId("booking-widget");
    const dateRow = liveDateRow(widget);
    await dateRow.scrollIntoViewIfNeeded();

    await dateRow.getByLabel("Book selected dates").click();
    const close = widget.getByLabel("Close booking calendar");
    await expect(close).toBeVisible();
    await close.click();

    await waitForScrollToSettle(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(dateRow).toBeInViewport();
    await expect(page.getByRole("heading", { level: 1, name: POST_TITLE })).not.toBeInViewport();
  });
});
