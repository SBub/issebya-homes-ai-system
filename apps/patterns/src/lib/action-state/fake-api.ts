/**
 * The fake API behind the `use-action-state` demo. `saveQuantity` stands in
 * for a PUT that stores a quantity and echoes it back after a network delay.
 * The wait rejects with an `AbortError` as soon as the signal aborts, so a
 * cancelled call never resolves and nothing is saved for it.
 */

export const DELAY_MS = 1000;

export class AbortError extends Error {
  override name = "AbortError";

  constructor() {
    super("The call was aborted");
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AbortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type SaveOptions = { delayMs?: number; signal?: AbortSignal };

export async function saveQuantity(quantity: number, options: SaveOptions = {}): Promise<number> {
  await sleep(options.delayMs ?? DELAY_MS, options.signal);
  return quantity;
}
