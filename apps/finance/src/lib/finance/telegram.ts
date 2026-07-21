const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
}

/**
 * Telegram delivery is optional and best-effort, matching notion.ts's
 * contract: Postgres (finance_bookings) is already committed by the time
 * this runs, so a missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (or any
 * delivery failure) must no-op / return a result object rather than
 * throwing — it's a supplementary notification, not a hard dependency for
 * import to succeed.
 */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function parseTelegramResponse(res: Response, action: string): Promise<void> {
  const body = (await res.json().catch(() => ({}))) as TelegramApiResponse;
  if (!res.ok || !body.ok) {
    throw new Error(
      `Telegram ${action} failed (${res.status}): ${body.description ?? JSON.stringify(body)}`,
    );
  }
}

/** Plain text message via Telegram's sendMessage API. */
export async function sendMessage(text: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    await parseTelegramResponse(res, "sendMessage");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Uploads `content` as a file named `filename` via Telegram's sendDocument
 * API, using Node's built-in FormData/Blob (global since Node 18, no new
 * dependency needed) to build the multipart body. `content` accepts a
 * Buffer (e.g. the tourist-tax report's .xlsx binary) as well as a string
 * (e.g. the invoices CSV) — `mimeType` defaults to `text/csv` to keep that
 * existing call site unchanged.
 */
export async function sendDocument(
  filename: string,
  content: string | Buffer,
  caption?: string,
  mimeType = "text/csv",
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: true };
  }

  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption);
    // Buffer isn't directly assignable to BlobPart (TS's ArrayBuffer vs
    // ArrayBufferLike/SharedArrayBuffer strictness) — Uint8Array is.
    const blobContent = typeof content === "string" ? content : new Uint8Array(content);
    form.append("document", new Blob([blobContent], { type: mimeType }), filename);

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    await parseTelegramResponse(res, "sendDocument");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
