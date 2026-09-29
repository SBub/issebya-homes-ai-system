import { describe, expect, it } from "vitest";
import { checkSections, extractH2Headings } from "../sections";

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
