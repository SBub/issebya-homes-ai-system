import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const sharedPlugins = [react(), tsconfigPaths(), tailwindcss()];

/**
 * The gated run (turbo's `test` task, CI, the lefthook pre-push hook) is
 * chromium-only: it has to be installable in the CI image with a single
 * `playwright install chromium` and cheap enough to sit on every push. The
 * full cross-browser sweep stays one command away - `yarn workspace website
 * test:browser` sets VITEST_ALL_BROWSERS=1 - and is run deliberately, not on
 * every push. Webkit in particular cannot launch at all on macOS 14 arm64
 * (Playwright ships a frozen build there), so a push-blocking hook must not
 * depend on it.
 */
const browserInstances =
  process.env.VITEST_ALL_BROWSERS === "1"
    ? [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }]
    : [{ browser: "chromium" }];

export default defineConfig({
  plugins: sharedPlugins,
  test: {
    projects: [
      {
        plugins: sharedPlugins,
        test: {
          include: ["src/**/*.unit.test.ts"],
          name: "unit",
          environment: "node",
        },
      },
      {
        plugins: sharedPlugins,
        css: {
          postcss: {},
        },
        optimizeDeps: {
          include: [
            "react",
            "react-dom",
            "date-fns",
            "@sentry/nextjs",
            "zod",
            "next/image",
            "next/navigation",
            "posthog-js",
          ],
        },
        test: {
          include: ["src/app/**/*.browser.test.tsx", "src/ui/**/*.browser.test.tsx"],
          name: "browser",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // https://vitest.dev/config/browser/playwright
            instances: browserInstances,
          },
          setupFiles: ["./vitest.browser.setup.ts"],
        },
      },
    ],
  },
});
