import path from "node:path";
import { defineConfig } from "vitest/config";

// Same "@/*" -> "./src/*" alias fix as apps/social-media/vitest.config.ts
// (works around a Turbopack bug resolving relative imports to newly-added
// sibling files — see that file's comment for the full story).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
