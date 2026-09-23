import { describe, expect, it } from "vitest";
import { toRoman } from "../roman";

describe("toRoman", () => {
  it.each([
    [1, "I"],
    [4, "IV"],
    [9, "IX"],
    [14, "XIV"],
    [40, "XL"],
    [3999, "MMMCMXCIX"],
  ])("converts %i to %s", (n, expected) => {
    expect(toRoman(n)).toBe(expected);
  });

  it.each([0, 4000, 1.5, -1])("throws for %s", (n) => {
    expect(() => toRoman(n)).toThrow(RangeError);
  });
});
