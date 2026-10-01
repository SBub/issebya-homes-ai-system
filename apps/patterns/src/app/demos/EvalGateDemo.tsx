"use client";

import { useState } from "react";
import { cases } from "@/lib/eval-gate/cases";
import {
  BREAK_MODES,
  type BreakMode,
  buildFixture,
  createScriptedExecutor,
} from "@/lib/eval-gate/executor";
import {
  averagedVerdict,
  evaluateGates,
  type EvalRun,
  formatPercent,
  type Gate,
  type GateResult,
  runEval,
} from "@/lib/eval-gate/gate";
import {
  aiDisclosure,
  createSecurityInvariantHeld,
  scriptedJudge,
  toolCallMatch,
} from "@/lib/eval-gate/scorers";

/** Each gated scorer against its own threshold. Pinned against the unbroken baseline, as production pins them against measured runs. */
const GATES: Gate[] = [
  { scorerName: "Tool Call Match", threshold: 0.85 },
  { scorerName: "AI Disclosure", threshold: 0.9 },
  { scorerName: "Security Invariant Held", threshold: 0.9 },
];

/** The one threshold the wrong, averaged gate would use. */
const AVERAGED_THRESHOLD = 0.9;

const SCORERS = [toolCallMatch, aiDisclosure, createSecurityInvariantHeld(scriptedJudge)];

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

function describeExpectation(evalCase: (typeof cases)[number]): string {
  const { toolCall, expectedAlternative, aiDisclosure: disclosure } = evalCase.expected;
  const parts = [
    toolCall === null
      ? expectedAlternative === "text-only" || expectedAlternative === null
        ? "no tool call"
        : `tool ${expectedAlternative}`
      : `tool ${toolCall.name}${toolCall.args ? ` ${JSON.stringify(toolCall.args)}` : ""}`,
  ];
  if (disclosure !== undefined) parts.push(`disclosure ${disclosure}`);
  if (evalCase.metadata?.securityInvariant !== undefined) parts.push("judge: invariant held");
  return parts.join(", ");
}

function verdictText(results: GateResult[], allPassed: boolean): string {
  if (allPassed) return "PASS: every gated scorer is at or above its own threshold.";
  const failing = results.filter((result) => !result.pass).map((result) => result.scorerName);
  return `FAIL: ${failing.join(", ")} below threshold. The other scorers do not lift it.`;
}

/**
 * Live demo for the `eval-gate-independent-thresholds` doc. Run evaluates
 * the five-case dataset through the scripted executor N trials per case,
 * scores every row with the three scorers, and checks each gated scorer
 * against its own threshold. The break select changes the scripted model's
 * answer on one case so the matching scorer, and only that one, drops; the
 * averaged number next to the verdict is what a single blended gate would
 * have said.
 */
export function EvalGateDemo() {
  const [mode, setMode] = useState<BreakMode>("none");
  const [trialCount, setTrialCount] = useState(3);
  const [run, setRun] = useState<{ eval: EvalRun; mode: BreakMode; trials: number } | null>(null);
  const [running, setRunning] = useState(false);

  const start = async () => {
    setRunning(true);
    const task = createScriptedExecutor(buildFixture(mode));
    const result = await runEval({ cases, task, scorers: SCORERS, trialCount });
    setRun({ eval: result, mode, trials: trialCount });
    setRunning(false);
  };

  const gates = run === null ? null : evaluateGates(run.eval.summary, GATES);
  const averaged =
    run === null ? null : averagedVerdict(run.eval.summary, GATES, AVERAGED_THRESHOLD);
  const failingRows =
    run === null
      ? []
      : run.eval.rows.filter((row) => Object.values(row.scores).some((score) => score === 0));

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Break
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as BreakMode)}
            className="rounded-sm border border-gray-300 bg-white px-2 py-1"
          >
            {BREAK_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Trials per case
          <input
            type="number"
            min={1}
            max={5}
            value={trialCount}
            onChange={(event) =>
              setTrialCount(Math.min(5, Math.max(1, Number(event.target.value))))
            }
            className="w-16 rounded-sm border border-gray-300 bg-white px-2 py-1"
          />
        </label>
        <button type="button" onClick={start} disabled={running} className={buttonClass}>
          Run
        </button>
      </div>

      <section aria-label="Dataset" className={`${boxClass} mt-3`}>
        <h3 className="font-bold">
          Dataset <span className="font-normal text-xs">({cases.length} cases)</span>
        </h3>
        <ul className="mt-1 font-mono text-xs space-y-1">
          {cases.map((evalCase) => (
            <li key={evalCase.id} className="[overflow-wrap:anywhere]">
              {evalCase.id}: expects {describeExpectation(evalCase)}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Scores" className={`${boxClass} mt-3`}>
        <h3 className="font-bold">
          Scores{" "}
          {run !== null && (
            <span className="font-normal text-xs">
              ({run.eval.summary.rows} rows: {cases.length} cases x {run.trials}{" "}
              {run.trials === 1 ? "trial" : "trials"})
            </span>
          )}
        </h3>
        {gates === null || run === null ? (
          <p className="mt-1 text-xs">Not run yet.</p>
        ) : (
          <>
            <table className="mt-2 w-full text-left font-mono text-xs">
              <thead>
                <tr>
                  <th className="pr-2">Scorer</th>
                  <th className="pr-2">Rows</th>
                  <th className="pr-2">Score</th>
                  <th className="pr-2">Threshold</th>
                  <th>Gate</th>
                </tr>
              </thead>
              <tbody>
                {gates.results.map((result) => (
                  <tr key={result.scorerName}>
                    <td className="pr-2">{result.scorerName}</td>
                    <td className="pr-2">{result.rows}</td>
                    <td className="pr-2">{formatPercent(result.actual)}</td>
                    <td className="pr-2">{formatPercent(result.threshold)}</td>
                    <td>{result.pass ? "PASS" : "FAIL"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p aria-label="Verdict" className="mt-2 font-bold">
              {verdictText(gates.results, gates.allPassed)}
            </p>
            {averaged !== null && (
              <p aria-label="Averaged" className="mt-1 text-xs text-gray-600">
                One averaged score would be {formatPercent(averaged.actual)} against{" "}
                {formatPercent(AVERAGED_THRESHOLD)}: {averaged.pass ? "PASS" : "FAIL"}
                {averaged.pass && !gates.allPassed ? ". That is the weak scorer hidden." : "."}
              </p>
            )}
          </>
        )}
      </section>

      <section aria-label="Failing rows" className={`${boxClass} mt-3`}>
        <h3 className="font-bold">
          Failing rows <span className="font-normal text-xs">({failingRows.length})</span>
        </h3>
        {failingRows.length === 0 ? (
          <p className="mt-1 text-xs">None.</p>
        ) : (
          <ul className="mt-1 font-mono text-xs space-y-1">
            {failingRows.map((row) => (
              <li key={`${row.caseId}-${row.trial}`} className="[overflow-wrap:anywhere]">
                {row.caseId} trial {row.trial + 1}:{" "}
                {Object.entries(row.scores)
                  .filter(([, score]) => score === 0)
                  .map(([name]) => `${name}: ${row.rationales[name]}`)
                  .join(" ")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
