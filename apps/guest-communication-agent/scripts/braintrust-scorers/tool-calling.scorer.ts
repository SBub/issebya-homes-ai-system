/**
 * Registers "Correct Tool Calling" as a real Braintrust Scorer Function.
 * Fully self-contained — the judge logic below (live tool-description
 * rubric, chain-of-thought parsing, span/tag correlation) has no dependency
 * outside this file, node_modules, and the real tool definitions under
 * src/agent/tools/ (imported below so the rubric always reflects each
 * tool's actual live description, not a hand-copied snapshot).
 *
 * Single temperature-0 judge call per turn — the earlier 3-trial-averaging
 * design was removed because this scorer runs online on every real
 * production guest turn (not just in offline evals), so the extra 2 LLM
 * calls per trial were real, ongoing cost/latency overhead. See
 * docs/braintrust-online-eval-testing.md section 33.
 *
 * A Braintrust scorer function gets its sibling spans from
 * `trace.getSpans()` (the ScorerArgs.trace object — see braintrust's Trace
 * interface) instead of this app's own root_span_id-filtered REST fetch.
 * `trace.getSpans()` already scopes to the current trace's root_span_id (see
 * braintrust's LocalTrace/WrapperTrace doc comment: "fetch all rows for this
 * root span"), so every span it returns shares one root — the adapter below
 * gives them all the same sentinel root_span_id so gatherToolsCalled's own
 * `e.root_span_id === turn.root_span_id` filter (written for this app's
 * REST-fetch shape) still matches correctly without modification.
 *
 * Push with: yarn bt functions push --env-file=.env scripts/braintrust-scorers
 * (requires the OPENROUTER_API_KEY project env var — see
 * docs/braintrust-online-eval-testing.md section 6).
 */
import { generateText } from "ai";
import { projects, type SpanData, type Trace, wrapTraced } from "braintrust";
import { checkAvailability } from "../../src/agent/tools/availability";
import { sendBookingLink } from "../../src/agent/tools/booking";
import { getCurrentDate } from "../../src/agent/tools/current-date";
import { missingInfo } from "../../src/agent/tools/missing-info";
import { getPricing } from "../../src/agent/tools/pricing";
import { answerPropertyQuestion } from "../../src/agent/tools/property-question";
import { runCode } from "../../src/agent/tools/run-code";
import { wantsHuman } from "../../src/agent/tools/wants-human";
import { openrouter } from "../../src/lib/openrouter";

const project = projects.create({ name: "issebya-homes-ai-system" });

const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);

const CHOICE_SCORES: Record<string, number> = { A: 1.0, B: 0.5, C: 0.0 };

// Fails loudly rather than silently building a rubric with a blank
// description — the entire point of reading these live instead of a
// hardcoded copy is to catch drift, so a missing description should be an
// error, not a quiet no-op.
function toolDescription(name: string, t: { description?: string }): string {
  if (!t.description) {
    throw new Error(
      `Tool "${name}" has no description — cannot build the tool-calling rubric without it.`,
    );
  }
  return t.description;
}

// Read live from the same tool objects run-turn.ts imports and registers in
// its `tools` ToolSet (see that file's imports and the `tools = {...}`
// declaration) — the exact text the model sees when deciding whether to
// call a tool, not a hand-maintained copy of it. wants_human/missing_info
// keyed in snake_case to match the literal tool names the model sees (same
// as run-turn.ts's `tools` object).
const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_pricing: toolDescription("get_pricing", getPricing),
  check_availability: toolDescription("check_availability", checkAvailability),
  answer_property_question: toolDescription("answer_property_question", answerPropertyQuestion),
  get_current_date: toolDescription("get_current_date", getCurrentDate),
  run_code: toolDescription("run_code", runCode),
  send_booking_link: toolDescription("send_booking_link", sendBookingLink),
  wants_human: toolDescription("wants_human", wantsHuman),
  missing_info: toolDescription("missing_info", missingInfo),
};

// Tools whose gen_ai.tool.* span isn't guaranteed every time they fire (see
// SELF_STEPPED_TOOLS in run-turn.ts), so a guest_turn span's `tags` array is
// gatherToolsCalled's fallback signal for them: send_booking_link only gets
// one on the approved path (a rejected/timed-out call has no span, only the
// tag). missing_info and wants_human used to belong here too, but
// run-turn.ts's runMissingInfo/dispatchWantsHuman now each wrap their final
// result in a steppedSpan unconditionally — every exit path gets a real
// gen_ai.tool.missing_info/gen_ai.tool.wants_human span, so their tag is
// always redundant with a span gatherToolsCalled already found (defensive
// dedup still applies below regardless).
const TAG_ONLY_TOOLS = new Set(["send_booking_link"]);

