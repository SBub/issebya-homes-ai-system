/**
 * Reads the pattern docs from disk. Node only: imported by the scripts and the
 * unit tests, never by a route. Routes go through `registry.ts`, whose explicit
 * generated imports the bundler resolves at build time.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { type PatternMeta, parsePatternMeta, validateCollection } from "./schema";

export const CONTENT_DIR = fileURLToPath(new URL("../../../content/", import.meta.url));

export type ContentDoc = { slug: string; raw: string; body: string; meta: PatternMeta };

/** Splits a leading `---` YAML block from the MDX body. */
function splitFrontmatter(raw: string, slug: string): { yaml: string; body: string } {
  const lines = raw.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (lines[0]?.trim() !== "---" || end === -1) {
    throw new Error(`Pattern doc "${slug}" has no YAML frontmatter block`);
  }
  return { yaml: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

/** Every `content/*.mdx`, sorted by slug, parsed and validated as a collection. */
export function readContent(): ContentDoc[] {
  // The directory is a module constant, not input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .sort();

  const docs = files.map((file) => {
    const slug = file.slice(0, -".mdx".length);
    // A filename just listed from the constant directory above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const { yaml, body } = splitFrontmatter(raw, slug);
    return { slug, raw, body, meta: parsePatternMeta(parse(yaml), slug) };
  });

  validateCollection(docs);
  return docs;
}
