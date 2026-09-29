import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_DIR, readContent } from "../read-content";
import { checkSections } from "../sections";

const REPO_ROOT = path.resolve(CONTENT_DIR, "../../..");

// Over the real content directory. `readContent` itself parses every doc's
// frontmatter and runs `validateCollection`, so it throwing is a failure here.
describe("pattern content", () => {
  const docs = readContent();

  it("has at least one doc", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  it.each(docs.map((doc) => [doc.slug, doc] as const))(
    "%s has the fixed sections",
    (_slug, doc) => {
      expect(checkSections(doc.body, doc.meta.kind)).toEqual([]);
    },
  );

  it.each(docs.flatMap((doc) => doc.meta.code.map((entry) => [doc.slug, entry.path] as const)))(
    "%s links to %s, which exists in the repo",
    (_slug, codePath) => {
      // A path from our own content's frontmatter, already schema-checked as repo-relative.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(existsSync(path.join(REPO_ROOT, codePath))).toBe(true);
    },
  );
});
