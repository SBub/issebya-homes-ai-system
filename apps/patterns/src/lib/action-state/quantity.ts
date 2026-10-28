/**
 * The reducer behind the three client steppers of the `use-action-state`
 * demo. React calls it through `useActionState`, one call at a time, each
 * with the previous call's result as `prevState`. Every call reports itself
 * to `log` as it ends, a side effect the page shows live, so the queue, the
 * cancelled calls and the order React ran them in are visible while the
 * batched state is still waiting to commit.
 */

export type StepType = "ADD" | "REMOVE";

export type Payload = { type: StepType; signal?: AbortSignal };

export type Outcome = "saved" | "aborted" | "failed";

export type Entry = {
  type: StepType;
  outcome: Outcome;
  quantity: number;
  startedAt: number;
  finishedAt: number;
};

export type QuantityState = { quantity: number; error: string | null };

export const INITIAL_STATE: QuantityState = { quantity: 0, error: null };

export type Save = (quantity: number, signal?: AbortSignal) => Promise<number>;

export function nextQuantity(quantity: number, type: StepType): number {
  return type === "ADD" ? quantity + 1 : Math.max(0, quantity - 1);
}

export function createQuantityReducer(save: Save, log: (entry: Entry) => void = () => {}) {
  return async function updateQuantity(
    prevState: QuantityState,
    payload: Payload,
  ): Promise<QuantityState> {
    const startedAt = Date.now();
    const next = nextQuantity(prevState.quantity, payload.type);
    const done = (outcome: Outcome, quantity: number, error: string | null = null) => {
      log({ type: payload.type, outcome, quantity, startedAt, finishedAt: Date.now() });
      return { quantity, error };
    };

    // Cancelled by a later click before it ran: answer at once with the
    // quantity this call meant to save. The next call in the queue builds on
    // it, and the last call of the burst saves the whole quantity.
    if (payload.signal?.aborted) return done("aborted", next);

    try {
      return done("saved", await save(next, payload.signal));
    } catch (error) {
      if (payload.signal?.aborted) return done("aborted", next);
      // Returned, not thrown: a throw here would drop every action queued
      // behind this one and surface in the nearest error boundary.
      const message = error instanceof Error ? error.message : String(error);
      return done("failed", prevState.quantity, message);
    }
  };
}
