import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same Turbopack workspace-root fix as apps/finance and apps/social-media.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

// Wraps the config above with @sentry/nextjs's (v10) build-time integration
// — the runtime half of Sentry (Sentry.init(), error capture) lives in
// src/instrumentation.ts; this is the separate build-step half: upload real
// (unminified) source maps to Sentry so production stack traces are
// readable, without shipping those source maps in the public build output
// (which would leak real source).
//
// No options are passed for org/project/authToken — deliberately, to avoid
// hardcoding this app's Sentry org/project slugs into committed source.
// @sentry/bundler-plugin-core (the layer withSentryConfig's source-map
// upload delegates to) already falls back to the SENTRY_ORG/SENTRY_PROJECT/
// SENTRY_AUTH_TOKEN env vars itself when these options are omitted — see
// node_modules/@sentry/bundler-plugin-core/dist/cjs/index.js:
//   org: userOptions.org ?? process.env["SENTRY_ORG"],
//   project: userOptions.project ?? process.env["SENTRY_PROJECT"] (comma-split for multiple),
//   authToken: userOptions.authToken ?? process.env["SENTRY_AUTH_TOKEN"],
// matching this app's existing convention of every other vendor (Axiom/
// Sentry's own DSN, see src/instrumentation.ts) being configured via env
// vars, never hardcoded values in source. SENTRY_AUTH_TOKEN/SENTRY_ORG/
// SENTRY_PROJECT are documented in .env.example alongside SENTRY_DSN.
//
// No SENTRY_AUTH_TOKEN present (local dev, `yarn typecheck`, CI without the
// secret) is NOT a case this file needs to guard against itself:
// @sentry/bundler-plugin-core's own canUploadSourceMaps() checks for a
// token before doing anything and just logs a warning + skips the upload
// when it's missing — see same file, ~line 5991: `if (!options.authToken) {
// logger.warn("No auth token provided. Will not upload source maps. ...");
// return false; }`. Adding a redundant `SENTRY_AUTH_TOKEN &&
// withSentryConfig(...)` guard here would fight that built-in behavior for
// no benefit.
//
// Source maps are stripped from the public build output automatically after
// upload — `sourcemaps.deleteSourcemapsAfterUpload` defaults to `true`
// inside @sentry/nextjs whenever it turns on source-map generation for a
// build it controls — left untouched here, not disabled.
export default withSentryConfig(nextConfig);
