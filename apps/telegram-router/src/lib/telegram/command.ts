import type { TelegramUpdate } from "./telegram.js";

// Optional "@BotName" suffix Telegram appends in group chats; idea text can
// span multiple lines, hence [\s\S] instead of "." (which doesn't match \n).
const COMMAND_PATTERN = /^\/social(?:@\w+)?(?:\s+([\s\S]+))?$/i;

// Telegram attaches the "@BotName" mention directly to the command token
// itself (e.g. "/cron@IssebyaBot list"), not to the end of the phrase.
const CRON_LIST_PATTERN = /^\/cron(?:@\w+)?\s+list$/i;

/** Shared chat-gating + pattern match behind isCronListCommand. */
function isCommandFromHostChat(update: TelegramUpdate, pattern: RegExp): boolean {
  const message = update.message;
  if (!message?.text) {
    return false;
  }

  const expectedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!expectedChatId || String(message.chat.id) !== expectedChatId) {
    return false;
  }

  return pattern.test(message.text.trim());
}

/**
 * Extracts the post idea from a "/social <idea>" message. Returns null if
 * the update isn't a text message, isn't from the configured host chat, isn't
 * a /social command, or has no idea text after the command — any of which
 * means the webhook handler should silently ignore the update.
 */
export function parseSocialCommand(update: TelegramUpdate): string | null {
  const message = update.message;
  if (!message?.text) {
    return null;
  }

  const expectedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!expectedChatId || String(message.chat.id) !== expectedChatId) {
    return null;
  }

  const match = COMMAND_PATTERN.exec(message.text.trim());
  const idea = match?.[1]?.trim();
  return idea ? idea : null;
}

/**
 * True for a "/cron list" message from the configured host chat.
 */
export function isCronListCommand(update: TelegramUpdate): boolean {
  return isCommandFromHostChat(update, CRON_LIST_PATTERN);
}
