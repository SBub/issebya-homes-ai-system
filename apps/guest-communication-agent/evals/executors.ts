import { generateText, stepCountIs, type ToolSet } from "ai";
import { loadPrompt, traced } from "braintrust";
import { checkAvailability } from "@/agent/tools/availability";
import { sendBookingLink } from "@/agent/tools/booking";
import { getCurrentDate } from "@/agent/tools/current-date";
import { missingInfo } from "@/agent/tools/missing-info";
import { getPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion } from "@/agent/tools/property-question";
import { runCode } from "@/agent/tools/run-code";
import { wantsHuman } from "@/agent/tools/wants-human";
import { openrouter } from "@/lib/openrouter";
import type { EvalInput, SingleTurnResult } from "./types";

// Duplicated from run-agent-turn.ts's own MODEL/SYSTEM_PROMPT_SLUG module
// constants (neither exported) rather than imported — keeps this eval from
// depending on run-agent-turn.ts's own dispatch loop at all. Keep in sync by
// hand if those values ever change; there is no compiler check that would
// catch drift.
const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);
const MAX_OUTPUT_TOKENS = 1000;
const SYSTEM_PROMPT_SLUG = "gca-system";

// Every one of these tool() objects (get_pricing.ts, availability.ts, etc.)
// is schema-only — no `execute` field, same as run-tool.ts's own `tools`
// object (see that file's module comment near its `tools` literal, and
// each tool file's own "Schema-only declaration" comment). That means
// generateText below can only ever return the model's REQUESTED tool
// call(s); it has nothing it could actually dispatch even if it wanted to.
// That's exactly what a single-turn tool-SELECTION eval needs, and why
// nothing here needs mocking the way an earlier draft of this eval
// (real multi-round execution via runAgentTurn, with Postgres/Telegram/
// Supabase/Inngest faked out via vitest) did — there is no real side effect
// to prevent in the first place, because nothing downstream of "the model
// asked for tool X with args Y" ever runs.
const tools = {
  get_pricing: getPricing,
  check_availability: checkAvailability,
  answer_property_question: answerPropertyQuestion,
  send_booking_link: sendBookingLink,
  get_current_date: getCurrentDate,
  run_code: runCode,
  wants_human: wantsHuman,
  missing_info: missingInfo,
} satisfies ToolSet;

// Loads the real Braintrust-hosted system prompt (slug gca-system), same
// call shape run-agent-turn.ts's own loadSystemPromptText uses, no version
// pinning, so this eval always reflects whatever prompt text is actually
// live in production — a pinned eval would validate a prompt that isn't
// necessarily what's live, defeating the point of the eval gate. Returns
// the full CompiledPrompt (not just its rendered text) because build()'s
// `span_info` field — populated whenever the loaded Prompt has a real id,
// i.e. always here — carries exactly the {id, project_id, version,
// variables} shape generateTextWithPromptSpan below attaches to this eval's
// per-row LLM span; discarding it after build() would silently drop that.
async function loadCompiledSystemPrompt(contextBlock: string) {
  const promptTemplate = await loadPrompt({
    projectId: process.env.BRAINTRUST_PROJECT_ID,
    slug: SYSTEM_PROMPT_SLUG,
    defaults: { model: MODEL },
  });
  return promptTemplate.build({ guest_memory_block: contextBlock });
}

// Runs generateText inside its own child span, named/typed to match the
// "LLM"/type:"llm" span Braintrust's own Playground produces when running a
// prompt directly, carrying the loaded prompt's id/project_id/version under
// metadata.prompt — confirmed (by fetching a real Playground-created
// experiment's events; see docs/braintrust-online-eval-testing.md section
// 21) to be the exact mechanism Braintrust's UI reads to render an
// experiment row's "Prompt: <name>" attribution. A bare
// generateText call, or braintrust's own wrapAISDK, never produces this:
// wrapAISDK's automatic model-call child span doesn't forward a compiled
// prompt's span_info at all, and BraintrustMiddleware (the one helper whose
// config directly accepts span_info) predates this app's installed AI SDK's
// LanguageModelV3 middleware shape (braintrust ships LanguageModelV2Middleware
// — a real type/runtime mismatch, not just its own deprecation notice).
// compiled.span_info.metadata is exactly loadPrompt/build()'s documented
// payload for this ("Span info from loadPrompt for prompt version tracking",
// per BraintrustMiddleware's own MiddlewareConfig.spanInfo doc comment) —
// this just logs it directly via traced()/span.log instead of routing it
// through either of those two mismatched wrappers.
//
// metadata.prompt alone isn't enough for the UI's Prompt attribution to
// render — confirmed by diffing this span against a real Playground-run
// reference span (docs/braintrust-online-eval-testing.md section 22): the
// reference's LLM span also carries a real `input` (the compiled prompt's
// own single system message, `[{role: "system", content: <rendered text>}]`
// — not the full generateText messages/history), which this span must match
// structurally, plus real `metrics.prompt_tokens`/`completion_tokens`/
// `tokens`, both of which a bare span.log({output}) never populates.
async function generateTextWithPromptSpan(
  compiled: Awaited<ReturnType<typeof loadCompiledSystemPrompt>>,
  system: string,
  messages: EvalInput["messages"],
) {
  return traced(
    async (span) => {
      const result = await generateText({
        model,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(1),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      const promptTokens = result.usage.inputTokens ?? 0;
      const completionTokens = result.usage.outputTokens ?? 0;
      span.log({
        output: { text: result.text, toolCalls: result.toolCalls },
        metrics: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          tokens: promptTokens + completionTokens,
        },
      });
      return result;
    },
    {
      name: "LLM",
      type: "llm",
      event: {
        input: compiled.messages,
        metadata: compiled.span_info?.metadata,
      },
    },
  );
}

/**
 * Single-turn executor: input.messages is passed to generateText VERBATIM
 * (no history/incoming-message splitting, no synthetic message appended) —
 * dataset rows that already encode a multi-turn conversation, including a
 * prior real tool-call/tool-result pair (e.g. a guest message, then a
 * run_code call, then its real result, all already in `messages`), are
 * valid input as-is; the API has no objection to a message list that ends
 * on a tool-result instead of a fresh user turn, and the model just
 * continues reasoning from wherever the history left off. One real
 * generateText call (real model, real gca-system prompt) — tools are
 * declared with no `execute` so nothing they name can ever actually run;
 * the model's requested tool call(s), if any, are simply returned and
 * captured. stopWhen: stepCountIs(1) makes the single-round intent
 * explicit; with no `execute` on any tool, generateText has nothing to
 * auto-dispatch and would stop after one round regardless.
 */
export async function singleTurnWithMocks(input: EvalInput): Promise<SingleTurnResult> {
  const compiled = await loadCompiledSystemPrompt(input.contextBlock);
  const system = compiled.messages[0].content as string;

  const result = await generateTextWithPromptSpan(compiled, system, input.messages);

  const toolCalls = result.toolCalls.map((call) => ({
    toolName: call.toolName,
    args: call.input as Record<string, unknown>,
  }));

  return {
    toolCalls,
    toolNames: toolCalls.map((call) => call.toolName),
    text: result.text,
  };
}