const RUBRIC_PROMPT = `You are evaluating whether the issebya.homes WhatsApp concierge agent (a guest house in Almoçageme, Portugal) called the right tool(s), if any, while handling one guest message.

The concierge has these tools available, with the exact descriptions it sees when deciding whether to call one:
${Object.entries(TOOL_DESCRIPTIONS)
  .map(([name, description]) => `- ${name}: ${description}`)
  .join("\n")}

A turn that calls ZERO tools is a valid, common, correct outcome — e.g. a greeting, thanks, small talk, or a question answerable from the conversation history already in context. Do not penalize "no tool called" unless the guest message clearly needed one of the tools above (a price/date/availability/booking/knowledge-base question, or an explicit request for a human).

missing_info is a real human-in-the-loop gate, not just an alert: calling it suspends the turn until the owner actually replies (or a 24h timeout). Its tool output tells you exactly what happened while it waited — check that output's shape and hold the final reply to it:
- Output has a real \`answer\` field (e.g. \`{"escalated":true,"answer":"there is no BBQ at the house"}\`): the owner genuinely replied, so this is a CONFIRMED fact, not a guess. The reply should state it faithfully (paraphrasing is fine).
- Output has only the generic \`message\` field (e.g. \`{"escalated":true,"message":"The owner has been notified and will be in touch shortly."}\`, no \`answer\`): no real answer exists yet — the owner hasn't replied (timeout, or the nudge itself failed to send). The reply must NOT assert a specific, confident fact about the guest's question as if it were settled (e.g. "there's no BBQ," "X isn't allowed") — that is a premature guess dressed up as a confirmed answer, and defeats the entire point of the HITL gate. A reply that honestly holds the line ("I've asked the owner and will let you know shortly") is correct instead.

Guest message:
"""
{{input}}
"""

Tools called this turn (name, and real input/output where available — a rejected/timed-out send_booking_link never gets a logged input/output, only its name, since it's detected via a different code path):
{{toolsCalled}}

Concierge's final reply:
"""
{{output}}
"""

Choose exactly one:
A - Correct: the right tool(s) were called for what the guest actually needed (or correctly no tool at all), with no hallucinated or wrong tool and nothing obviously missing. If missing_info was called, the reply is grounded in its real \`answer\` output, or is an honest holding reply when only the generic \`message\` output is present.
B - Defensible: minor inefficiency or a judgment call — e.g. a tool call that wasn't strictly necessary but didn't hurt, or a redundant repeated call — without actually giving the guest a wrong or incomplete answer.
C - Wrong: a hallucinated/nonexistent tool name, the wrong tool for the question, a clearly-needed tool skipped (guest asked something only a tool could answer and none was called, or the reply guesses instead), a tool call that actively conflicts with what the guest asked, OR missing_info was called and its output has only the generic \`message\` fallback (no real \`answer\`) yet the reply confidently asserts a specific fact anyway — a premature guess presented as a confirmed answer.

Respond in exactly this format, nothing else:
Reasoning: <step-by-step reasoning about the rubric above, written BEFORE you decide — walk through what tool(s), if any, the guest message called for and whether what actually fired matches, then commit to a choice>
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

interface ToolCallingResult {
  score: number;
  rationale: string;
  choice: string;
}

interface ToolCallInfo {
  name: string;
  // Present whenever a real gen_ai.tool.* span was found (the 5 non-gated
  // tools, missing_info/wants_human unconditionally, and an approved
  // send_booking_link). Undefined only for a rejected/timed-out
  // send_booking_link, which is tag-only evidence — see TAG_ONLY_TOOLS above.
  input?: string;
  output?: string;
}

function formatToolsCalled(tools: ToolCallInfo[]): string {
  if (tools.length === 0) {
    return "(none — no tool was called this turn)";
  }
  return tools
    .map((t) =>
      t.input !== undefined
        ? `- ${t.name}: input=${t.input}, output=${t.output}`
        : `- ${t.name}: (no logged input/output — detected via turn tag only)`,
    )
    .join("\n");
}

// Scores one guest turn's tool selection against the tool-description
// rubric above with a single temperature-0 judge call. `input`/`output` are
// the guest's raw message and the concierge's raw reply text; `toolsCalled`
// is this turn's combined span-derived + tag-derived tool list (see
// gatherToolsCalled below). temperature: 0 doesn't fully eliminate
// provider-side non-determinism (an earlier dry run scored the same turn
// 0.5 in one run and 0.0 in another) — a single-pass score can still vary
// run-to-run; accepted as the cost/latency tradeoff for online scoring, see
// this file's header comment.
async function scoreToolCalling(turn: {
  input: string;
  output: string;
  toolsCalled: ToolCallInfo[];
}): Promise<ToolCallingResult> {
  const prompt = RUBRIC_PROMPT.replace("{{input}}", turn.input)
    .replace("{{toolsCalled}}", formatToolsCalled(turn.toolsCalled))
    .replace("{{output}}", turn.output);
  const result = await generateText({ model, prompt, temperature: 0 });
  const { choice, score, reasoning } = parseClassifierResponse(result.text);
  return { score, rationale: reasoning, choice };
}

interface BraintrustSpanEvent {
  span_id: string;
  root_span_id: string;
  span_attributes?: { name?: string };
  input: unknown;
  output: unknown;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

// Combines a guest_turn span's own tags with its sibling gen_ai.tool.*
// spans (same root_span_id — see this file's module comment) into one
// ToolCallInfo list. Tag-derived entries are deduped against span-derived
// ones defensively, even though SELF_STEPPED_TOOLS/dispatchToolExecution
// in run-turn.ts never actually emit both for the same tool name.
function gatherToolsCalled(
  turn: BraintrustSpanEvent,
  allEvents: BraintrustSpanEvent[],
): ToolCallInfo[] {
  const toolSpans = allEvents.filter(
    (e) =>
      e.root_span_id === turn.root_span_id && e.span_attributes?.name?.startsWith("gen_ai.tool."),
  );
  const fromSpans: ToolCallInfo[] = toolSpans.map((s) => ({
    name:
      (s.metadata?.["gen_ai.tool.name"] as string | undefined) ??
      (s.span_attributes?.name ?? "").replace(/^gen_ai\.tool\./, ""),
    input: typeof s.input === "string" ? s.input : JSON.stringify(s.input),
    output: typeof s.output === "string" ? s.output : JSON.stringify(s.output),
  }));

  const spanNames = new Set(fromSpans.map((t) => t.name));
  const fromTags: ToolCallInfo[] = (turn.tags ?? [])
    .filter((tag) => TAG_ONLY_TOOLS.has(tag) && !spanNames.has(tag))
    .map((tag) => ({ name: tag }));

  return [...fromSpans, ...fromTags];
}

const SENTINEL_ROOT = "current-trace";

function adaptSpan(s: SpanData, index: number): BraintrustSpanEvent {
  return {
    span_id: typeof s.span_id === "string" ? s.span_id : `span-${index}`,
    root_span_id: SENTINEL_ROOT,
    span_attributes: s.span_attributes,
    input: s.input,
    output: s.output,
    tags: (s as { tags?: string[] | null }).tags ?? null,
    metadata: s.metadata ?? null,
  };
}

const judge = wrapTraced(scoreToolCalling, { name: "tool-calling-judge" });

async function scoreOneTurn(input: string, output: string, trace: Trace | undefined) {
  const spans = trace ? await trace.getSpans() : [];
  const allEvents = spans.map(adaptSpan);
  const turnSpan = allEvents.find((e) => e.span_attributes?.name === "braintrust.guest_turn") ?? {
    span_id: "current",
    root_span_id: SENTINEL_ROOT,
    span_attributes: { name: "braintrust.guest_turn" },
    input,
    output,
    tags: null,
    metadata: null,
  };

  const toolsCalled = gatherToolsCalled(turnSpan, allEvents);
  const { score, rationale, choice } = await judge({ input, output, toolsCalled });
  return { score, rationale, choice, toolsCalled: toolsCalled.map((t) => t.name) };
}

project.scorers.create({
  name: "Correct Tool Calling",
  slug: "gca-correct-tool-calling",
  description:
    "LLM-judge scorer: did GCA call the right tool(s), if any, for the guest's message? Correlates sibling gen_ai.tool.* spans and tag-only tools (wants_human/missing_info/send_booking_link) via trace.getSpans(). Single temperature-0 judge call, real chain-of-thought.",
  ifExists: "replace",
  handler: async ({ input, output, trace }) => {
    // Braintrust's online-scoring rule fires on both the near-empty
    // start-trace span creation and the later real-data update-turn-trace-io
    // merge-patch (same braintrust.guest_turn row, two separate writes — see
    // docs/braintrust-online-eval-testing.md section 6c). The pre-patch pass
    // has no real turn text: confirmed against real fetched data that
    // `input`/`output` show up as either a non-string metadata object or an
    // empty string depending on invocation, never real guest/reply text —
    // skip it the same way the not-applicable HITL case does (bare `null`,
    // no judge call) instead of scoring garbage and wasting an LLM call.
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
    const { score, rationale, choice, toolsCalled } = await scoreOneTurn(
      rawInput,
      rawOutput,
      trace,
    );
    // `name` is required by braintrust's own `Score` shape
    // (node_modules/braintrust/dist/index.d.ts's `interface Score { name:
    // string; score: number | null; ... }`). Omitting it isn't a no-op: the
    // online-scoring log-write path only treats a returned object as a
    // literal Score when it carries a `name`; without one it falls back to
    // wrapping the *entire* return value as the raw score, producing a
    // non-numeric score and a real "Cannot log {...} as a score" error on
    // every write (confirmed on root_span_id 60cb1b38d83934c37b64a9879c9de07f
    // — see docs/braintrust-online-eval-testing.md section 6b).
    return {
      name: "Correct Tool Calling",
      score,
      metadata: { rationale, choice, toolsCalled },
    };
  },
});
