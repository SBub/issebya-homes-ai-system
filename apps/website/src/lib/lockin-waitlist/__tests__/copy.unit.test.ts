import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as copy from "../copy";
import {
  LOCKIN_DURATIONS,
  LOCKIN_LIFE_AREAS,
  LOCKIN_MONTHS,
  LOCKIN_WHAT_IS,
  lockinWelcomeEmailText,
} from "../copy";

const UNSUBSCRIBE_URL = `https://issebya.com/lockin-waitlist/unsubscribe?token=${"a".repeat(64)}`;

// Every string reachable from the module's exports, plus the generated email.
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

const strings = [
  ...allStrings(Object.values(copy)),
  lockinWelcomeEmailText({ unsubscribeUrl: UNSUBSCRIBE_URL }),
];

const migration = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../../../../supabase/migrations/20261013120000_create_lockin_waitlist.sql",
  ),
  "utf8",
);

describe("lock-in waitlist copy", () => {
  it("has strings to check", () => {
    expect(strings.length).toBeGreaterThan(30);
  });

  it("never uses an em dash", () => {
    for (const s of strings) expect(s, s).not.toContain("—");
  });

  it("always spells the brand issebya.homes", () => {
    for (const s of strings) {
      expect(s, s).not.toMatch(/Issebya/);
      expect(s, s).not.toMatch(/issebya homes/i);
    }
  });

  it("never capitalises lock-in mid-sentence", () => {
    for (const s of strings) expect(s, s).not.toMatch(/[a-z,:] Lock-in/);
  });

  it("builds the welcome email from section 2 and the unsubscribe link", () => {
    const text = lockinWelcomeEmailText({ unsubscribeUrl: UNSUBSCRIBE_URL });

    for (const paragraph of LOCKIN_WHAT_IS) expect(text).toContain(paragraph);
    expect(text).toContain("You'll be the first to know when lock-in dates open.");
    expect(text.trimEnd().endsWith(UNSUBSCRIBE_URL)).toBe(true);
  });

  it.each([
    ["life_area", LOCKIN_LIFE_AREAS],
    ["duration", LOCKIN_DURATIONS],
    ["months", LOCKIN_MONTHS],
  ] as const)("offers exactly the %s values the migration allows", (column, options) => {
    // The column's CHECK, from its name to the closing parenthesis of the list.
    const check = migration.slice(migration.indexOf(`  ${column} `)).split(/\n {2}(?! )/)[0];
    const allowed = [...check.matchAll(/'([a-z0-9_]+)'/g)].map(([, value]) => value);

    expect(allowed).toEqual(options.map((option) => option.value));
  });
});
