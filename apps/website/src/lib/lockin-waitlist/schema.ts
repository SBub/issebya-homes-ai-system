/**
 * Validation, form state and the duplicate-merge rule for the lock-in
 * waitlist forms on `/lockin-waitlist`.
 *
 * Imports only `zod`, the shared email schema and the copy module, so it runs
 * in the vitest node pool. It lives outside `actions.ts` because a
 * "use server" file may only export async functions, and a schema is a value
 * export.
 */
import { z } from "zod";
import { emailSchema } from "@/lib/shared/schemas/email";
import {
  LOCKIN_DURATIONS,
  LOCKIN_FOLLOWUP_EMPTY,
  LOCKIN_FOLLOWUP_TOO_LONG,
  LOCKIN_LIFE_AREAS,
  LOCKIN_MONTHS,
  LOCKIN_OPT_IN_COPY,
  LOCKIN_OPT_IN_REQUIRED,
} from "./copy";

type Option = { readonly value: string };

// The option values as the non-empty tuple `z.enum` wants.
function optionValues<T extends readonly Option[]>(options: T) {
  return options.map((option) => option.value) as unknown as [
    T[number]["value"],
    ...T[number]["value"][],
  ];
}

const OFF_LIST = "Please choose one of the options";

// An unanswered single choice posts nothing (or ""), which means "not
// answered", never an error.
function optionalChoice<T extends readonly Option[]>(options: T) {
  return z
    .union([z.literal(""), z.enum(optionValues(options), { error: OFF_LIST })])
    .optional()
    .transform((value) => value || undefined);
}

export const lockinWaitlistSchema = z.object({
  // Normalised to match the `email = lower(btrim(email))` constraint.
  email: emailSchema,
  name: z
    .string()
    .trim()
    .max(100, "Please keep your name under 100 characters")
    .optional()
    .transform((value) => value || undefined),
  lifeArea: optionalChoice(LOCKIN_LIFE_AREAS),
  duration: optionalChoice(LOCKIN_DURATIONS),
  // `[]` means "not answered". Repeated values collapse to one.
  months: z
    .array(z.enum(optionValues(LOCKIN_MONTHS), { error: OFF_LIST }))
    .transform((months) => [...new Set(months)]),
  // Consent is a hard gate: only an affirmative tick passes.
  marketingOptIn: z.literal(true, { error: LOCKIN_OPT_IN_REQUIRED }),
  honeypot: z.string().max(0),
});

type LockinWaitlistInput = z.output<typeof lockinWaitlistSchema>;

// One mapping from the form's fields to the schema's input, shared by the
// action and its tests. The honeypot input is named `website` in the DOM:
// bots fill it, humans never see it. The short form simply posts no answers.
export function lockinWaitlistInputFromFormData(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    lifeArea: String(formData.get("lifeArea") ?? ""),
    duration: String(formData.get("duration") ?? ""),
    months: formData.getAll("months").map(String),
    marketingOptIn: formData.get("marketingOptIn") === "on",
    honeypot: String(formData.get("website") ?? ""),
  };
}

export const signupReasonSchema = z.object({
  // The same shape as every token this table issues: 64 lowercase hex.
  followupToken: z.string().regex(/^[0-9a-f]{64}$/),
  signupReason: z.string().trim().min(1, LOCKIN_FOLLOWUP_EMPTY).max(1000, LOCKIN_FOLLOWUP_TOO_LONG),
});

// Never reads an email: the token is the only key to this write.
export function signupReasonInputFromFormData(formData: FormData) {
  return {
    followupToken: String(formData.get("followupToken") ?? ""),
    signupReason: String(formData.get("signupReason") ?? ""),
  };
}

export type LockinWaitlistField =
  "email" | "name" | "lifeArea" | "duration" | "months" | "marketingOptIn";

// React resets an uncontrolled <form> as soon as an `action` submission
// starts. `email` and `answers` echo back only the visitor's own submitted
// input so the fields can be re-keyed and re-seeded. `followupToken` is returned only to the
// browser that made this submit and is the only key to the follow-up write.
// Nothing else ever comes back: no rows, and nothing about other visitors.
export type LockinWaitlistFormState = {
  attempt: number;
  ok: boolean;
  errors: Partial<Record<LockinWaitlistField, string>>;
  generalError: string;
  email: string;
  answers: LockinWaitlistAnswers;
  followupToken: string;
};

type LockinWaitlistAnswers = { name: string; lifeArea: string; duration: string; months: string[] };

export const initialLockinWaitlistState: LockinWaitlistFormState = {
  attempt: 0,
  ok: false,
  errors: {},
  generalError: "",
  email: "",
  answers: { name: "", lifeArea: "", duration: "", months: [] },
  followupToken: "",
};

export type SignupReasonFormState = {
  attempt: number;
  ok: boolean;
  errors: { signupReason?: string };
  generalError: string;
};

export const initialSignupReasonState: SignupReasonFormState = {
  attempt: 0,
  ok: false,
  errors: {},
  generalError: "",
};

type ExistingWaitlistRow = {
  name: string | null;
  life_area: string | null;
  duration: string | null;
  months: string[] | null;
  unsubscribed_at: string | null;
};

/**
 * The `lockin_waitlist` upsert payload for a submit, given the row the email
 * already has (if any).
 *
 * An answer left empty keeps the earlier one, so a short-form resubmit never
 * wipes the full form's answers. `signup_reason` is never in the payload, so
 * a resubmit keeps an earlier thank-you answer too. Every submit issues a
 * fresh `followup_token`. A subscribed row keeps its unsubscribe token, so
 * links in emails it already has keep working; an unsubscribed row consenting
 * again is flipped back to subscribed with a fresh one, so an old email's
 * link can never unsubscribe the renewed consent. A new row takes the token
 * from the column default.
 */
export function lockinWaitlistUpsert(
  input: LockinWaitlistInput,
  existing: ExistingWaitlistRow | null,
  now: string,
  newToken: () => string,
): { row: Record<string, unknown>; isNew: boolean; reconsented: boolean } {
  const row: Record<string, unknown> = {
    email: input.email,
    name: input.name ?? existing?.name ?? null,
    life_area: input.lifeArea ?? existing?.life_area ?? null,
    duration: input.duration ?? existing?.duration ?? null,
    months: input.months.length > 0 ? input.months : (existing?.months ?? null),
    marketing_opt_in: true,
    opted_in_at: now,
    opt_in_copy: LOCKIN_OPT_IN_COPY,
    followup_token: newToken(),
  };

  if (existing?.unsubscribed_at) {
    return {
      row: { ...row, unsubscribed_at: null, unsubscribe_token: newToken() },
      isNew: false,
      reconsented: true,
    };
  }

  return { row, isNew: existing === null, reconsented: false };
}
