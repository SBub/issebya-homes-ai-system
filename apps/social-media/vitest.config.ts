import path from "node:path";
import { defineConfig } from "vitest/config";

// Needed so tests can resolve the same "@/*" -> "./src/*" alias tsconfig.json
// and Next.js already use — generate.ts imports seed-vocabulary.ts via the
// alias (not a relative path) to work around a Turbopack bug where relative
// imports to newly-added sibling files fail to resolve.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
