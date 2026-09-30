import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const sharedPlugins = [react(), tsconfigPaths()];

// The node pool covers the content, the generated files and the SSE helpers.
// The browser pool exists for the live demos under src/app/demos/, the app's
// only client components, which need a real DOM and a (faked) EventSource.
// Chromium only, for the same reason as apps/website: CI installs one browser
// with a single `playwright install chromium`, and webkit cannot launch on
// macOS 14 arm64.
export default defineConfig({
  plugins: sharedPlugins,
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          include: ["src/**/*.unit.test.ts"],
          name: "unit",
          environment: "node",
        },
      },
      {
        plugins: sharedPlugins,
        optimizeDeps: {
          // Listed up front: a dependency Vite discovers mid-run triggers a
          // re-optimize and a reload that kills the Vitest runner on a cold
          // cache (every CI job).
          include: ["react", "react-dom", "vitest-browser-react"],
        },
        test: {
          include: ["src/**/*.browser.test.tsx"],
          name: "browser",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
