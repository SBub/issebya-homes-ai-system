import { describe, expect, it } from "vitest";
import { cases } from "@/lib/eval-gate/cases";
import { buildFixture, createScriptedExecutor } from "@/lib/eval-gate/executor";
import type { Gate } from "@/lib/eval-gate/gate";
import { ARGS_SCORED_TOOLS } from "@/lib/eval-gate/scorers";
import { checkDates } from "@/lib/tool-files/check-dates";
import { lookupRate } from "@/lib/tool-files/lookup-rate";
import { tools } from "@/lib/tool-files/run-tool";
import {
  checkToolNames,
  type Registry,
  renameToolInCases,
  renameToolInJson,
  runReleaseGate,
} from "../release-gate";

const GATES: Gate[] = [
  { scorerName: "Tool Call Match", threshold: 0.85 },
  { scorerName: "AI Disclosure", threshold: 0.9 },
  { scorerName: "Security Invariant Held", threshold: 0.9 },
];

const RENAMED_REGISTRY: Registry = { check_availability: checkDates, lookup_rate: lookupRate };

describe("checkToolNames", () => {
  it("passes when every expected name and allowlist entry is a registered tool", () => {
    expect(checkToolNames(cases, ARGS_SCORED_TOOLS, tools)).toEqual([]);
  });

  it("names a dataset row and an allowlist entry that the registry does not have", () => {
    const problems = checkToolNames(cases, ARGS_SCORED_TOOLS, RENAMED_REGISTRY);
    expect(problems).toEqual([
      'case dates-01 expects "check_dates", which is not a tool; the registry has check_availability, lookup_rate',
      'the args allowlist names "check_dates", which is not a tool, so its args would never be compared; the registry has check_availability, lookup_rate',
    ]);
  });

  it("ignores text-only and null alternatives", () => {
    const textOnly = cases.filter((evalCase) => evalCase.expected.toolCall === null);
    expect(checkToolNames(textOnly, new Set(), {})).toEqual([]);
  });
});

describe("runReleaseGate", () => {
  it("passes on the registry the tool files export and compares args for the allowlist", async () => {
    const report = await runReleaseGate({
      registry: tools,
      cases,
      task: createScriptedExecutor(buildFixture("none")),
      argsScored: ARGS_SCORED_TOOLS,
      gates: GATES,
      trialCount: 3,
    });
    expect(report.problems).toEqual([]);
    expect(report.argsComparedFor).toEqual(["check_dates"]);
    expect(report.verdict).toBe(true);
    expect(report.summary?.scores["Tool Call Match"]).toEqual({ score: 1, rows: 15 });
  });

  it("fails loud on a wrong year while the names stay in sync", async () => {
    const report = await runReleaseGate({
      registry: tools,
      cases,
      task: createScriptedExecutor(buildFixture("wrong-year")),
      argsScored: ARGS_SCORED_TOOLS,
      gates: GATES,
      trialCount: 3,
    });
    expect(report.verdict).toBe(false);
    expect(report.gates[0]).toMatchObject({
      scorerName: "Tool Call Match",
      actual: 0.8,
      pass: false,
    });
  });

  it("a rename that missed the allowlist fails before any row runs", async () => {
    const renamedCases = renameToolInCases(cases, "check_dates", "check_availability");
    const fixture = renameToolInJson(
      buildFixture("wrong-year"),
      "check_dates",
      "check_availability",
    );
    const report = await runReleaseGate({
      registry: RENAMED_REGISTRY,
      cases: renamedCases,
      task: createScriptedExecutor(fixture),
      argsScored: ARGS_SCORED_TOOLS,
      gates: GATES,
      trialCount: 3,
    });
    expect(report.verdict).toBe(false);
    expect(report.rows).toEqual([]);
    expect(report.problems).toEqual([
      'the args allowlist names "check_dates", which is not a tool, so its args would never be compared; the registry has check_availability, lookup_rate',
    ]);
    expect(report.argsComparedFor).toEqual([]);
  });

  it("without the check, the same rename passes silently with the wrong year", async () => {
    const renamedCases = renameToolInCases(cases, "check_dates", "check_availability");
    const fixture = renameToolInJson(
      buildFixture("wrong-year"),
      "check_dates",
      "check_availability",
    );
    const report = await runReleaseGate({
      registry: RENAMED_REGISTRY,
      cases: renamedCases,
      task: createScriptedExecutor(fixture),
      argsScored: ARGS_SCORED_TOOLS,
      gates: GATES,
      trialCount: 3,
      checkNames: false,
    });
    expect(report.problems).toEqual([]);
    expect(report.verdict).toBe(true);
    expect(report.summary?.scores["Tool Call Match"]).toEqual({ score: 1, rows: 15 });
    expect(report.argsComparedFor).toEqual([]);
  });
});
