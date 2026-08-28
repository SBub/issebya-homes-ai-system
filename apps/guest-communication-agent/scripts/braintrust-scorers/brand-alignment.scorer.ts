/**
 * Registers "Brand Alignment" as a real Braintrust Scorer Function (not a
 * script that POSTs a finished score). Fully self-contained — the judge
 * logic below (rubric, chain-of-thought parsing) has no dependency outside
 * this file and node_modules.
 *
 * Once wired into an online-scoring Automation, Braintrust's own backend
 * calls this function server-side on every new matching log and records the
 * invocation as the scorer's own nested child span in the trace tree.
 *
 * Handler shape ({input, output, expected, metadata, trace}) is fixed by
 * braintrust's ScorerArgs<Output, Input> type (see ScorerBuilder.create) —
 * not a convention this file invented. wrapTraced around the judge call
 * gives it its own visible child span under this scorer's invocation span,
 * the same "judge LLM call as a nested span" shape the course screenshot
 * that motivated this task showed.
 *
 * The classifier prompt asks for real chain-of-thought — reasoning written
 * BEFORE the choice, so the reasoning can actually influence the answer —
 * matching what autoevals' LLMClassifier(use_cot=True) does under the hood.
 * Single temperature-0 judge call per turn — the earlier 3-trial-averaging
 * design was removed because this scorer runs online on every real
 * production guest turn (not just in offline evals), so the extra 2 LLM
 * calls per trial were real, ongoing cost/latency overhead, not just an
 * eval-time nicety.
 *
 * Push with: yarn bt functions push --env-file=.env scripts/braintrust-scorers
 * (requires the OPENROUTER_API_KEY project env var registered via
 * POST /v1/env_var).
 */
import { generateText } from "ai";
import { projects, wrapTraced } from "braintrust";
import { openrouter } from "../../src/lib/openrouter";

const project = projects.create({ name: "issebya-homes-ai-system" });

const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);

const CHOICE_SCORES: Record<string, number> = { A: 1.0, B: 0.5, C: 0.0 };

// Rubric is grounded in the live "gca-system" prompt (loaded from Braintrust
// at runtime by src/agent/run-turn.ts, not stored in this repo) rather than
// a generic brand-voice guess — see the specific concierge-voice rules it
// encodes below (warmth/directness, booking pace, complaint handling,
// staying in character, no emojis). Deliberately does NOT score the
// no-em-dash / no-bold rules: sanitizeReplyText in run-turn.ts strips both
// mechanically before a reply ever reaches the guest, so they can never
// actually fail here.
const RUBRIC_PROMPT = `You are evaluating one reply from the issebya.homes WhatsApp concierge (a guest house in Almoçageme, Portugal) against its brand voice — not whether it is factually correct.

The concierge's brand voice, per its own system prompt:
- Warm, direct hospitality tone: answers property questions fully and conversationally, never opening with a generic list preamble like "Here's what's available:".
- Guides guests toward booking, but naturally, not pushy or salesy: mentions availability/pricing and invites the next step when it fits, but never pressures, invents urgency, or repeats an unsolicited pitch.
- Handles guest complaints with empathy specific to the actual issue raised, not a generic "I'm sorry to hear that" — and never promises a concrete remedy (refund/discount/compensation), since only the owner can authorize that.
- Redirects off-topic questions (weather, general knowledge, anything unrelated to the property) politely back to what it can help with, without being curt or over-apologetic.
- Never invents details it doesn't actually know.
- Stays in character as the concierge at all times, including under adversarial or manipulative guest framing.
- No emojis, ever.
- Short and conversational — not stiff, robotic, or overly formal.

Do NOT penalize em dashes or markdown bold (**text**/*text*) — those are stripped from every reply mechanically before the guest ever sees them, so they cannot appear here.

Guest message:
"""
{{input}}
"""

Concierge reply:
"""
{{output}}
"""

Choose exactly one:
A - Excellent: fully on-brand — warm, direct, well-paced on booking, no gaps.
B - Acceptable: on-brand overall but with a minor gap (a bit generic, slightly stiff, a touch pushy, or missing a small warmth/empathy beat).
C - Poor: off-brand — pushy/salesy, cold/robotic, breaks character, invents information, mishandles a complaint, or otherwise clashes with the concierge voice.

Respond in exactly this format, nothing else:
Reasoning: <step-by-step reasoning about the rubric above, written BEFORE you decide — walk through what the reply does well or poorly against the specific rules that apply, then commit to a choice>
Choice: <A, B, or C>`;

