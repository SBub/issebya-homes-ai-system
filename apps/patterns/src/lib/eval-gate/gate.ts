import type { EvalCase, Executor, Scorer, SingleTurnResult } from "./types";

/**
 * The run and the gate behind the `eval-gate-independent-thresholds` demo.
 * `runEval` runs every case `trialCount` times through the executor and
 * every scorer, and summarises each scorer as the mean of the rows it
 * scored (a skipped row is left out, not counted as zero). `evaluateGates`
 * checks each gated scorer against its own threshold and fails on any one,
 * so a strong scorer can never hide a weak one. `averagedVerdict` is the
 * wrong shape the demo shows for contrast: one number over every scorer.
 */

export type RowResult = {
  caseId: string;
  trial: number;
  output: SingleTurnResult;
  /** One entry per scorer; `null` when the scorer skipped the row. */
  scores: Record<string, number | null>;
  rationales: Record<string, string>;
};

type ScoreSummary = { score: number; rows: number };

/** Per-scorer means, as an experiment summary reports them. A scorer that scored no row is absent. */
export type Summary = { scores: Record<string, ScoreSummary>; rows: number };

export type EvalRun = { rows: RowResult[]; summary: Summary };

export async function runEval(options: {
  cases: EvalCase[];
  task: Executor;
  scorers: Scorer[];
  trialCount: number;
}): Promise<EvalRun> {
  const rows: RowResult[] = [];
  for (const evalCase of options.cases) {
    for (let trial = 0; trial < options.trialCount; trial++) {
      const output = await options.task(evalCase.input, { trial });
      const scores: RowResult["scores"] = {};
      const rationales: RowResult["rationales"] = {};
      for (const scorer of options.scorers) {
        const score = await scorer({
          input: evalCase.input,
          output,
          expected: evalCase.expected,
          metadata: evalCase.metadata,
        });
        if (score === null) continue;
        scores[score.name] = score.score;
        const rationale = score.metadata?.rationale;
        rationales[score.name] = typeof rationale === "string" ? rationale : "";
      }
      rows.push({ caseId: evalCase.id, trial, output, scores, rationales });
    }
  }
  return { rows, summary: summarize(rows) };
}

export function summarize(rows: RowResult[]): Summary {
  const totals = new Map<string, { sum: number; rows: number }>();
  for (const row of rows) {
    for (const [name, score] of Object.entries(row.scores)) {
      if (score === null) continue;
      const total = totals.get(name) ?? { sum: 0, rows: 0 };
      totals.set(name, { sum: total.sum + score, rows: total.rows + 1 });
    }
  }
  const scores: Summary["scores"] = {};
  for (const [name, total] of totals) {
    scores[name] = { score: total.sum / total.rows, rows: total.rows };
  }
  return { scores, rows: rows.length };
}

export type Gate = { scorerName: string; threshold: number };

export type GateResult = {
  scorerName: string;
  threshold: number;
  actual: number | null;
  rows: number;
  pass: boolean;
  reason: string | null;
};

/** One gate: its scorer's mean against its own threshold. A scorer missing from the summary fails, never passes by default. */
function evaluateGate(summary: Summary, gate: Gate): GateResult {
  const scoreSummary = summary.scores[gate.scorerName];
  if (scoreSummary === undefined) {
    const found = Object.keys(summary.scores).join(", ") || "none";
    return {
      scorerName: gate.scorerName,
      threshold: gate.threshold,
      actual: null,
      rows: 0,
      pass: false,
      reason: `scorer "${gate.scorerName}" scored no row (found: ${found})`,
    };
  }
  return {
    scorerName: gate.scorerName,
    threshold: gate.threshold,
    actual: scoreSummary.score,
    rows: scoreSummary.rows,
    pass: scoreSummary.score >= gate.threshold,
    reason: null,
  };
}

/** Every gate on its own; the verdict is true only when all of them pass. */
export function evaluateGates(
  summary: Summary,
  gates: Gate[],
): { results: GateResult[]; allPassed: boolean } {
  const results = gates.map((gate) => evaluateGate(summary, gate));
  return { results, allPassed: results.every((result) => result.pass) };
}

/**
 * The wrong shape: every gated scorer's mean averaged into one number
 * against one threshold. Two perfect scorers lift a failing one over the
 * line. Kept so the demo can show the number next to the right verdict.
 */
export function averagedVerdict(
  summary: Summary,
  gates: Gate[],
  threshold: number,
): { actual: number | null; pass: boolean } {
  const means = gates
    .map((gate) => summary.scores[gate.scorerName]?.score)
    .filter((score): score is number => score !== undefined);
  if (means.length === 0) return { actual: null, pass: false };
  const actual = means.reduce((sum, score) => sum + score, 0) / means.length;
  return { actual, pass: actual >= threshold };
}

export function formatPercent(value: number | null): string {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}
