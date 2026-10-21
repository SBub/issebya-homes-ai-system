import { expect, test } from "@playwright/test";

// Sentry sends from the production Vercel deploy only (src/lib/sentry-enabled.ts).
// The client reports through the same-origin /monitoring tunnel (tunnelRoute in
// next.config.ts), so a hostname-only check would miss it: watch both.
test("an e2e page load sends nothing to Sentry", async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
  const sentryRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.hostname.endsWith(".sentry.io") ||
      (url.origin === appOrigin && url.pathname.startsWith("/monitoring"))
    ) {
      sentryRequests.push(request.url());
    }
  });

  await page.goto("/booking/room1");
  await expect(page.getByLabel("Book selected dates")).toBeVisible();

  // An uncaught error an enabled client SDK would always report.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e sentry probe");
    });
  });
  // The SDK sends its envelope asynchronously; give it time to show up.
  await page.waitForTimeout(2000);

  expect(sentryRequests).toEqual([]);
});
