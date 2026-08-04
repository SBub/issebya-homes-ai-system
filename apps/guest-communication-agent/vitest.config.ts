import path from "node:path";
import { defineConfig } from "vitest/config";

// Same "@/*" -> "./src/*" alias fix as every other app's vitest.config.ts in
// this monorepo (works around a Turbopack bug resolving relative imports to
// newly-added sibling files).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // src/agent/tools/property-question.ts creates a Supabase anon client as
    // a module-level singleton, which throws at import time if these env
    // vars are unset — tests that import it transitively pull this in too.
    // It never makes a real Supabase or LLM call, so dummy values are enough
    // (same approach the source app's own vitest.config.ts uses).
    env: {
      SUPABASE_URL: "http://localhost:54331",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    },
  },
});
