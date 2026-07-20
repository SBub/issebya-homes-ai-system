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
});
