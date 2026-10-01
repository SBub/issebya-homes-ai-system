"use client";

import { useState } from "react";
import { cases } from "@/lib/eval-gate/cases";
import { buildFixture, createScriptedExecutor } from "@/lib/eval-gate/executor";
import { formatPercent, type Gate } from "@/lib/eval-gate/gate";
import { ARGS_SCORED_TOOLS } from "@/lib/eval-gate/scorers";
import {
  type Registry,
  type ReleaseGateReport,
  renameToolInCases,
  renameToolInJson,
  runReleaseGate,
} from "@/lib/release-gate/release-gate";
import { checkDates } from "@/lib/tool-files/check-dates";
import { lookupRate } from "@/lib/tool-files/lookup-rate";
import { tools } from "@/lib/tool-files/run-tool";

const GATES: Gate[] = [
  { scorerName: "Tool Call Match", threshold: 0.85 },
  { scorerName: "AI Disclosure", threshold: 0.9 },
  { scorerName: "Security Invariant Held", threshold: 0.9 },
];

type Scenario = "in-sync" | "wrong-year" | "renamed";

const SCENARIOS: Array<{ value: Scenario; label: string }> = [
  { value: "in-sync", label: "Everything in step" },
  { value: "wrong-year", label: "The model sends the wrong year" },
  {
    value: "renamed",
    label:
      "check_dates renamed to check_availability in the registry, the dataset and the model, not in the scorer's allowlist, and the wrong year",
  },
];

/** The registry after a rename that reached the tool files. */
const RENAMED_REGISTRY: Registry = { check_availability: checkDates, lookup_rate: lookupRate };

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

/**
 * Live demo for the `agent-release-gate` doc. Run executes the release
 * gate: the tool names in the dataset and on the scorer's args allowlist
 * are checked against the registry the tool files export, then the
 * five-case dataset runs three trials through the scripted executor and
 * each scorer is held to its own threshold. The scenario select changes
 * what the model does and, in the last one, renames a tool everywhere but
 * the allowlist. The checkbox turns the name check off, which is the wrong
 * variant: the rename passes silently with the wrong year.
 */
export function ReleaseGateDemo() {
  const [scenario, setScenario] = useState<Scenario>("in-sync");
  const [checkNames, setCheckNames] = useState(true);
  const [report, setReport] = useState<{ registry: Registry; report: ReleaseGateReport } | null>(
    null,
  );
  const [running, setRunning] = useState(false);

  const start = async () => {
    setRunning(true);
    const renamed = scenario === "renamed";
    const fixture = buildFixture(scenario === "in-sync" ? "none" : "wrong-year");
    const registry = renamed ? RENAMED_REGISTRY : tools;
    const result = await runReleaseGate({
      registry,
      cases: renamed ? renameToolInCases(cases, "check_dates", "check_availability") : cases,
      task: createScriptedExecutor(
        renamed ? renameToolInJson(fixture, "check_dates", "check_availability") : fixture,
      ),
      argsScored: ARGS_SCORED_TOOLS,
      gates: GATES,
      trialCount: 3,
      checkNames,
    });
    setReport({ registry, report: result });
    setRunning(false);
  };

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Scenario
          <select
            value={scenario}
            onChange={(event) => setScenario(event.target.value as Scenario)}
            className="max-w-xl rounded-sm border border-gray-300 bg-white px-2 py-1"
          >
            {SCENARIOS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={start} disabled={running} className={buttonClass}>
          Run
        </button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={checkNames}
          onChange={(event) => setCheckNames(event.target.checked)}
        />
        Check the dataset and the allowlist against the registry before the run (off is wrong)
      </label>

      <section aria-label="Registry" className={`${boxClass} mt-3`}>
        <h3 className="font-bold">Registry handed to the model</h3>
        <p className="mt-1 font-mono text-xs">
          {Object.keys(report?.registry ?? tools).join(", ")}
        </p>
        <p className="mt-1 text-xs">
          Allowlist for args: {[...ARGS_SCORED_TOOLS].join(", ")}.{" "}
          {report !== null &&
            `Args compared for: ${report.report.argsComparedFor.length > 0 ? report.report.argsComparedFor.join(", ") : "no registered tool"}.`}
        </p>
      </section>

      <section aria-label="Release gate" className={`${boxClass} mt-3`}>
        <h3 className="font-bold">Release gate</h3>
        {report === null ? (
          <p className="mt-1 text-xs">Not run yet.</p>
        ) : report.report.problems.length > 0 ? (
          <>
            <p aria-label="Verdict" className="mt-1 font-bold">
              FAIL before any row ran.
            </p>
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">
              {report.report.problems.map((problem) => (
                <li key={problem} className="[overflow-wrap:anywhere]">
                  {problem}
                </li>
              ))}
            </ul>
          </>
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
                {report.report.gates.map((gate) => (
                  <tr key={gate.scorerName}>
                    <td className="pr-2">{gate.scorerName}</td>
                    <td className="pr-2">{gate.rows}</td>
                    <td className="pr-2">{formatPercent(gate.actual)}</td>
                    <td className="pr-2">{formatPercent(gate.threshold)}</td>
                    <td>{gate.pass ? "PASS" : "FAIL"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p aria-label="Verdict" className="mt-2 font-bold">
              {report.report.verdict
                ? report.report.argsComparedFor.length === 0
                  ? "PASS, and the wrong year was never compared. That is the silent pass."
                  : "PASS: every scorer at or above its own threshold, args compared."
                : `FAIL: ${report.report.gates
                    .filter((gate) => !gate.pass)
                    .map((gate) => gate.scorerName)
                    .join(", ")} below threshold.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
