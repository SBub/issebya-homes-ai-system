"use server";

import { addBreadcrumb, captureException, startSpan } from "@sentry/nextjs";
import { LOCKIN_ERROR_COPY } from "@/lib/lockin-waitlist/copy";
import {
  type LockinWaitlistField,
  type LockinWaitlistFormState,
  lockinWaitlistInputFromFormData,
  lockinWaitlistSchema,
  lockinWaitlistUpsert,
  type SignupReasonFormState,
  signupReasonInputFromFormData,
  signupReasonSchema,
} from "@/lib/lockin-waitlist/schema";
import { newLockinToken } from "@/lib/lockin-waitlist/unsubscribe";
import { sendLockinWaitlistWelcomeEmail } from "@/lib/resend";
import { createAdminClient } from "@/lib/shared/supabase";
import { formatZodErrors } from "@/lib/shared/validation";

const FORM_FIELDS: readonly LockinWaitlistField[] = [
  "email",
  "name",
  "lifeArea",
  "duration",
  "months",
  "marketingOptIn",
];

function isFormField(field: string): field is LockinWaitlistField {
  return (FORM_FIELDS as readonly string[]).includes(field);
}

// Shared by the hero's short form and the full form: the short form simply
// posts no answers, and the merge keeps whatever the email answered before.
export async function joinLockinWaitlist(
  prevState: LockinWaitlistFormState,
  formData: FormData,
): Promise<LockinWaitlistFormState> {
  const attempt = prevState.attempt + 1;
  const raw = lockinWaitlistInputFromFormData(formData);
  const email = raw.email.trim();
  const answers = {
    name: raw.name,
    lifeArea: raw.lifeArea,
    duration: raw.duration,
    months: raw.months,
  };
  const echo = { attempt, email, answers };

  const parsed = lockinWaitlistSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);

    // Checked before any other field, and answered with the success shape and
    // no DB call, so a bot never learns which field gave it away. The empty
    // follow-up token makes its thank-you answer a silent no-op.
    if (issues.some(({ field }) => field === "honeypot")) {
      addBreadcrumb({ category: "lockin", message: "Waitlist honeypot tripped", level: "info" });
      return { ...echo, ok: true, errors: {}, generalError: "", followupToken: "" };
    }

    const errors: LockinWaitlistFormState["errors"] = {};
    for (const { field, message } of issues) {
      // An off-list month reports as `months.0`; it belongs to the group.
      const [root] = field.split(".");
      if (isFormField(root)) errors[root] ??= message;
    }
    return { ...echo, ok: false, errors, generalError: "", followupToken: "" };
  }

  const failure: LockinWaitlistFormState = {
    ...echo,
    ok: false,
    errors: {},
    generalError: LOCKIN_ERROR_COPY,
    followupToken: "",
  };

  // Nothing about the visitor goes into Sentry, the email least of all.
  return startSpan(
    {
      name: "lockin.waitlist.join",
      op: "http.server",
      attributes: { "http.route": "lockin.joinLockinWaitlist" },
    },
    async () => {
      const supabase = createAdminClient();

      // Read first: the merge keeps earlier answers, and an unsubscribed
      // email consenting again needs its consent flipped and token rotated.
      const { data: existing, error: lookupError } = await supabase
        .from("lockin_waitlist")
        .select("name, life_area, duration, months, unsubscribed_at")
        .eq("email", parsed.data.email)
        .maybeSingle();

      if (lookupError) {
        captureException(lookupError, { tags: { "db.operation": "lockin_waitlist_select" } });
        return failure;
      }

      const { row, isNew, reconsented } = lockinWaitlistUpsert(
        parsed.data,
        existing,
        new Date().toISOString(),
        newLockinToken,
      );

      // The tokens come back so the email carries whichever unsubscribe token
      // is now stored, and the browser gets this submit's follow-up key.
      const { data: stored, error: upsertError } = await supabase
        .from("lockin_waitlist")
        .upsert(row, { onConflict: "email" })
        .select("unsubscribe_token, followup_token")
        .single();

      if (upsertError) {
        captureException(upsertError, { tags: { "db.operation": "lockin_waitlist_upsert" } });
        return failure;
      }

      // A new sign-up, or a renewed consent, is welcomed by email, so repeat
      // submits never resend. A failed send is reported but never fails the
      // save. The token is never logged or tagged.
      if (isNew || reconsented) {
        try {
          await sendLockinWaitlistWelcomeEmail({
            email: parsed.data.email,
            unsubscribeToken: stored.unsubscribe_token,
          });
        } catch (error) {
          console.error("Lock-in waitlist welcome email failed", error);
          captureException(error, { tags: { "email.type": "lockin_waitlist_welcome" } });
        }
      }

      return {
        ...echo,
        ok: true,
        errors: {},
        generalError: "",
        followupToken: stored.followup_token,
      };
    },
  );
}

// The thank-you panel's optional answer. Keyed only by the follow-up token
// this browser was just given, never by an email, and the token is cleared in
// the same write so it works once.
export async function saveSignupReason(
  prevState: SignupReasonFormState,
  formData: FormData,
): Promise<SignupReasonFormState> {
  const attempt = prevState.attempt + 1;
  const parsed = signupReasonSchema.safeParse(signupReasonInputFromFormData(formData));

  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);

    // A missing or malformed token (a honeypot visitor's is empty) is
    // answered as success and writes nothing, so it reveals nothing.
    if (issues.some(({ field }) => field === "followupToken")) {
      return { attempt, ok: true, errors: {}, generalError: "" };
    }

    const signupReason = issues.find(({ field }) => field === "signupReason")?.message;
    return { attempt, ok: false, errors: { signupReason }, generalError: "" };
  }

  return startSpan(
    {
      name: "lockin.waitlist.signup_reason",
      op: "http.server",
      attributes: { "http.route": "lockin.saveSignupReason" },
    },
    async () => {
      // An unknown or already-used token matches no row: nothing is written,
      // and the visitor still sees the same thanks.
      const { error } = await createAdminClient()
        .from("lockin_waitlist")
        .update({ signup_reason: parsed.data.signupReason, followup_token: null })
        .eq("followup_token", parsed.data.followupToken)
        .select("email");

      if (error) {
        captureException(error, { tags: { "db.operation": "lockin_waitlist_signup_reason" } });
        return { attempt, ok: false, errors: {}, generalError: LOCKIN_ERROR_COPY };
      }

      return { attempt, ok: true, errors: {}, generalError: "" };
    },
  );
}
