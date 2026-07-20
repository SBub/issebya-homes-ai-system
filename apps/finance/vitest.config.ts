import path from "node:path";
import { defineConfig } from "vitest/config";

// Same alias fix as apps/social-media/telegram-router/notifications'
// vitest.config.ts (works around a Turbopack bug resolving relative
// imports to newly-added sibling files — see those files' comments for
// the full story).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
