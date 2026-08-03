import { createOpenAI } from "@ai-sdk/openai";

// OpenRouter exposes an OpenAI-compatible API, so this wraps it with
// @ai-sdk/openai's createOpenAI pointed at OpenRouter's base URL rather than
// using a dedicated OpenRouter SDK.
export const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});
