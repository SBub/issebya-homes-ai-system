import type { MetadataRoute } from "next";
import { fromCalendarDay } from "@/lib/date-utils";
import { allPosts } from "@/lib/blog/posts";
import { allProducts } from "@/lib/shop/products";
import { SITE_URL } from "@/lib/site";

/**
 * Lives at the root of `src/app/`, outside the `(main)` group, per the file
 * convention. Reads nothing from the request, so it is generated at build time
 * from the same post and product registries the routes use.
 *
 * Omitted on purpose: `/` (it redirects), `/guest-info` and `/checkin/*` (both
 * already noindex), and every `/api` route. No `lastModified` on the static
 * entries either: `new Date()` there would change on every build and is noise
 * a crawler has to re-check for nothing. Posts do carry one, from their own
 * `date`. Products carry no date, so they have none either.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/booking/room1`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/booking/room2`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/shop`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/shop/sell`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/contact`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/terms-and-conditions`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${SITE_URL}/privacy-policy`, changeFrequency: "yearly", priority: 0.1 },
  ];

  const postRoutes: MetadataRoute.Sitemap = allPosts.map(({ slug, date }) => ({
    url: `${SITE_URL}/blog/${slug}`,
    lastModified: fromCalendarDay(date),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const productRoutes: MetadataRoute.Sitemap = allProducts.map(({ slug }) => ({
    url: `${SITE_URL}/shop/${slug}`,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...postRoutes, ...productRoutes];
}
