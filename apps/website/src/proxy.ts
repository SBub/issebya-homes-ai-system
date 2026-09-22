import { NextResponse } from "next/server";

const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const posthogAssetsHost = posthogHost?.replace(".i.posthog.com", "-assets.i.posthog.com");

/**
 * Security headers proxy.
 *
 * Runs on every request before the page renders. Adds HTTP headers
 * that instruct the browser to enforce security policies.
 *
 * See DOCS/security-headers.md for an explanation of each header.
 */
export function proxy() {
  const response = NextResponse.next();

  // Prevent the site from being embedded in iframes (clickjacking protection)
  response.headers.set("X-Frame-Options", "DENY");

  // Prevent browsers from guessing file types (MIME sniffing protection)
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Control how much URL info leaks to other sites when users click links
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Force HTTPS for 1 year, including subdomains
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Disable browser features the site doesn't use
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Content Security Policy — the main defense against XSS
  // Each directive whitelists what the browser is allowed to load
  const csp = [
    // Default: only allow resources from our own origin
    "default-src 'self'",

    // Scripts: our code + Stripe checkout + PostHog (analytics)
    // 'unsafe-inline' needed for Next.js inline scripts
    // 'unsafe-eval' needed for Next.js development mode (Turbopack)
    [
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      ...(posthogAssetsHost ? [posthogAssetsHost] : []),
    ].join(" "),

    // CSS: our styles + inline styles (Tailwind injects styles at runtime)
    "style-src 'self' 'unsafe-inline'",

    // Network requests: our API + Stripe + Sentry + Supabase + PostHog (analytics)
    [
      "connect-src 'self' https://api.stripe.com https://*.ingest.de.sentry.io https://*.supabase.co",
      ...(posthogHost ? [posthogHost] : []),
      ...(posthogAssetsHost ? [posthogAssetsHost] : []),
    ].join(" "),

    // Iframes: only Stripe (for payment form)
    "frame-src https://js.stripe.com",

    // Images: our images + data URIs (for inline SVGs) + blobs (for dynamic images)
    "img-src 'self' data: blob:",

    // Fonts: only from our own origin
    "font-src 'self'",

    // Web workers: PostHog session-recording compression worker (blob URL)
    "worker-src 'self' blob:",

    // Forms: only submit to our own origin
    "form-action 'self'",

    // Don't allow our site to be embedded as an iframe anywhere
    "frame-ancestors 'none'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);

  return response;
}

/**
 * Run on all routes except static files and Next.js internals.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - public folder assets (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
