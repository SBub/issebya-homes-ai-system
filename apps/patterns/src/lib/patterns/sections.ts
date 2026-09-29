import type { PatternMeta } from "./schema";

/**
 * The fixed H2 section order of a pattern doc, and the check that enforces it.
 * Pure string work, so it runs in the vitest node pool and in the index
 * generator alike.
 */

const ATOM_SECTIONS = ["Problem", "Mechanism", "Pattern", "Pitfalls", "When not to use", "Code"];
const COMPOSITE_SECTIONS = [
  "Problem",
  "Mechanism",
  "Combines",
  "Pattern",
  "Pitfalls",
  "When not to use",
  "Code",
];

/** Sections rendered from frontmatter, each holding nothing but its tag. */
const AUTO_SECTIONS: Record<string, string> = {
  Combines: "<Combines />",
  Code: "<CodeLinks />",
};

function expectedSections(kind: PatternMeta["kind"]): string[] {
  return kind === "atom" ? ATOM_SECTIONS : COMPOSITE_SECTIONS;
}

/** Drops a leading `---` YAML block, if there is one. */
function stripFrontmatter(body: string): string {
  const lines = body.split("\n");
  if (lines[0]?.trim() !== "---") return body;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end === -1 ? body : lines.slice(end + 1).join("\n");
}

type Section = { heading: string; lines: string[] };

/**
 * The H2 sections in order, each with the lines under it. Lines inside a
 * fenced code block (``` or ~~~, three or more) never start a section, so a
 * `## ` in a code sample is ignored. A fence closes only on the same
 * character, at least as long as the one that opened it.
 */
function splitSections(body: string): Section[] {
  const sections: Section[] = [];
  let fence: string | null = null;

  for (const line of stripFrontmatter(body).split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (fence === null && line.startsWith("## ")) {
      sections.push({ heading: line.slice(3).trim(), lines: [] });
      continue;
    }
    sections.at(-1)?.lines.push(line);
  }
  return sections;
}

export function extractH2Headings(body: string): string[] {
  return splitSections(body).map((section) => section.heading);
}

// A markdown link `](` or an HTML anchor. Flat patterns, no nested quantifiers.
const LINK_PATTERN = /\]\(|<a[\s>]/i;

/**
 * Every problem with the doc's section structure; empty when it is fine.
 * The H2s must equal the expected list exactly, and the auto-rendered
 * sections must contain only their component tag, which is what keeps code
 * links generated from frontmatter rather than written by hand.
 */
export function checkSections(body: string, kind: PatternMeta["kind"]): string[] {
  const problems: string[] = [];
  const sections = splitSections(body);
  const actual = sections.map((section) => section.heading);
  const expected = expectedSections(kind);

  if (actual.join("\n") !== expected.join("\n")) {
    problems.push(
      `sections must be exactly [${expected.join(", ")}] in that order, found [${actual.join(", ")}]`,
    );
  }

  for (const { heading, lines } of sections) {
    const tag = AUTO_SECTIONS[heading];
    if (tag === undefined) continue;
    const content = lines.join("\n");
    if (heading === "Code" && LINK_PATTERN.test(content)) {
      problems.push("## Code must not contain hand-written links");
    }
    if (content.replace(/\s+/g, "") !== tag.replace(/\s+/g, "")) {
      problems.push(`## ${heading} must contain only ${tag}`);
    }
  }
  return problems;
}
