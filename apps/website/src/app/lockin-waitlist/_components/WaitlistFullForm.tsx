"use client";

import posthog from "posthog-js";
import { useActionState, useId, useState } from "react";
import {
  LOCKIN_DURATION_LABEL,
  LOCKIN_DURATIONS,
  LOCKIN_LIFE_AREA_LABEL,
  LOCKIN_LIFE_AREAS,
  LOCKIN_MONTHS,
  LOCKIN_MONTHS_LABEL,
  LOCKIN_NAME_LABEL,
} from "@/lib/lockin-waitlist/copy";
import { lockinWaitlistJoinedEvent } from "@/lib/lockin-waitlist/analytics";
import {
  initialLockinWaitlistState,
  type LockinWaitlistFormState,
} from "@/lib/lockin-waitlist/schema";
import { joinLockinWaitlist } from "../actions";
import { ConsentField } from "./ConsentField";
import { EmailField, GeneralError, HoneypotField, INPUT_CLASS, SubmitButton } from "./FormParts";
import { WaitlistThankYou } from "./WaitlistThankYou";

type Option = { readonly value: string; readonly label: string };

type ChoiceGroupProps = {
  id: string;
  legend: string;
  name: string;
  type: "radio" | "checkbox";
  options: readonly Option[];
  selected: readonly string[];
  error?: string;
  disabled: boolean;
};

// One <fieldset> per question, each option with its own <label>.
function ChoiceGroup({
  id,
  legend,
  name,
  type,
  options,
  selected,
  error,
  disabled,
}: ChoiceGroupProps) {
  const errorId = `${id}-error`;
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? errorId : undefined}
      disabled={disabled}
    >
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <div key={option.value}>
              <input
                id={optionId}
                name={name}
                type={type}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={optionId}
                className="inline-flex min-h-11 cursor-pointer items-center border border-black/60 bg-white px-4 py-2 text-sm text-black peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black"
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// The action plus its PostHog event, once per real join. Module level keeps
// its identity stable across renders.
async function joinFromFullForm(prevState: LockinWaitlistFormState, formData: FormData) {
  const next = await joinLockinWaitlist(prevState, formData);
  const tracked = lockinWaitlistJoinedEvent("full", next);
  if (tracked) posthog.capture(tracked.event, tracked.properties);
  return next;
}

// The closing form: email, the optional questions and consent.
export function WaitlistFullForm() {
  const [state, formAction, isPending] = useActionState(
    joinFromFullForm,
    initialLockinWaitlistState,
  );
  const [optedIn, setOptedIn] = useState(false);
  const id = useId();
  const { answers, errors } = state;

  if (state.ok) return <WaitlistThankYou form="full" followupToken={state.followupToken} />;

  return (
    // Re-keyed per attempt so every uncontrolled answer re-seeds from the
    // echoed state after an error, as the email does.
    <form
      key={state.attempt}
      action={formAction}
      noValidate
      className="flex w-full max-w-xl flex-col gap-6"
    >
      <EmailField
        id={`${id}-email`}
        attempt={state.attempt}
        defaultValue={state.email}
        error={errors.email}
        disabled={isPending}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          {LOCKIN_NAME_LABEL}
        </label>
        <input
          id={`${id}-name`}
          name="name"
          type="text"
          autoComplete="given-name"
          maxLength={100}
          defaultValue={answers.name}
          className={INPUT_CLASS}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? `${id}-name-error` : undefined}
          disabled={isPending}
        />
        {errors.name && (
          <p id={`${id}-name-error`} role="alert" className="text-sm text-red-700">
            {errors.name}
          </p>
        )}
      </div>
      <ChoiceGroup
        id={`${id}-life-area`}
        legend={LOCKIN_LIFE_AREA_LABEL}
        name="lifeArea"
        type="radio"
        options={LOCKIN_LIFE_AREAS}
        selected={[answers.lifeArea]}
        error={errors.lifeArea}
        disabled={isPending}
      />
      <ChoiceGroup
        id={`${id}-duration`}
        legend={LOCKIN_DURATION_LABEL}
        name="duration"
        type="radio"
        options={LOCKIN_DURATIONS}
        selected={[answers.duration]}
        error={errors.duration}
        disabled={isPending}
      />
      <ChoiceGroup
        id={`${id}-months`}
        legend={LOCKIN_MONTHS_LABEL}
        name="months"
        type="checkbox"
        options={LOCKIN_MONTHS}
        selected={answers.months}
        error={errors.months}
        disabled={isPending}
      />
      <HoneypotField id={`${id}-website`} />
      <ConsentField
        id={`${id}-consent`}
        checked={optedIn}
        onCheckedChange={setOptedIn}
        error={errors.marketingOptIn}
        disabled={isPending}
      />
      <GeneralError message={state.generalError} />
      <SubmitButton disabled={!optedIn || isPending} pending={isPending} />
    </form>
  );
}
