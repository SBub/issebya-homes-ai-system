import path from "node:path";
import createMDX from "@next/mdx";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  transpilePackages: ["@/lib/shared", "pricing"],
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  cacheComponents: true,
};

// Blog posts are `.mdx` modules imported by src/lib/blog/posts.ts, not routed
// `page.mdx` files, so `pageExtensions` is deliberately left alone: widening
// it would widen the app-directory routing surface for no gain. No remark or
// rehype plugins either: Next 16 builds with Turbopack, which only accepts
// plugins by serialisable name, and this blog needs none.
const withMDX = createMDX({});

// Order matters: MDX wraps the plain config, Sentry wraps the result.
export default withSentryConfig(withMDX(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "issebya",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