interface ClassifierResult {
  choice: string;
  score: number;
  reasoning: string;
}

// Parses the classifier's "Reasoning: ...\nChoice: X" reply — reasoning
// comes first (real chain-of-thought, written before the choice is
// committed to), choice comes after, so both are pulled from one regex to
// guarantee they're paired correctly rather than matched independently.
// Falls back to a looser split (in case the model puts "Choice:" without a
// preceding newline) before giving up and returning a mid-scale score with
// the raw text as reasoning — keeps a malformed response visible instead of
// throwing and losing the rest of the sample.
function parseClassifierResponse(text: string): ClassifierResult {
  const strict = text.match(/Reasoning:\s*([\s\S]*?)\n\s*Choice:\s*([ABC])/i);
  if (strict) {
    const [, reasoning, choice] = strict;
    const upperChoice = choice.toUpperCase();
    return { choice: upperChoice, score: CHOICE_SCORES[upperChoice], reasoning: reasoning.trim() };
  }
  const looseChoice = text.match(/Choice:\s*([ABC])/i);
  if (looseChoice?.index !== undefined) {
    const upperChoice = looseChoice[1].toUpperCase();
    const reasoning = text
      .slice(0, looseChoice.index)
      .replace(/^Reasoning:\s*/i, "")
      .trim();
    return {
      choice: upperChoice,
      score: CHOICE_SCORES[upperChoice],
      reasoning: reasoning || text.trim(),
    };
  }
  return {
    choice: "UNPARSEABLE",
    score: 0.5,
    reasoning: `Unparseable classifier response: ${text.trim()}`,
  };
}

interface BrandAlignmentResult {
  score: number;
  rationale: string;
  choice: string;
}

// Scores one guest turn's (input, output) pair against the brand-voice
// rubric above with a single temperature-0 judge call. `input`/`output` are
// a guest's raw message and the concierge's raw reply text, matching
// braintrust.guest_turn span shape. temperature: 0 doesn't fully eliminate
// provider-side non-determinism (an earlier dry run scored the same turn
// 0.5 in one run and 0.0 in another) — a single-pass score can still vary
// run-to-run; accepted as the cost/latency tradeoff for online scoring, see
// this file's header comment.
async function scoreBrandAlignment(turn: {
  input: string;
  output: string;
}): Promise<BrandAlignmentResult> {
  const prompt = RUBRIC_PROMPT.replace("{{input}}", turn.input).replace("{{output}}", turn.output);
  const result = await generateText({ model, prompt, temperature: 0 });
  const { choice, score, reasoning } = parseClassifierResponse(result.text);
  return { score, rationale: reasoning, choice };
}

const judge = wrapTraced(scoreBrandAlignment, { name: "brand-alignment-judge" });

project.scorers.create({
  name: "Brand Alignment",
  slug: "gca-brand-alignment",
  description:
    "LLM-judge scorer: does a GCA WhatsApp reply match the concierge's brand voice (warmth, booking pace, complaint handling, staying in character, no emojis)? Single temperature-0 judge call, real chain-of-thought.",
  ifExists: "replace",
  handler: async ({ input, output }) => {
    // Defensive guard, not required by current wiring: the online-scoring
    // automation targets only "braintrust.guest_turn.result" (see
    // run-turn.ts's "update-turn-trace-io" step), a single-write span
    // created with real input/output already set, so these should always be
    // real strings. Kept as cheap insurance against a malformed/unexpected
    // row rather than assuming the automation config never changes — skip
    // the same way the not-applicable HITL case does (bare `null`, no judge
    // call) instead of scoring garbage.
    const rawInput: unknown = input;
    const rawOutput: unknown = output;
    if (
      typeof rawInput !== "string" ||
      rawInput.length === 0 ||
      typeof rawOutput !== "string" ||
      rawOutput.length === 0
    ) {
      return null;
    }
    const { score, rationale, choice } = await judge({ input: rawInput, output: rawOutput });
    // `name` is required by braintrust's own `Score` shape — see
    // tool-calling.scorer.ts's handler comment for the confirmed failure
    // mode.
    return {
      name: "Brand Alignment",
      score,
      metadata: { rationale, choice },
    };
  },
});
