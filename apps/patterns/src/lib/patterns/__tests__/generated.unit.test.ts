import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderIndexMd } from "../index-md";
import { renderManifest } from "../manifest-source";
import { CONTENT_DIR, readContent } from "../read-content";
import { parsePatternMeta } from "../schema";

const STALE = "is stale: run `yarn workspace patterns index`";

describe("generated files", () => {
  const docs = readContent();

  it("content/INDEX.md matches the content directory", () => {
    // A module constant, not input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const onDisk = readFileSync(path.join(CONTENT_DIR, "INDEX.md"), "utf8");
    expect(onDisk, `INDEX.md ${STALE}`).toBe(renderIndexMd(docs));
  });

  it("manifest.generated.ts matches the content directory", () => {
    const onDisk = readFileSync(path.join(import.meta.dirname, "../manifest.generated.ts"), "utf8");
    expect(onDisk, `manifest.generated.ts ${STALE}`).toBe(
      renderManifest(docs.map((doc) => doc.slug)),
    );
  });
});

describe("renderIndexMd", () => {
  const meta = (kind: "atom" | "composite", title: string, summary: string) =>
    parsePatternMeta(
      {
        title,
        kind,
        summary,
        tags: ["x"],
        ...(kind === "composite" ? { uses: ["b-atom"] } : {}),
        code: [{ path: "a.ts", ref: "a1410c6b3afa1ac500fc7018ca1ad42d5956e3b0", note: "n" }],
        verifiedIn: [1],
        updated: "2026-09-29",
      },
      "fixture",
    );

  it("lists atoms and composites as sorted read-when lines", () => {
    const text = renderIndexMd([
      { slug: "c-composite", meta: meta("composite", "C", "Read when C.") },
      { slug: "b-atom", meta: meta("atom", "B", "Read when B.") },
    ]);
    expect(
      text.split("\n").filter((line) => line.startsWith("- ") || line.startsWith("## ")),
    ).toEqual([
      "## Atoms",
      "- [B](content/b-atom.mdx) — read when: Read when B.",
      "## Composites",
      "- [C](content/c-composite.mdx) — read when: Read when C.",
    ]);
  });

  it("changes when the set of docs changes", () => {
    const one = renderIndexMd([{ slug: "b-atom", meta: meta("atom", "B", "Read when B.") }]);
    const two = renderIndexMd([
      { slug: "a-atom", meta: meta("atom", "A", "Read when A.") },
      { slug: "b-atom", meta: meta("atom", "B", "Read when B.") },
    ]);
    expect(two).not.toBe(one);
  });
});
