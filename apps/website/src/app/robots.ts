import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Lives at the root of `src/app/`, outside the `(main)` group, per the file
 * convention. Reads nothing from the request.
 *
 * `/monitoring` is the Sentry tunnel route configured in `next.config.ts`
 * (`tunnelRoute`), not a page. `/guest-info` and `/checkin` already set
 * `robots: { index: false }` in their own metadata; disallowing them here
 * keeps crawlers from fetching them at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/guest-info", "/checkin", "/monitoring"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
