import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import { z } from "zod";

/**
 * The frontmatter contract for a pattern doc.
 *
 * Frontmatter is YAML at the top of each `.mdx` file, not the blog's
 * `export const meta`: agents read the raw files from disk, and the index
 * generator and the unit tests read it without an MDX compiler. The bundle
 * gets the same data as a `frontmatter` export (remark-mdx-frontmatter), and
 * both paths go through this schema.
 *
 * This module imports no `.mdx` and no `node:fs`, only `zod` and two *types*,
 * which keeps it runnable in the vitest node pool.
 */

// Kebab-case, as a flat character class plus a refine rather than
// `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`: that form nests a quantifier inside a
// quantified group, the classic ReDoS shape security/detect-unsafe-regex
// rejects. Same rule as apps/website/src/lib/blog/schema.ts.
const kebabSchema = (label: string) =>
  z
    .string()
    .regex(/^[a-z0-9-]+$/, `${label} must be lowercase kebab-case`)
    .refine((value) => !value.startsWith("-") && !value.endsWith("-") && !value.includes("--"), {
      message: `${label} must be lowercase kebab-case`,
    });

const slugSchema = kebabSchema("Slug");

// A calendar day, never a `Date`. The regex pins the format and the refine
// rejects well-shaped nonsense like "2026-02-31": parsed as UTC midnight, a
// real day formats back to itself and an impossible one rolls over.
const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be in YYYY-MM-DD format")
  .refine(
    (day) => {
      const date = new Date(`${day}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
    },
    { message: "updated is not a real calendar date" },
  );

// Repo-relative: no leading slash, no parent segment, no URL. The link
// builders prefix it with the GitHub repo and the pinned ref.
const repoPathSchema = z
  .string()
  .trim()
  .min(1, "code.path is required")
  .refine((path) => !path.startsWith("/"), { message: "code.path must be repo-relative" })
  .refine((path) => !path.split("/").includes(".."), {
    message: "code.path must not contain '..'",
  })
  .refine((path) => !path.includes("://"), { message: "code.path must not be a URL" });

const codeRefSchema = z.object({
  path: repoPathSchema,
  // A full commit SHA, never a branch: a branch link drifts as the branch moves.
  ref: z.string().regex(/^[0-9a-f]{40}$/, "code.ref must be a 40-character commit SHA"),
  note: z.string().trim().min(1, "code.note is required").max(160, "code.note is too long"),
});

const patternMetaSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(80, "title is too long"),
    kind: z.enum(["atom", "composite"]),
    // One sentence: it is the "read when" line in INDEX.md and the blurb on the
    // index page.
    summary: z
      .string()
      .trim()
      .min(1, "summary is required")
      .max(200, "summary is too long")
      .refine((summary) => summary.endsWith("."), { message: "summary must end with '.'" })
      .refine((summary) => !summary.slice(0, -1).includes(". "), {
        message: "summary must be one sentence",
      })
      .refine((summary) => !summary.includes("—"), {
        message: "summary must not contain an em dash",
      }),
    tags: z.array(kebabSchema("Tag")).min(1, "tags needs at least one tag"),
    uses: z.array(slugSchema).optional(),
    code: z.array(codeRefSchema).min(1, "code needs at least one entry"),
    verifiedIn: z.array(z.number().int().positive()).min(1, "verifiedIn needs at least one PR"),
    updated: calendarDaySchema,
  })
  .superRefine((meta, ctx) => {
    if (meta.kind === "composite" && (meta.uses === undefined || meta.uses.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["uses"],
        message: "a composite must list the atoms it uses",
      });
    }
    if (meta.kind === "atom" && meta.uses !== undefined) {
      ctx.addIssue({ code: "custom", path: ["uses"], message: "an atom must not have uses" });
    }
  });

export type PatternMeta = z.infer<typeof patternMetaSchema>;

export type PatternDoc = PatternMeta & {
  slug: string;
  Content: ComponentType<{ components?: MDXComponents }>;
};

type SlugAndMeta = { slug: string; meta: PatternMeta };

/**
 * Validate one doc's frontmatter. `parse`, not `safeParse`: the registry calls
 * this at module scope, so a malformed doc throws while the route module is
 * evaluated and fails the build. The slug is checked too and named in the
 * message, so the failure points at the file.
 */
export function parsePatternMeta(raw: unknown, slug: string): PatternMeta {
  const slugResult = slugSchema.safeParse(slug);
  const result = patternMetaSchema.safeParse(raw);
  if (!slugResult.success || !result.success) {
    const issues = [
      ...(slugResult.success ? [] : slugResult.error.issues),
      ...(result.success ? [] : result.error.issues),
    ];
    const lines = issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`Invalid pattern doc "${slug}":\n${lines.join("\n")}`);
  }
  return result.data;
}

/**
 * Cross-doc rules no single frontmatter can check: unique slugs, and every
 * `uses` entry names an existing atom that is not the doc itself.
 */
export function validateCollection(docs: readonly SlugAndMeta[]): void {
  const bySlug = new Map<string, PatternMeta>();
  for (const { slug, meta } of docs) {
    if (bySlug.has(slug)) throw new Error(`Duplicate pattern slug: "${slug}"`);
    bySlug.set(slug, meta);
  }

  for (const { slug, meta } of docs) {
    for (const used of meta.uses ?? []) {
      if (used === slug) throw new Error(`${slug} uses itself`);
      const target = bySlug.get(used);
      if (target === undefined) throw new Error(`${slug} uses unknown pattern "${used}"`);
      if (target.kind !== "atom") {
        throw new Error(`${slug} uses "${used}", which is a composite; uses must name atoms`);
      }
    }
  }
}

/** The slugs of the docs whose `uses` names `slug`, in input order. */
export function usedBy(slug: string, docs: readonly SlugAndMeta[]): string[] {
  return docs.filter(({ meta }) => meta.uses?.includes(slug)).map((doc) => doc.slug);
}
