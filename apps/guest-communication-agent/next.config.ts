import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same Turbopack workspace-root fix as the other apps in this monorepo.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
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

export default nextConfig;
