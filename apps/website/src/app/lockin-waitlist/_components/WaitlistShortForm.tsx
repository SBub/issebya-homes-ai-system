"use client";

import posthog from "posthog-js";
import { useActionState, useId, useState } from "react";
import { lockinWaitlistJoinedEvent } from "@/lib/lockin-waitlist/analytics";
import {
  initialLockinWaitlistState,
  type LockinWaitlistFormState,
} from "@/lib/lockin-waitlist/schema";
import { joinLockinWaitlist } from "../actions";
import { ConsentField } from "./ConsentField";
import { EmailField, GeneralError, HoneypotField, SubmitButton } from "./FormParts";
import { WaitlistThankYou } from "./WaitlistThankYou";

// The action plus its PostHog event, once per real join. Module level keeps
// its identity stable across renders.
async function joinFromShortForm(prevState: LockinWaitlistFormState, formData: FormData) {
  const next = await joinLockinWaitlist(prevState, formData);
  const tracked = lockinWaitlistJoinedEvent("short", next);
  if (tracked) posthog.capture(tracked.event, tracked.properties);
  return next;
}

// The hero's form: email and consent only. GDPR needs consent on every
// record, so the checkbox is here too.
export function WaitlistShortForm() {
  const [state, formAction, isPending] = useActionState(
    joinFromShortForm,
    initialLockinWaitlistState,
  );
  const [optedIn, setOptedIn] = useState(false);
  const id = useId();

  if (state.ok) return <WaitlistThankYou form="short" followupToken={state.followupToken} />;

  return (
    <form action={formAction} noValidate className="flex w-full max-w-md flex-col gap-4">
      <EmailField
        id={`${id}-email`}
        attempt={state.attempt}
        defaultValue={state.email}
        error={state.errors.email}
        disabled={isPending}
      />
      <HoneypotField id={`${id}-website`} />
      <ConsentField
        id={`${id}-consent`}
        checked={optedIn}
        onCheckedChange={setOptedIn}
        error={state.errors.marketingOptIn}
        disabled={isPending}
      />
      <GeneralError message={state.generalError} />
      <SubmitButton disabled={!optedIn || isPending} pending={isPending} />
    </form>
  );
}
