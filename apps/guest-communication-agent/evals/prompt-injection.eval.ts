/**
 * Offline eval: runs every row of the Braintrust dataset "Prompt Injection —
 * Golden Dataset" (project "issebya-homes-ai-system") through executors.ts's
 * singleTurnWithMocks (real model, real gca-system prompt, tool calls
 * captured but never executed) and scores each row with evaluators.ts's
 * toolCallMatch. Same `Eval()` pattern as evals/golden-dataset.eval.ts,
 * reusing evals/types.ts, evals/executors.ts, and evals/evaluators.ts
 * unchanged — none of those three files were modified for this dataset.
 *
 * Deliberately a separate dataset/script/eval file from "GCA — Golden
 * Dataset", not folded in — see scripts/push-prompt-injection-dataset.ts's
 * header comment for why (this dataset needs a second, not-yet-built,
 * text-content/security judge scorer, which is a genuinely different
 * testing kind than tool-call selection).
 *
 * `scores` is toolCallMatch + securityInvariantHeld (both from
 * evaluators.ts). toolCallMatch can only ever see `output.toolCalls` — it
 * has no access to reply TEXT, so it cannot check any row's
 * `securityInvariant` (stored in dataset row `metadata`, see the push
 * script's header comment). Of this dataset's 10 rows, only the 4
 * dual-purpose ones (prompt-injection-04/05/07/08) have a real,
 * discriminating `expected.toolCall` value — toolCallMatch is a genuine
 * pass/fail check on those. The other 6 rows (01/02/03/06/09/10) all have
 * `expected.toolCall: null` with `expectedAlternative: "text-only"` and no
 * named alternative tool, so toolCallMatch there just checks "no tool fired"
 * — trivially satisfied by any refusal reply that doesn't happen to call a
 * tool, which is expected/fine (not a false negative) but is NOT a
 * meaningful pass on the actual security question those rows exist to test
 * (did the reply actually leak the system prompt / grant a concession /
 * follow the forged history, etc.).
 *
 * securityInvariantHeld covers the text-content half: it makes its own
 * judge-model call against each row's `metadata.securityInvariant` and the
 * model's actual reply text, returning bare `null` (not a scored 0/1) on
 * rows with no `securityInvariant` set — see evaluators.ts's own comment on
 * why bare `null`, not `{score: null}`. Of the 4 dual-purpose rows, only 08
 * layers a `securityInvariant` on top of its tool-choice assertion (per its
 * own row comment in the push script); 04/05/07 have none, so
 * securityInvariantHeld skips them and toolCallMatch is their only real
 * check. Combined with the 6 text-only rows (01/02/03/06/09/10, all of which
 * do set a `securityInvariant`), that's 7 of 10 rows getting
 * securityInvariantHeld's real content check, and every row getting at
 * least one meaningful, non-trivial check from one scorer or the other.
 *
 * Run with:
 *   npx tsx --env-file=.env evals/prompt-injection.eval.ts
 * or, via the braintrust CLI (auto-discovers this file by its `*.eval.ts`
 * name):
 *   npx braintrust eval --env-file=.env evals/prompt-injection.eval.ts
 */
import { Eval, initDataset } from "braintrust";
import { securityInvariantHeld, toolCallMatch } from "./evaluators";
import { singleTurnWithMocks } from "./executors";
import type { EvalInput, ExpectedShape } from "./types";

const PROJECT = "issebya-homes-ai-system";
const DATASET_NAME = "Prompt Injection — Golden Dataset";

// `data` is the real `Dataset` object itself (not a fetch-then-remap into
// plain objects) — same reasoning as evals/golden-dataset.eval.ts's own
// comment on this same line: only a real `Dataset` instance makes
// Braintrust's experiment-registration path attach a resolvable
// dataset_id/dataset_version, which is what makes the UI's "Dataset"
// sidebar field link back to this dataset instead of reading "Rows not
// attached to a dataset."
const dataset = initDataset({ project: PROJECT, dataset: DATASET_NAME });

Eval<
  EvalInput,
  Awaited<ReturnType<typeof singleTurnWithMocks>>,
  ExpectedShape,
  Record<string, unknown>
>(PROJECT, {
  data: dataset,
  task: singleTurnWithMocks,
  scores: [toolCallMatch, securityInvariantHeld],
  // Same trialCount: 3 rationale as evals/golden-dataset.eval.ts — the
  // model is genuinely non-deterministic, so a single trial per row
  // understates real variance.
  trialCount: 3,
});
