import posthog from "posthog-js";
import { useActionState, useId } from "react";
import {
  type LockinWaitlistForm,
  lockinWaitlistReasonAddedEvent,
} from "@/lib/lockin-waitlist/analytics";
import {
  LOCKIN_FOLLOWUP_LABEL,
  LOCKIN_FOLLOWUP_SAVED,
  LOCKIN_FOLLOWUP_SUBMIT_LABEL,
  LOCKIN_THANKS_HEADLINE,
  LOCKIN_THANKS_TEXT,
} from "@/lib/lockin-waitlist/copy";
import { initialSignupReasonState, type SignupReasonFormState } from "@/lib/lockin-waitlist/schema";
import { saveSignupReason } from "../actions";
import { FOCUS_CLASS, GeneralError, INPUT_CLASS } from "./FormParts";

// Stable identity, so React calls it once on mount rather than on every
// render: focus moves to the heading so screen readers announce the swap.
function focusOnMount(node: HTMLHeadingElement | null) {
  node?.focus();
}

// Rendered only inside the two client forms, in place of the form that was
// submitted. `followupToken` is this submit's single-use key to the answer;
// `form` says which form that was, for the PostHog event.
export function WaitlistThankYou({
  form,
  followupToken,
}: {
  form: LockinWaitlistForm;
  followupToken: string;
}) {
  // The action plus its PostHog event, once per saved reason. The reason text
  // itself never leaves the action.
  async function saveReason(prevState: SignupReasonFormState, formData: FormData) {
    const next = await saveSignupReason(prevState, formData);
    const tracked = lockinWaitlistReasonAddedEvent(form, followupToken, next);
    if (tracked) posthog.capture(tracked.event, tracked.properties);
    return next;
  }
  const [state, formAction, isPending] = useActionState(saveReason, initialSignupReasonState);
  const id = useId();
  const errorId = `${id}-reason-error`;

  return (
    <div role="status" className="flex w-full max-w-xl flex-col gap-4 bg-white p-6 text-black">
      <h3 ref={focusOnMount} tabIndex={-1} className="text-2xl font-medium outline-none">
        {LOCKIN_THANKS_HEADLINE}
      </h3>
      <p className="leading-relaxed">{LOCKIN_THANKS_TEXT}</p>
      {state.ok ? (
        <p className="leading-relaxed">{LOCKIN_FOLLOWUP_SAVED}</p>
      ) : (
        <form action={formAction} noValidate className="flex flex-col gap-3">
          <input type="hidden" name="followupToken" value={followupToken} readOnly />
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            {LOCKIN_FOLLOWUP_LABEL}
          </label>
          <textarea
            id={`${id}-reason`}
            name="signupReason"
            maxLength={1000}
            rows={3}
            className={INPUT_CLASS}
            aria-invalid={!!state.errors.signupReason}
            aria-describedby={state.errors.signupReason ? errorId : undefined}
            disabled={isPending}
          />
          {state.errors.signupReason && (
            <p id={errorId} role="alert" className="text-sm text-red-700">
              {state.errors.signupReason}
            </p>
          )}
          <GeneralError message={state.generalError} />
          <button
            type="submit"
            disabled={isPending}
            className={`min-h-11 self-start border border-black px-5 py-2 text-xs uppercase tracking-[0.2em] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_CLASS}`}
          >
            {LOCKIN_FOLLOWUP_SUBMIT_LABEL}
          </button>
        </form>
      )}
    </div>
  );
}
