import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const sharedPlugins = [react(), tsconfigPaths(), tailwindcss()];

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
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
          setupFiles: ["./vitest.browser.setup.ts"],
        },
      },
    ],
  },
});
