import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Node pool only. Every component in this app is a server component rendering
// static markup, so there is nothing a browser pool would test that the unit
// tests, the prerendering build and a screenshot do not already cover.
export default defineConfig({
  plugins: [tsconfigPaths()],
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
    ],
  },
});
