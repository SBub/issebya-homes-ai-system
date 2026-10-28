"use client";

import { startTransition, useActionState, useOptimistic, useRef, useState } from "react";
import { updateQuantityForm } from "@/lib/action-state/actions";
import { DELAY_MS, saveQuantity } from "@/lib/action-state/fake-api";
import { INITIAL_FORM_STATE } from "@/lib/action-state/form-state";
import {
  createQuantityReducer,
  type Entry,
  INITIAL_STATE,
  nextQuantity,
  type StepType,
} from "@/lib/action-state/quantity";

type Mode = "queued" | "optimistic" | "cancelling";

const MODE_TEXT: Record<Mode, string> = {
  queued: "Every click waits its turn. Five fast clicks take five seconds.",
  optimistic: "The count moves at once. The calls still run one at a time.",
  cancelling: "Each click cancels the call before it. Only the last one is saved.",
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

function clock(ms: number) {
  return new Date(ms).toISOString().slice(11, 23);
}

type LoggedEntry = Entry & { id: number };

function describe({ id, type, outcome, quantity, startedAt, finishedAt }: LoggedEntry) {
  const when = `${clock(startedAt)} to ${clock(finishedAt)}`;
  if (outcome === "saved") return `#${id} ${type}: saved ${quantity} (${when})`;
  if (outcome === "aborted")
    return `#${id} ${type}: aborted, returned ${quantity} at ${clock(finishedAt)}`;
  return `#${id} ${type}: failed, kept ${quantity} (${when})`;
}

function Stepper({ mode, delayMs }: { mode: Mode; delayMs: number }) {
  // Written by the reducer as each call ends. A state update from inside a
  // running action is not part of its Transition, so the log shows up live
  // while the batched quantity is still waiting for the queue to drain.
  const [entries, setEntries] = useState<LoggedEntry[]>([]);
  // One reducer per stepper, built once: the fake API's delay is bound here.
  const [updateQuantity] = useState(() =>
    createQuantityReducer(
      (quantity, signal) => saveQuantity(quantity, { delayMs, signal }),
      (entry) => setEntries((current) => [...current, { ...entry, id: current.length + 1 }]),
    ),
  );
  const [state, dispatchAction, isPending] = useActionState(updateQuantity, INITIAL_STATE);
  const [optimisticQuantity, setOptimisticQuantity] = useOptimistic(state.quantity);
  const abortRef = useRef<AbortController | null>(null);

  const step = (type: StepType) => {
    // Outside a Transition, `isPending` would never move and React would warn.
    startTransition(() => {
      if (mode === "queued") {
        dispatchAction({ type });
        return;
      }
      setOptimisticQuantity((quantity) => nextQuantity(quantity, type));
      if (mode === "optimistic") {
        dispatchAction({ type });
        return;
      }
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      dispatchAction({ type, signal: abortRef.current.signal });
    });
  };

  const shown = mode === "queued" ? state.quantity : optimisticQuantity;

  return (
    <section aria-label={`${mode} stepper`} className={boxClass}>
      <h3 className="font-bold capitalize">{mode}</h3>
      <p className="mt-1 text-xs">{MODE_TEXT[mode]}</p>
      <p className="mt-3 flex items-center gap-3">
        <span className="font-mono text-2xl" aria-label={`${mode} quantity`}>
          {shown}
        </span>
        <button type="button" onClick={() => step("ADD")} className={buttonClass}>
          Add
        </button>
        <button type="button" onClick={() => step("REMOVE")} className={buttonClass}>
          Remove
        </button>
        <span aria-live="polite" className="text-xs">
          {isPending ? "Pending" : "Idle"}
        </span>
      </p>
      {state.error && <p className="mt-2 text-xs text-red-700">{state.error}</p>}
      {entries.length > 0 && (
        <ol aria-label={`${mode} reducer calls`} className="mt-3 space-y-1 font-mono text-xs">
          {entries.map((entry) => (
            <li key={entry.id}>{describe(entry)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FormStepper() {
  // The reducer is a Server Function. The form posts to it with or without
  // JavaScript; with it, React wraps the submit in a Transition for us.
  const [state, formAction, isPending] = useActionState(updateQuantityForm, INITIAL_FORM_STATE);

  return (
    <form action={formAction} aria-label="form stepper" className={boxClass}>
      <h3 className="font-bold">Form and Server Function</h3>
      <p className="mt-1 text-xs">
        The count lives in the server&apos;s memory. Turn JavaScript off and the buttons still work:
        the form posts and the page comes back with the new count.
      </p>
      <p className="mt-3 flex items-center gap-3">
        <span className="font-mono text-2xl" aria-label="form quantity">
          {state.quantity}
        </span>
        <button type="submit" name="type" value="ADD" className={buttonClass}>
          Add
        </button>
        <button type="submit" name="type" value="REMOVE" className={buttonClass}>
          Remove
        </button>
        <span aria-live="polite" className="text-xs">
          {isPending
            ? "Pending"
            : state.savedAt
              ? `Saved at ${state.savedAt.slice(11, 23)}`
              : "Idle"}
        </span>
      </p>
    </form>
  );
}

/**
 * Live demo for the `use-action-state` doc. Three steppers share one reducer
 * from `quantity.ts` over the fake API in `fake-api.ts`: queued shows React
 * running calls one at a time, optimistic adds `useOptimistic`, cancelling
 * carries an `AbortController` signal in the payload. The fourth is a
 * `<form action>` bound to the Server Function in `actions.ts`, which works
 * before hydration and with JavaScript disabled.
 */
export function ActionStateDemo({ delayMs = DELAY_MS }: { delayMs?: number }) {
  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <Stepper mode="queued" delayMs={delayMs} />
        <Stepper mode="optimistic" delayMs={delayMs} />
        <Stepper mode="cancelling" delayMs={delayMs} />
      </div>
      <div className="mt-3">
        <FormStepper />
      </div>
    </div>
  );
}
