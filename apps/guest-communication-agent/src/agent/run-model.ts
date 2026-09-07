import type { Span } from "@opentelemetry/api";
import { generateText, type ModelMessage } from "ai";
import { tools } from "@/agent/run-tool";
import { openrouter } from "@/lib/openrouter";
import { markSpanFailed, type TraceAnchor, withTurnSpan } from "@/lib/tracing";

export const MODEL = "deepseek/deepseek-v4-pro";

// `.chat(MODEL)` targets Chat Completions — bare `openrouter(MODEL)` would
// target the Responses API, which OpenRouter doesn't support.
const model = openrouter.chat(MODEL);

// MODEL is a reasoning model: its internal "thinking" tokens draw from the
// same completion budget as the visible reply, so too low a cap can make it
// silently return an empty string. 1000 leaves headroom for both.
const MAX_OUTPUT_TOKENS = 1000;

// One model call per round. Since none of `tools` has an `execute`,
// generateText only ever returns the model's requested tool calls — it
// never runs them itself.
export interface ModelTurnResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>;
  response: { messages: ModelMessage[] };
}

// LANDMINE: a reasoning model can burn its whole completion on internal
// "thinking" tokens and return neither text nor a tool call, with
// finishReason "stop" (not "length") — generateText doesn't treat this as an
// error, so left alone it silently looks like a successful no-op turn
// everywhere except the guest, who gets nothing back. Retried up to 3 total
// attempts; "content-filter" (a deterministic moderation block) gives up
// immediately instead, since retrying can't fix it.
const MAX_MODEL_ATTEMPTS = 3;

export async function runModel(
  system: string,
  messages: ModelMessage[],
  turnAnchor: TraceAnchor,
): Promise<ModelTurnResult> {
  async function runModelChatTurn(span: Span): Promise<ModelTurnResult> {
    // Non-generic closure so `typeof callModel` gives `result` the exact
    // GenerateTextResult<typeof tools, ...> shape (the generic function's
    // own ReturnType widens back to a bare ToolSet).
    // experimental_telemetry auto-emits ai.generateText.doGenerate child
    // spans that Braintrust renders correctly on its own — no manual
    // braintrust.* duplication needed for these, unlike gen_ai.* below.
    const callModel = () =>
      generateText({
        model,
        system,
        messages,
        tools,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "gca.model_turn",
          metadata: { "gca.attempt": attempt },
        },
      });

    let result: Awaited<ReturnType<typeof callModel>>;
    let attempt = 0;
    for (;;) {
      attempt++;
      result = await callModel();
      const isEmpty = result.text.trim() === "" && result.toolCalls.length === 0;
      if (!isEmpty || result.finishReason === "content-filter" || attempt >= MAX_MODEL_ATTEMPTS) {
        break;
      }
      console.warn(
        `[run-model] runModel got empty output on attempt ${attempt}/${MAX_MODEL_ATTEMPTS} (finishReason: ${result.finishReason}) — retrying`,
      );
      // Same signal as the console.warn above, but attached to the span so
      // it's visible in the Axiom/Braintrust trace itself, not just server
      // logs nobody is watching. reasoningText: real production instances of
      // this (finishReason "stop", well under MAX_OUTPUT_TOKENS) show the
      // model produced SOME tokens despite the empty text/no-tool-calls
      // result — capturing what those were is the only way to diagnose why.
      // reasoningText alone turned out empty on a real occurrence too, so
      // content/warnings are captured alongside it — content is the raw
      // generated parts (could hold a dropped tool-error part) and warnings
      // surfaces a provider-level rejection generateText wouldn't otherwise
      // report as an error.
      span.addEvent("gen_ai.retry", {
        attempt,
        finishReason: result.finishReason,
        reasoningText: result.reasoningText ?? "(none captured)",
        content: JSON.stringify(result.content),
        warnings:
          result.warnings && result.warnings.length > 0
            ? JSON.stringify(result.warnings)
            : "(none)",
      });
    }

    span.setAttribute("gen_ai.input.messages", JSON.stringify(messages));
    span.setAttribute("gen_ai.output.messages", JSON.stringify(result.response.messages));
    span.setAttribute("gen_ai.response.finish_reason", result.finishReason);
    span.setAttribute("gen_ai.request.attempt_count", attempt);
    // Still empty after MAX_MODEL_ATTEMPTS (or gave up early on a
    // content-filter finish) — flag it so it shows up as an ERROR span
    // instead of blending into every other "OK" span in the trace. See
    // markSpanFailed's own comment for why this doesn't need to throw to
    // be visible.
    if (result.text.trim() === "" && result.toolCalls.length === 0) {
      // Set as real attributes (not just events) so they're visible without
      // expanding events in Braintrust's UI — reasoningText/warnings only
      // when non-empty, never unconditionally, since they can be large and
      // have no diagnostic value on a normal turn (this whole block only
      // runs on failure already, so that guard doesn't apply to `content` —
      // an explicitly empty "[]" despite non-zero output tokens is itself
      // the finding, not noise).
      if (result.reasoningText) {
        span.setAttribute("gen_ai.response.reasoning_text", result.reasoningText);
      }
      span.setAttribute("gen_ai.response.content", JSON.stringify(result.content));
      if (result.warnings && result.warnings.length > 0) {
        span.setAttribute("gen_ai.response.warnings", JSON.stringify(result.warnings));
      }
      markSpanFailed(
        span,
        `model returned empty text and no tool calls after ${attempt} attempt(s) (finishReason: ${result.finishReason}, outputTokens: ${result.usage?.outputTokens ?? "unknown"})`,
      );
    }

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input as Record<string, unknown>,
      })),
      response: { messages: result.response.messages },
    };
  }

  return withTurnSpan(
    turnAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    runModelChatTurn,
  );
}
