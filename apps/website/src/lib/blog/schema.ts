import type { ComponentType } from "react";
import { z } from "zod";
import { fromCalendarDay } from "@/lib/date-utils";

/**
 * The frontmatter contract for a blog post.
 *
 * A post declares its metadata as `export const meta = {...}` inside its own
 * `.mdx` file, which is the frontmatter mechanism `@next/mdx` supports without
 * any extra parser. That export is plain, unvalidated JavaScript, so this
 * schema is the only thing standing between a typo in a post and a broken
 * page.
 *
 * This module deliberately imports no `.mdx` and does no React rendering, only
 * `zod`, `fromCalendarDay` and a `ComponentType` *type*. That is what keeps it
 * runnable in the vitest node pool, where there is no MDX transform.
 */

// `date` is a calendar day, never a `Date` (see apps/website/AGENTS.md). Same
// shape as calendarDaySchema in src/lib/shared/schemas/booking.ts: the regex
// pins the format and the refine rejects well-shaped nonsense the regex lets
// through, e.g. "2026-02-31" or "2026-13-01".
const postDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Post date must be in YYYY-MM-DD format")
  .refine((day) => !Number.isNaN(fromCalendarDay(day).getTime()), {
    message: "Post date is not a real calendar date",
  });

const postMetaSchema = z.object({
  title: z.string().trim().min(1, "Post title is required").max(120, "Post title is too long"),
  // Doubles as the meta description and the blurb on the index, so it is not
  // optional and it is length-capped the way a meta description has to be.
  description: z
    .string()
    .trim()
    .min(1, "Post description is required")
    .max(200, "Post description is too long"),
  date: postDateSchema,
  // Kebab-case and URL-safe, split into a flat character-class regex plus a
  // refine rather than the obvious `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. That form
  // nests a quantifier inside a quantified group, which is the classic ReDoS
  // shape and is rejected by security/detect-unsafe-regex. These two checks
  // accept exactly the same strings and run in linear time.
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Post slug must be lowercase kebab-case")
    .refine((slug) => !slug.startsWith("-") && !slug.endsWith("-") && !slug.includes("--"), {
      message: "Post slug must be lowercase kebab-case",
    }),
  // next/image needs explicit dimensions for a string `src`, and the alt text
  // is not optional: a hero looks decorative but carries content.
  hero: z
    .object({
      src: z.string().startsWith("/", "Hero image src must be a site-root-relative path"),
      alt: z.string().trim().min(1, "Hero image alt text is required"),
      width: z.number().int().positive("Hero image width must be a positive integer"),
      height: z.number().int().positive("Hero image height must be a positive integer"),
    })
    .optional(),
});

type BlogPostMeta = z.infer<typeof postMetaSchema>;

export type BlogPost = BlogPostMeta & { Content: ComponentType };

/**
 * Validate one post's `meta` and pair it with its rendered content.
 *
 * `parse`, not `safeParse`: this runs at module scope in `posts.ts`, so a
 * malformed post throws while the route module is being evaluated and fails
 * the build. That is the mechanism by which a bad post never ships, and it is
 * the reason no route has to defend against missing fields at render time.
 */
export function toBlogPost(meta: unknown, Content: ComponentType): BlogPost {
  return { ...postMetaSchema.parse(meta), Content };
}

/**
 * Newest first. `yyyy-MM-dd` is lexicographically ordered, so no `Date` is
 * constructed here. Returns a new array; the input is not mutated.
 */
export function sortPostsByDateDesc(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Two posts on one URL is a build-time mistake, not a runtime 404, so this
 * throws and names the offender.
 */
export function assertUniqueSlugs(posts: BlogPost[]): void {
  const seen = new Set<string>();

  for (const { slug } of posts) {
    if (seen.has(slug)) {
      throw new Error(`Duplicate blog post slug: "${slug}"`);
    }
    seen.add(slug);
  }
}
