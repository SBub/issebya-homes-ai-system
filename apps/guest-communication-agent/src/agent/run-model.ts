import type { Span } from "@opentelemetry/api";
import { generateText, type ModelMessage } from "ai";
import { tools } from "@/agent/run-tool";
import { openrouter } from "@/lib/openrouter";
import { markSpanFailed, type TraceAnchor, withTurnSpan } from "@/lib/tracing";

// Exported: run-turn.ts's loadSystemPromptText passes this as
// loadPrompt()'s `defaults.model` — that's system-prompt-loading, not
// model-call logic, so it stays in run-turn.ts rather than moving here too.
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

// A reasoning model can burn its whole completion on internal "thinking"
// tokens and come back with neither a text reply nor a tool call —
// generateText doesn't treat that as an error (finishReason is often "stop",
// not "length" — i.e. the model itself thinks it's done), so left alone this
// silently looks like a successful, no-op turn everywhere except the guest,
// who gets nothing back. Retrying is cheap insurance against exactly that
// kind of transient flakiness. "content-filter" is the one finishReason
// retrying can't fix — a deterministic moderation block — so that's the only
// reason this gives up immediately instead of spending the remaining
// attempts. 3 total attempts, not 3 retries: the first pass through the loop
// below counts as attempt 1.
const MAX_MODEL_ATTEMPTS = 3;

// This app's run<ToolName> convention, applied to the model call itself:
// run-turn.ts's dispatch loop calls this directly (one call per reasoning
// round), same shape as run-tool.ts's runTool or wants-human.ts's
// runWantsHuman.
export async function runModel(
  system: string,
  messages: ModelMessage[],
  turnAnchor: TraceAnchor,
): Promise<ModelTurnResult> {
  async function runModelChatTurn(span: Span): Promise<ModelTurnResult> {
    // Plain non-generic closure over `tools`, purely so `typeof callModel`
    // below gives `result` the exact GenerateTextResult<typeof tools, ...>
    // shape — `ReturnType<typeof generateText>` on the generic function
    // itself widens back to a bare ToolSet and loses the specific tool
    // types.
    // experimental_telemetry (the AI SDK's own OTel instrumentation, via the
    // same globally-registered tracer instrumentation.ts sets up) auto-emits
    // ai.generateText/ai.generateText.doGenerate child spans whose Input/
    // Output/usage Braintrust already renders correctly on its own — unlike
    // this app's own gen_ai.* attributes below, no braintrust.* duplication
    // needed for these child spans. metadata.gca.attempt reads `attempt`
    // live at each call, so it reflects the actual retry attempt per span.
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
      // logs nobody is watching.
      span.addEvent("gen_ai.retry", {
        attempt,
        finishReason: result.finishReason,
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
