import { describe, expect, it } from "vitest";
import { type PatternMeta, parsePatternMeta, usedBy, validateCollection } from "../schema";

const SHA = "a1410c6b3afa1ac500fc7018ca1ad42d5956e3b0";

const atom = {
  title: "An atom",
  kind: "atom",
  summary: "Read this when you need one technique.",
  tags: ["react-query"],
  code: [{ path: "apps/website/src/lib/shop/query-client.ts", ref: SHA, note: "The factory." }],
  verifiedIn: [164],
  updated: "2026-09-29",
};

const composite = { ...atom, title: "A composite", kind: "composite", uses: ["an-atom"] };

const withCodeRef = (ref: string) => ({ ...atom, code: [{ ...atom.code[0], ref }] });
const withCodePath = (path: string) => ({ ...atom, code: [{ ...atom.code[0], path }] });

describe("parsePatternMeta", () => {
  it("accepts a valid atom and a valid composite", () => {
    expect(parsePatternMeta(atom, "an-atom").kind).toBe("atom");
    expect(parsePatternMeta(composite, "a-composite").uses).toEqual(["an-atom"]);
  });

  it.each([
    ["a branch name", "develop"],
    ["a short SHA", "a1410c6"],
    ["40 characters with a non-hex letter", "g1410c6b3afa1ac500fc7018ca1ad42d5956e3b0"],
    ["uppercase hex", SHA.toUpperCase()],
  ])("rejects code.ref as %s", (_label, ref) => {
    expect(() => parsePatternMeta(withCodeRef(ref), "an-atom")).toThrow(
      "code.ref must be a 40-character commit SHA",
    );
  });

  it.each([
    ["a leading slash", "/apps/website/package.json"],
    ["a parent segment", "apps/../secrets.txt"],
    ["a URL", "https://github.com/SBub/issebya-homes-ai-system"],
  ])("rejects code.path with %s", (_label, path) => {
    expect(() => parsePatternMeta(withCodePath(path), "an-atom")).toThrow("code.path");
  });

  it("rejects a composite without uses", () => {
    const { uses: _uses, ...noUses } = composite;
    expect(() => parsePatternMeta(noUses, "a-composite")).toThrow("a composite must list");
    expect(() => parsePatternMeta({ ...composite, uses: [] }, "a-composite")).toThrow(
      "a composite must list",
    );
  });

  it("rejects an atom with uses", () => {
    expect(() => parsePatternMeta({ ...atom, uses: ["other"] }, "an-atom")).toThrow(
      "an atom must not have uses",
    );
  });

  it("rejects an updated day that does not exist", () => {
    expect(() => parsePatternMeta({ ...atom, updated: "2026-02-31" }, "an-atom")).toThrow(
      "not a real calendar date",
    );
  });

  it("rejects a summary with an em dash or two sentences", () => {
    expect(() =>
      parsePatternMeta({ ...atom, summary: "One thing — and another." }, "an-atom"),
    ).toThrow("em dash");
    expect(() =>
      parsePatternMeta({ ...atom, summary: "One sentence. Then another." }, "an-atom"),
    ).toThrow("one sentence");
  });

  it("names the slug in the error", () => {
    expect(() => parsePatternMeta({ ...atom, title: "" }, "broken-doc")).toThrow(
      'Invalid pattern doc "broken-doc"',
    );
  });
});

describe("validateCollection", () => {
  const atomMeta = parsePatternMeta(atom, "an-atom");
  const compositeMeta = parsePatternMeta(composite, "a-composite");
  const docs: { slug: string; meta: PatternMeta }[] = [
    { slug: "an-atom", meta: atomMeta },
    { slug: "a-composite", meta: compositeMeta },
  ];

  it("accepts a composite over an existing atom", () => {
    expect(() => validateCollection(docs)).not.toThrow();
  });

  it("rejects a composite using an unknown slug", () => {
    const meta = { ...compositeMeta, uses: ["missing"] };
    expect(() => validateCollection([docs[0]!, { slug: "a-composite", meta }])).toThrow(
      'a-composite uses unknown pattern "missing"',
    );
  });

  it("rejects duplicate slugs", () => {
    expect(() => validateCollection([...docs, docs[0]!])).toThrow(
      'Duplicate pattern slug: "an-atom"',
    );
  });

  it("rejects a composite using itself or another composite", () => {
    const self = { ...compositeMeta, uses: ["a-composite"] };
    expect(() => validateCollection([docs[0]!, { slug: "a-composite", meta: self }])).toThrow(
      "a-composite uses itself",
    );
    const other = { ...compositeMeta, uses: ["a-composite"] };
    expect(() => validateCollection([...docs, { slug: "b-composite", meta: other }])).toThrow(
      "which is a composite",
    );
  });

  it("lists the composites that use an atom", () => {
    expect(usedBy("an-atom", docs)).toEqual(["a-composite"]);
    expect(usedBy("a-composite", docs)).toEqual([]);
  });
});
