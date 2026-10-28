/**
 * The pattern registry: the single list `/` and `/p/[slug]` are driven from.
 *
 * The list is explicit imports from a generated manifest, never a `readdir`,
 * for the same reason as apps/website/src/lib/blog/posts.ts: IO in a module
 * the routes import is what quietly drops a page out of the static shell, and
 * it would depend on `content/` being traced into the serverless bundle.
 * `yarn workspace patterns index` (run in `prebuild`) writes the manifest.
 *
 * Validation happens at module scope, so a doc with malformed frontmatter or a
 * broken `uses` throws while this module is evaluated and fails the build.
 */
import { manifest } from "./manifest.generated";
import { type PatternDoc, parsePatternMeta, usedBy, validateCollection } from "./schema";

const docs: readonly PatternDoc[] = Object.freeze(
  manifest.map(({ slug, meta, Content }) => ({
    ...parsePatternMeta(meta, slug),
    slug,
    Content,
  })),
);

validateCollection(docs.map((doc) => ({ slug: doc.slug, meta: doc })));

function byTitle(list: readonly PatternDoc[]): PatternDoc[] {
  return [...list].sort((a, b) => a.title.localeCompare(b.title));
}

export const allPatterns: PatternDoc[] = byTitle(docs);
export const atoms: PatternDoc[] = allPatterns.filter((doc) => doc.kind === "atom");
export const composites: PatternDoc[] = allPatterns.filter((doc) => doc.kind === "composite");

export function getPattern(slug: string): PatternDoc | undefined {
  return docs.find((doc) => doc.slug === slug);
}

/** The atoms a composite combines, in its frontmatter order. */
export function getUses(doc: PatternDoc): PatternDoc[] {
  return (doc.uses ?? []).flatMap((slug) => getPattern(slug) ?? []);
}

/** The composites that combine `slug`, by title. */
export function getUsedBy(slug: string): PatternDoc[] {
  const slugs = usedBy(
    slug,
    docs.map((doc) => ({ slug: doc.slug, meta: doc })),
  );
  return allPatterns.filter((doc) => slugs.includes(doc.slug));
}
