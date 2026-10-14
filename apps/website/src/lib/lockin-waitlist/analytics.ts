/**
 * The PostHog events the lock-in waitlist forms send, built from the forms'
 * action states. Never imports posthog-js, so it runs in the vitest node
 * pool; the components do the capture.
 *
 * Properties are picked one by one, never spread from the state: email, name,
 * tokens and the free-text reason must never reach PostHog.
 */
import type { LockinWaitlistFormState, SignupReasonFormState } from "./schema";

/** Which of the page's two forms the visitor submitted. */
export type LockinWaitlistForm = "short" | "full";

type AnalyticsEvent = { event: string; properties: Record<string, string | string[]> };

/**
 * `lockin_waitlist_joined` for a real join, otherwise null. The honeypot
 * answers with `ok: true` and an empty follow-up token, so the token is what
 * tells a real join apart. Unanswered questions are omitted, not sent empty.
 */
export function lockinWaitlistJoinedEvent(
  form: LockinWaitlistForm,
  state: LockinWaitlistFormState,
): AnalyticsEvent | null {
  if (!state.ok || state.followupToken === "") return null;
  const { lifeArea, duration, months } = state.answers;
  const properties: AnalyticsEvent["properties"] = { form };
  if (lifeArea !== "") properties.life_area = lifeArea;
  if (duration !== "") properties.duration = duration;
  if (months.length > 0) properties.months = [...months];
  return { event: "lockin_waitlist_joined", properties };
}

/** `lockin_waitlist_reason_added` when a real join's reason was saved, otherwise null. */
export function lockinWaitlistReasonAddedEvent(
  form: LockinWaitlistForm,
  followupToken: string,
  state: SignupReasonFormState,
): AnalyticsEvent | null {
  if (!state.ok || followupToken === "") return null;
  return { event: "lockin_waitlist_reason_added", properties: { form } };
}
