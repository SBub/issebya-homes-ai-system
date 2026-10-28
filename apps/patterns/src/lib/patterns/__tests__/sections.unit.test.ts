import { describe, expect, it } from "vitest";
import { checkSections, extractH2Headings, unlabelledPatternFences } from "../sections";

const doc = (headings: string[], bodies: Record<string, string> = {}) =>
  [
    "---",
    "title: A doc",
    "---",
    "",
    ...headings.flatMap((heading) => [
      `## ${heading}`,
      "",
      bodies[heading] ??
        (heading === "Code" ? "<CodeLinks />" : heading === "Combines" ? "<Combines />" : "Text."),
      "",
    ]),
  ].join("\n");

const ATOM = ["Problem", "Mechanism", "Pattern", "Pitfalls", "When not to use", "Code"];
const COMPOSITE = [
  "Problem",
  "Mechanism",
  "Combines",
  "Pattern",
  "Pitfalls",
  "When not to use",
  "Code",
];

describe("checkSections", () => {
  it("accepts a correct atom and a correct composite", () => {
    expect(checkSections(doc(ATOM), "atom")).toEqual([]);
    expect(checkSections(doc(COMPOSITE), "composite")).toEqual([]);
  });

  it("rejects swapped sections", () => {
    const swapped = ["Problem", "Mechanism", "Pitfalls", "Pattern", "When not to use", "Code"];
    expect(checkSections(doc(swapped), "atom")).toHaveLength(1);
  });

  it("rejects a missing section", () => {
    const missing = ATOM.filter((heading) => heading !== "When not to use");
    expect(checkSections(doc(missing), "atom")[0]).toContain("sections must be exactly");
  });

  it("rejects Combines on an atom", () => {
    expect(checkSections(doc(COMPOSITE), "atom")).not.toEqual([]);
  });

  it("rejects a hand-written link under ## Code", () => {
    const problems = checkSections(
      doc(ATOM, { Code: "<CodeLinks />\n\n- [a file](https://github.com/x)" }),
      "atom",
    );
    expect(problems).toContain("## Code must not contain hand-written links");
  });

  it("rejects any other content in an auto-rendered section", () => {
    expect(checkSections(doc(COMPOSITE, { Combines: "Some prose." }), "composite")).toContain(
      "## Combines must contain only <Combines />",
    );
  });

  it("allows an H3 inside a section", () => {
    expect(checkSections(doc(ATOM, { Pattern: "### A detail\n\nText." }), "atom")).toEqual([]);
  });
});

describe("extractH2Headings", () => {
  it("ignores headings inside fenced code blocks", () => {
    const body = [
      "## Problem",
      "```md",
      "## Not a heading",
      "```",
      "~~~~",
      "## Also not",
      "```",
      "## Still not",
      "~~~~",
      "## Mechanism",
    ].join("\n");
    expect(extractH2Headings(body)).toEqual(["Problem", "Mechanism"]);
  });

  it("ignores the frontmatter block", () => {
    expect(extractH2Headings("---\ntitle: x\n---\n## Problem\n")).toEqual(["Problem"]);
  });
});

describe("unlabelledPatternFences", () => {
  const pattern = (...blocks: string[]) => doc(ATOM, { Pattern: blocks.join("\n\n") });
  const fence = (info: string) => `\`\`\`${info}\ncode\n\`\`\``;

  it("is empty when every code fence under Pattern names its file", () => {
    const body = pattern(
      fence("text"),
      fence('ts title="app/api/progress/route.ts"'),
      fence('tsx title="app/ProgressView.tsx"'),
    );
    expect(unlabelledPatternFences(body)).toEqual([]);
  });

  it("names a code fence without a title once the doc uses titles", () => {
    const body = pattern(fence('ts title="app/api/progress/route.ts"'), fence("js"));
    expect(unlabelledPatternFences(body)).toEqual(["```js"]);
  });

  it("lets a text fence go without a title", () => {
    const body = pattern(fence('ts title="app/x.ts"'), fence("text"));
    expect(unlabelledPatternFences(body)).toEqual([]);
  });

  it("is empty for a doc that has not adopted titles at all", () => {
    expect(unlabelledPatternFences(pattern(fence("js"), fence("tsx")))).toEqual([]);
  });

  it("ignores fences outside Pattern", () => {
    const body = doc(ATOM, {
      Pattern: fence('ts title="app/x.ts"'),
      Mechanism: fence("js"),
    });
    expect(unlabelledPatternFences(body)).toEqual([]);
  });
});
