/**
 * Offline eval: runs every row of the Braintrust dataset "GCA — Golden
 * Dataset" (project "issebya-homes-ai-system", id
 * 48e31bec-a623-423a-af24-a51258bfabf1) through executors.ts's
 * singleTurnWithMocks (real model, real gca-system prompt, tool calls
 * captured but never executed) and scores each row with evaluators.ts's
 * toolCallMatch. Distinct from scripts/braintrust-scorers/, which holds
 * ONLINE scorer Functions registered against real production traces — this
 * is an OFFLINE eval, run locally/in CI against the dataset, not wired into
 * Braintrust's online-scoring automation at all.
 *
 * There is exactly ONE golden dataset and this is the SOLE eval file for it
 * — one dataset, one push script (scripts/push-golden-dataset.ts), one eval
 * file. This dataset's 29 rows cover all four tool-selection decisions
 * (send_booking_link, get_pricing, missing_info, answer_property_question),
 * namespaced by id prefix (`booking-`, `pricing-`, `missing-info-`,
 * `property-question-` — see push-golden-dataset.ts for the full scheme).
 * An earlier version of this setup also kept four standalone per-segment
 * datasets and per-segment eval/push-script files alongside this merged
 * one — a confusing double-tracking pattern that's gone now: the standalone
 * datasets were deleted, and their push scripts/eval files were deleted or
 * consolidated into this one file and push-golden-dataset.ts. Any new
 * segment's rows go directly into push-golden-dataset.ts's row arrays with
 * a new namespace prefix, not a new standalone dataset/script/eval file.
 *
 * The dataset itself is the sole source of truth for these rows — there is
 * deliberately no local JSON mirror under evals/data/ (unlike the
 * single-turn-evals reference this file's structure follows), to avoid a
 * two-copies-can-drift problem with the real, live, UI-editable Braintrust
 * Dataset.
 *
 * Run with:
 *   npx tsx --env-file=.env evals/golden-dataset.eval.ts
 * or, via the braintrust CLI (auto-discovers this file by its `*.eval.ts`
 * name):
 *   npx braintrust eval --env-file=.env evals/golden-dataset.eval.ts
 */
import { Eval, initDataset } from "braintrust";
import { toolCallMatch } from "./evaluators";
import { singleTurnWithMocks } from "./executors";
import type { EvalInput, ExpectedShape } from "./types";

const PROJECT = "issebya-homes-ai-system";
const DATASET_NAME = "GCA — Golden Dataset";

// `data` is the real `Dataset` object itself (not a fetch-then-remap into
// plain objects) — see send-booking-link.eval.ts's own comment on this same
// line for why: only a real `Dataset` instance makes Braintrust's
// experiment-registration path attach a resolvable dataset_id/dataset_version,
// which is what makes the UI's "Dataset" sidebar field link back to this
// dataset instead of reading "Rows not attached to a dataset."
const dataset = initDataset({ project: PROJECT, dataset: DATASET_NAME });

// Exported (not just invoked) so scripts/ci-gate-evals.ts can `import` this
// file and `await` the real `EvalResultWithSummary` Eval() resolves to —
// its `.summary.scores["Tool Call Match"].score` is the real per-scorer
// average (ExperimentSummary/ScoreSummary, node_modules/braintrust/dist/
// index.d.ts) the gate checks against threshold. Importing this module is
// itself what triggers this real Eval() run (same as running this file
// directly via tsx) — the export just gives the importer a handle on the
// already-started run's result instead of a CLI-stdout to parse.
export const evalResult = Eval<
  EvalInput,
  Awaited<ReturnType<typeof singleTurnWithMocks>>,
  ExpectedShape,
  Record<string, unknown>
>(PROJECT, {
  data: dataset,
  task: singleTurnWithMocks,
  scores: [toolCallMatch],
  // Runs each row 3x — deepseek-v4-pro is genuinely non-deterministic (see
  // docs/braintrust-online-eval-testing.md section 18h's 100%/75%/50%/75%
  // spread across separate single-trial runs), so a single trial per row
  // understates real variance. Native braintrust option (Eval options'
  // `trialCount`, node_modules/braintrust/dist/index.d.ts), not hand-rolled.
  trialCount: 3,
});
