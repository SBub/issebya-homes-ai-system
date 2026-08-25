import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same Turbopack workspace-root fix as the other apps in this monorepo.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  transpilePackages: ["pricing"],
  // @dbos-inc/dbos-sdk's telemetry/exporters.js does lazy `require()`s for
  // optional OpenTelemetry exporter packages (e.g.
  // @opentelemetry/exporter-trace-otlp-proto) that are only ever hit if an
  // OTLP endpoint is actually configured, which it isn't here — but Next's
  // bundler statically resolves every require() it finds regardless, and
  // fails the whole build since those packages were never installed.
  // serverExternalPackages tells Next to leave this package as a real
  // runtime require() instead of trying to bundle it.
  serverExternalPackages: ["@dbos-inc/dbos-sdk"],
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
// matching this app's existing convention of every other vendor
// (Braintrust/Axiom/Sentry's own DSN, see src/instrumentation.ts) being
// configured via env vars, never hardcoded values in source.
// SENTRY_AUTH_TOKEN already exists in .env/.env.example; SENTRY_ORG and
// SENTRY_PROJECT are added to .env.example alongside it (this file's
// worktree .env already has a real SENTRY_AUTH_TOKEN — that token happens to
// be org-scoped, i.e. prefixed "sntrys_", which @sentry/bundler-plugin-core
// accepts as a stand-in for SENTRY_ORG, but SENTRY_PROJECT still has no
// fallback and must be set explicitly for a real upload to run).
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
// build it controls (see
// node_modules/@sentry/nextjs/build/esm/config/withSentryConfig/getFinalConfigObjectBundlerUtils.js,
// `maybeEnableTurbopackSourcemaps()`: sets `productionBrowserSourceMaps =
// true` and, unless the caller explicitly overrode
// `sourcemaps.deleteSourcemapsAfterUpload`, also sets it to `true`) — left
// untouched here, not disabled.
export default withSentryConfig(nextConfig);
