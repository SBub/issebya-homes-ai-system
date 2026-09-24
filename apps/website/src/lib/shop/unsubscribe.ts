/**
 * The wishlist unsubscribe link: its token, its URL, what a click does, and
 * keeping the token out of Sentry.
 *
 * Imports only `node:crypto`, the Supabase client type and the site origin,
 * so it runs in the vitest node pool.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/lib/site";

const UNSUBSCRIBE_PATH = "/shop/wishlist/unsubscribe";

// The same shape as the column default in the migration: 32 random bytes as
// 64 lowercase hex characters.
export function newUnsubscribeToken(): string {
  return randomBytes(32).toString("hex");
}

// `searchParams.token` may be a string, an array (a repeated param) or
// missing. Anything but a well-formed token is invalid without a DB call.
export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

// The one place the link's shape is written down.
export function unsubscribeUrl(token: string): string {
  return `${SITE_URL}${UNSUBSCRIBE_PATH}?token=${token}`;
}

type UnsubscribeOutcome = "unsubscribed" | "already" | "invalid";

/**
 * Flips the contact holding `token` to unsubscribed. Never deletes the
 * contact or any wished item. Errors carry the Postgres code only, never the
 * token or a message that might echo the filter.
 */
export async function resolveUnsubscribe(
  supabase: SupabaseClient,
  token: unknown,
): Promise<UnsubscribeOutcome> {
  if (!isUnsubscribeToken(token)) return "invalid";

  const { data: contact, error: lookupError } = await supabase
    .from("shop_wishlist_contacts")
    .select("marketing_opt_in, unsubscribed_at")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`shop_wishlist_contacts lookup failed: ${lookupError.code}`);
  }
  if (!contact) return "invalid";
  if (contact.unsubscribed_at || !contact.marketing_opt_in) return "already";

  // Filtered on `unsubscribed_at is null` so two concurrent clicks write once:
  // the second matches no row and is answered "already".
  const { data: updated, error: updateError } = await supabase
    .from("shop_wishlist_contacts")
    .update({ marketing_opt_in: false, unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .is("unsubscribed_at", null)
    .select("email");

  if (updateError) {
    throw new Error(`shop_wishlist_contacts unsubscribe failed: ${updateError.code}`);
  }
  return updated && updated.length > 0 ? "unsubscribed" : "already";
}

const RESULT_PATHS: Record<UnsubscribeOutcome, string> = {
  unsubscribed: `${UNSUBSCRIBE_PATH}/done`,
  already: `${UNSUBSCRIBE_PATH}/already`,
  invalid: `${UNSUBSCRIBE_PATH}/invalid`,
};

// Token-free result pages, so the address bar, analytics and the rendered
// page never carry the token.
export function unsubscribeResultPath(outcome: UnsubscribeOutcome): string {
  return RESULT_PATHS[outcome];
}

// --- Sentry scrubbing ---

// The span/context data keys that carry a request URL or its query.
const URL_DATA_KEYS = ["url.full", "url.query", "http.target", "http.url", "http.query"] as const;

type SpanData = Record<string, unknown> | undefined;

type ScrubbableEvent = {
  transaction?: string;
  request?: { url?: string; query_string?: unknown };
  contexts?: { trace?: { data?: SpanData } };
  spans?: { description?: string; data?: SpanData }[];
};

function redactToken(value: string): string {
  return value.replace(/token=[^&#\s]*/g, "token=[redacted]");
}

function redactData(data: SpanData) {
  if (!data) return;
  for (const key of URL_DATA_KEYS) {
    const value = data[key];
    if (typeof value === "string") data[key] = redactToken(value);
  }
}

function mentionsUnsubscribe(event: ScrubbableEvent): boolean {
  const data = [event.contexts?.trace?.data, ...(event.spans ?? []).map((span) => span.data)];
  const strings = [
    event.transaction,
    event.request?.url,
    ...(event.spans ?? []).map((span) => span.description),
    ...data.flatMap((d) => URL_DATA_KEYS.map((key) => d?.[key])),
  ];
  return strings.some((s) => typeof s === "string" && s.includes(UNSUBSCRIBE_PATH));
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction` hook. With `sendDefaultPii`
 * and every request traced, an unsubscribe request would otherwise ship its
 * full URL, token included. Only events about the unsubscribe route are
 * touched; everything else passes through unchanged.
 */
export function scrubUnsubscribeToken<T>(event: T): T {
  const e = event as ScrubbableEvent;
  if (!mentionsUnsubscribe(e)) return event;

  if (e.transaction) e.transaction = redactToken(e.transaction);
  if (e.request) {
    if (e.request.url) e.request.url = redactToken(e.request.url);
    const query = e.request.query_string;
    if (typeof query === "string") {
      e.request.query_string = redactToken(query);
    } else if (Array.isArray(query)) {
      e.request.query_string = query.map((pair: unknown) =>
        Array.isArray(pair) && pair[0] === "token" ? ["token", "[redacted]"] : pair,
      );
    } else if (query && typeof query === "object" && "token" in query) {
      e.request.query_string = { ...query, token: "[redacted]" };
    }
  }
  redactData(e.contexts?.trace?.data);
  for (const span of e.spans ?? []) {
    if (span.description) span.description = redactToken(span.description);
    redactData(span.data);
  }
  return event;
}
