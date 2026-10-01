import {
  evaluateGates,
  type Gate,
  type GateResult,
  type RowResult,
  runEval,
  type Summary,
} from "@/lib/eval-gate/gate";
import {
  aiDisclosure,
  createSecurityInvariantHeld,
  createToolCallMatch,
  scriptedJudge,
} from "@/lib/eval-gate/scorers";
import { type EvalCase, evalCaseSchema, type Executor } from "@/lib/eval-gate/types";

/**
 * The composite behind the `agent-release-gate` demo: the eval gate run
 * against the real tool registry. It is the shape of GCA's ci-gate-evals.ts
 * over evaluators.ts and the executor, with one rule the online scorers
 * add: scorers read the real tool definitions, never a hand-kept copy.
 *
 * - The registry handed to the model is the one the tool files export
 *   (tool-file-convention). A tool that is renamed there is renamed for the
 *   model on the same commit.
 * - Before any row runs, every tool name the dataset expects and every name
 *   on the scorer's args allowlist is checked against that registry. A name
 *   the registry does not have fails the gate with a reason, instead of
 *   letting the allowlist drift and the args go uncompared.
 * - Then the atom's run and gates: N trials, one threshold per scorer, any
 *   one failing fails the release (eval-gate-independent-thresholds).
 */

/** What the model sees: a name to a schema-only tool. The dispatcher is elsewhere. */
export type Registry = Record<string, { description: string }>;

/** Every name the dataset or the allowlist mentions must be a key of the registry. */
export function checkToolNames(
  cases: EvalCase[],
  argsScored: ReadonlySet<string>,
  registry: Registry,
): string[] {
  const known = Object.keys(registry);
  const have = `the registry has ${known.join(", ")}`;
  const problems: string[] = [];
  for (const evalCase of cases) {
    const names = [evalCase.expected.toolCall?.name, evalCase.expected.expectedAlternative].filter(
      (name): name is string => typeof name === "string" && name !== "text-only",
    );
    for (const name of names) {
      if (!known.includes(name)) {
        problems.push(`case ${evalCase.id} expects "${name}", which is not a tool; ${have}`);
      }
    }
  }
  for (const name of argsScored) {
    if (!known.includes(name)) {
      problems.push(
        `the args allowlist names "${name}", which is not a tool, so its args would never be compared; ${have}`,
      );
    }
  }
  return problems;
}

export type ReleaseGateOptions = {
  registry: Registry;
  cases: EvalCase[];
  task: Executor;
  argsScored: ReadonlySet<string>;
  gates: Gate[];
  trialCount: number;
  /** `false` is the wrong variant: no check, so a drifted allowlist quietly scores names only. */
  checkNames?: boolean;
};

export type ReleaseGateReport = {
  /** Why the gate failed before any row ran. Empty when the run happened. */
  problems: string[];
  /** The allowlist entries that are real tools: the only ones whose args get compared. */
  argsComparedFor: string[];
  summary: Summary | null;
  rows: RowResult[];
  gates: GateResult[];
  verdict: boolean;
};

export async function runReleaseGate(options: ReleaseGateOptions): Promise<ReleaseGateReport> {
  const known = Object.keys(options.registry);
  const argsComparedFor = [...options.argsScored].filter((name) => known.includes(name));
  const problems =
    options.checkNames === false
      ? []
      : checkToolNames(options.cases, options.argsScored, options.registry);
  if (problems.length > 0) {
    return { problems, argsComparedFor, summary: null, rows: [], gates: [], verdict: false };
  }
  const scorers = [
    createToolCallMatch(options.argsScored),
    aiDisclosure,
    createSecurityInvariantHeld(scriptedJudge),
  ];
  const run = await runEval({
    cases: options.cases,
    task: options.task,
    scorers,
    trialCount: options.trialCount,
  });
  const { results, allPassed } = evaluateGates(run.summary, options.gates);
  return {
    problems: [],
    argsComparedFor,
    summary: run.summary,
    rows: run.rows,
    gates: results,
    verdict: allPassed,
  };
}

/**
 * Renames a tool everywhere a JSON value mentions it, so the demo can show
 * a rename that reached the registry, the dataset and the model's answers
 * but not a hand-kept allowlist.
 */
export function renameToolInJson<T>(value: T, from: string, to: string): T {
  const renamed = JSON.stringify(value).replaceAll(JSON.stringify(from), JSON.stringify(to));
  return JSON.parse(renamed) as T;
}

/** The same for the dataset, validated again afterwards. */
export function renameToolInCases(cases: EvalCase[], from: string, to: string): EvalCase[] {
  return evalCaseSchema.array().parse(renameToolInJson(cases, from, to));
}
