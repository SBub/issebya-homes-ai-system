/**
 * The public origin of the site, written down once.
 *
 * `app_docs/dynamic-url-construction.md` says to derive a base URL from the
 * incoming request rather than hardcoding one. That rule is scoped to API
 * route handlers and redirects, and it does not apply here: `sitemap.ts`,
 * `robots.ts` and a post's canonical URL cannot read the request without
 * turning those routes dynamic, which is the opposite of what they exist for.
 * A constant is the correct shape for them.
 *
 * Note the brand is `issebya.homes` while this is `issebya.com`. That matches
 * what `src/app/layout.tsx` has always emitted for Open Graph, so it is kept
 * as-is rather than changed in passing. If `issebya.homes` is the canonical
 * domain, changing this one line fixes the layout metadata, every post
 * canonical, the sitemap and robots together.
 */
export const SITE_URL = "https://issebya.com";
