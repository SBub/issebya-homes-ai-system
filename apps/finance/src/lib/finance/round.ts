/** Round to 2 decimal places (cents) — shared by parsers.ts and formulas.ts. */
export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}
