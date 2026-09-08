import { createOpenAI } from "@ai-sdk/openai";

// OpenRouter exposes an OpenAI-compatible API, so this wraps it with
// @ai-sdk/openai's createOpenAI pointed at OpenRouter's base URL rather than
// using a dedicated OpenRouter SDK. run-model.ts, evals/executors.ts, and
// tool-calling.scorer.ts all import this one client — a fix here covers all
// three, no per-call-site changes needed.

// LANDMINE: StreamLake (an OpenRouter backend for deepseek/deepseek-v4-pro)
// returns degenerate near-empty completions for this model — confirmed via
// OpenRouter's own Activity dashboard cross-referenced against a real
// production incident (finishReason "stop", ~90 output tokens, empty
// text/toolCalls/content/reasoning/warnings — see run-model.ts's empty-
// completion diagnostics). @ai-sdk/openai's providerOptions.openai is a
// closed zod schema with no passthrough for unknown keys, so OpenRouter's
// own provider.ignore request-body field
// (https://openrouter.ai/docs/features/provider-routing) can only be
// injected via a fetch override, not providerOptions.
const EXCLUDED_OPENROUTER_PROVIDERS = ["streamlake"];

function injectProviderExclusions(init: RequestInit | undefined): RequestInit | undefined {
  if (typeof init?.body !== "string") return init;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body);
  } catch {
    return init;
  }
  const existingIgnore = (body.provider as { ignore?: string[] } | undefined)?.ignore ?? [];
  body.provider = {
    ...(body.provider as Record<string, unknown> | undefined),
    ignore: [...new Set([...existingIgnore, ...EXCLUDED_OPENROUTER_PROVIDERS])],
  };
  return { ...init, body: JSON.stringify(body) };
}

export const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  // Opt-in header that surfaces which backend provider served each request
  // under response.body.openrouter_metadata.endpoints
  // (https://openrouter.ai/docs/api-reference/chat-completion) — without it
  // there's no way to tell AtlasCloud from StreamLake short of manually
  // cross-referencing OpenRouter's own dashboard by timestamp, which is how
  // the StreamLake issue above was originally diagnosed.
  headers: { "X-OpenRouter-Metadata": "enabled" },
  fetch: (input, init) => fetch(input, injectProviderExclusions(init)),
});
