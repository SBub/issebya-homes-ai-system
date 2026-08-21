const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

export async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    throw new Error("Could not process your request. The AI service is temporarily unavailable.");
  }
  const d = await r.json();
  return d.data[0].embedding;
}

export async function chatCompletion(options: {
  model?: string;
  system: string;
  user: string;
  json?: boolean;
}): Promise<string> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || "openai/gpt-4o-mini",
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter chat failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.choices[0].message.content;
}
