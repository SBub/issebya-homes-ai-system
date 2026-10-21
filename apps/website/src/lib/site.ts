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
 * The site lives on `home.issebya.com`, one of several `issebya.com`
 * subdomains. The bare `issebya.com` is reserved for a hub that links to
 * them, so it is not this site's origin. The brand stays `issebya.homes`.
 */
export const SITE_URL = "https://home.issebya.com";
