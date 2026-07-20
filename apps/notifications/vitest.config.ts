import path from "node:path";
import { defineConfig } from "vitest/config";

// Same "@/*" -> "./src/*" alias fix as apps/social-media and
// apps/telegram-router's vitest.config.ts (works around a Turbopack bug
// resolving relative imports to newly-added sibling files).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Everything here queries Postgres directly — same as apps/finance's
    // reports-db.ts, that's verified via real usage, not mocked-pg unit
    // tests. No pure logic to test yet, so no test files exist.
    passWithNoTests: true,
  },
});
