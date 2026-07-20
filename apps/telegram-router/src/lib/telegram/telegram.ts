const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number };
}

/** Minimal shape of Telegram's webhook Update payload — only the fields this app reads. */
interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  /** The message the button was attached to — needed to edit it after ack. */
  message?: { message_id: number; text?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

/**
 * Telegram delivery is optional and best-effort, same contract as every
 * other app's telegram.ts in this repo: a missing TELEGRAM_BOT_TOKEN/
 * TELEGRAM_CHAT_ID (or any delivery failure) no-ops / returns a result
 * object rather than throwing.
 */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function parseTelegramResponse(res: Response, action: string): Promise<TelegramApiResponse> {
  const body = (await res.json().catch(() => ({}))) as TelegramApiResponse;
  if (!res.ok || !body.ok) {
    throw new Error(
      `Telegram ${action} failed (${res.status}): ${body.description ?? JSON.stringify(body)}`,
    );
  }
  return body;
}

export interface SendMessageOptions {
  /** Telegram's HTML parse mode — needed for Orch-A's digest, which is
   * pre-rendered with `<b>`/`<i>` tags (see apps/orch-a/src/core/models.ts's
   * renderReport). Omitted entirely means plain text, same as before. */
  parseMode?: "HTML";
}

/** Plain text message, optionally with a single inline button (e.g. reminders' "✅ Done"). */
export async function sendMessage(
  text: string,
  button?: InlineButton,
  options?: SendMessageOptions,
): Promise<TelegramResult & { messageId?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: true };
  }

  try {
    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (button) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: button.text, callback_data: button.callbackData }]],
      };
    }
    if (options?.parseMode) {
      payload.parse_mode = options.parseMode;
    }
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await parseTelegramResponse(res, "sendMessage");
    return { ok: true, messageId: body.result?.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Retries a send once on failure — matches apps/orch-a's old `sendReport`
 * contract (2 attempts total), now generalized so every Telegram send in
 * this router (social replies, reminders, the digest) gets the same
 * retry-once behavior. Never throws: `send` itself (e.g. `sendMessage`)
 * already turns failures into a `{ ok: false }` result.
 */
export async function sendWithRetry<T extends TelegramResult>(send: () => Promise<T>): Promise<T> {
  const first = await send();
  if (first.ok) {
    return first;
  }
  return send();
}

/**
 * Must be called after handling any callback_query — otherwise the pressed
 * button shows a stuck loading spinner in the Telegram client indefinitely.
 * `text` (optional) shows as a brief toast to the user who pressed it.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    await parseTelegramResponse(res, "answerCallbackQuery");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Edits a previously-sent message's text and clears its inline keyboard (e.g. after ack). */
export async function editMessageText(messageId: number, text: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: { inline_keyboard: [] },
      }),
    });
    await parseTelegramResponse(res, "editMessageText");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
