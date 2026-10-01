import dataset from "./dataset.json";
import { type EvalCase, evalCaseSchema } from "./types";

/**
 * The golden dataset behind the `eval-gate-independent-thresholds` demo:
 * five cases in a JSON file, validated once at load so a malformed row
 * fails here and not inside a scorer.
 */
export const cases: EvalCase[] = evalCaseSchema.array().parse(dataset);
