/**
 * `yarn workspace patterns index` (also `prebuild`): validates every doc in
 * content/ and writes content/INDEX.md and src/lib/patterns/manifest.generated.ts.
 * A file is only rewritten when its text changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderIndexMd } from "../src/lib/patterns/index-md";
import { renderManifest } from "../src/lib/patterns/manifest-source";
import { CONTENT_DIR, readContent } from "../src/lib/patterns/read-content";
import { checkSections } from "../src/lib/patterns/sections";

const INDEX_PATH = path.join(CONTENT_DIR, "INDEX.md");
const MANIFEST_PATH = path.join(CONTENT_DIR, "../src/lib/patterns/manifest.generated.ts");

const docs = readContent();

const problems = docs.flatMap(({ slug, body, meta }) =>
  checkSections(body, meta.kind).map((problem) => `  ${slug}: ${problem}`),
);
if (problems.length > 0) {
  throw new Error(`Pattern docs break the section contract:\n${problems.join("\n")}`);
}

function writeIfChanged(file: string, text: string): void {
  let current: string | null = null;
  try {
    // Both paths are module constants.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    current = readFileSync(file, "utf8");
  } catch {
    current = null;
  }
  if (current === text) {
    console.log(`unchanged ${path.relative(process.cwd(), file)}`);
    return;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(file, text);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

writeIfChanged(INDEX_PATH, renderIndexMd(docs));
writeIfChanged(MANIFEST_PATH, renderManifest(docs.map((doc) => doc.slug)));
