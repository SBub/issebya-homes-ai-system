const NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/**
 * A card's position as a roman numeral. Standard notation only covers
 * 1 to 3999, so anything else throws rather than rendering nonsense.
 */
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) {
    throw new RangeError(`Cannot convert ${n} to a roman numeral (1 to 3999 only)`);
  }

  let remaining = n;
  let result = "";

  for (const [value, symbol] of NUMERALS) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }

  return result;
}
