import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbortError, saveQuantity, sleep } from "../fake-api";
import {
  createQuantityReducer,
  type Entry,
  INITIAL_STATE,
  nextQuantity,
  type Payload,
  type QuantityState,
} from "../quantity";

const instant = vi.fn(async (quantity: number) => quantity);
const log = vi.fn<(entry: Entry) => void>();

const logged = () =>
  log.mock.calls.map(([{ type, outcome, quantity }]) => [type, outcome, quantity]);

/** Runs the payloads the way React does: one at a time, each from the previous result. */
async function runQueue(reducer: ReturnType<typeof createQuantityReducer>, payloads: Payload[]) {
  let state: QuantityState = INITIAL_STATE;
  for (const payload of payloads) state = await reducer(state, payload);
  return state;
}

beforeEach(() => {
  instant.mockClear();
  log.mockClear();
});

describe("nextQuantity", () => {
  it("adds one, removes one, and never goes below zero", () => {
    expect(nextQuantity(0, "ADD")).toBe(1);
    expect(nextQuantity(2, "REMOVE")).toBe(1);
    expect(nextQuantity(0, "REMOVE")).toBe(0);
  });
});

describe("createQuantityReducer", () => {
  it("applies the calls in order, each one from the previous result", async () => {
    const reducer = createQuantityReducer(instant, log);

    const state = await runQueue(reducer, [{ type: "ADD" }, { type: "ADD" }, { type: "REMOVE" }]);

    expect(state).toEqual({ quantity: 1, error: null });
    expect(instant.mock.calls.map(([quantity]) => quantity)).toEqual([1, 2, 1]);
    expect(logged()).toEqual([
      ["ADD", "saved", 1],
      ["ADD", "saved", 2],
      ["REMOVE", "saved", 1],
    ]);
  });

  it("logs each call with the time it started and ended", async () => {
    const reducer = createQuantityReducer(instant, log);
    const before = Date.now();

    await reducer(INITIAL_STATE, { type: "ADD" });

    const [entry] = log.mock.calls[0];
    expect(entry.startedAt).toBeGreaterThanOrEqual(before);
    expect(entry.finishedAt).toBeGreaterThanOrEqual(entry.startedAt);
  });

  it("keeps the saved value the API answers with", async () => {
    const reducer = createQuantityReducer(async () => 7);

    const state = await reducer(INITIAL_STATE, { type: "ADD" });

    expect(state.quantity).toBe(7);
  });

  it("answers an already aborted call at once without calling the API", async () => {
    const reducer = createQuantityReducer(instant, log);
    const controller = new AbortController();
    controller.abort();

    const state = await reducer(INITIAL_STATE, { type: "ADD", signal: controller.signal });

    expect(instant).not.toHaveBeenCalled();
    expect(state).toEqual({ quantity: 1, error: null });
    expect(logged()).toEqual([["ADD", "aborted", 1]]);
  });

  it("returns the intended quantity when the call is aborted mid-flight", async () => {
    const reducer = createQuantityReducer(
      (quantity, signal) => saveQuantity(quantity, { delayMs: 50, signal }),
      log,
    );
    const controller = new AbortController();

    const pending = reducer(
      { ...INITIAL_STATE, quantity: 3 },
      { type: "ADD", signal: controller.signal },
    );
    controller.abort();
    const state = await pending;

    expect(state).toEqual({ quantity: 4, error: null });
    expect(logged()).toEqual([["ADD", "aborted", 4]]);
  });

  it("turns a thrown error into an error state instead of rejecting", async () => {
    const reducer = createQuantityReducer(async () => {
      throw new Error("Quantity service is down");
    }, log);

    const state = await reducer({ ...INITIAL_STATE, quantity: 2 }, { type: "ADD" });

    expect(state).toEqual({ quantity: 2, error: "Quantity service is down" });
    expect(logged()).toEqual([["ADD", "failed", 2]]);
  });

  it("drains a burst of cancelled calls so only the last one is saved", async () => {
    const reducer = createQuantityReducer(instant, log);
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    // Every click but the last aborted the one before it.
    for (const controller of controllers.slice(0, -1)) controller.abort();

    const state = await runQueue(
      reducer,
      controllers.map(({ signal }) => ({ type: "ADD" as const, signal })),
    );

    expect(instant).toHaveBeenCalledTimes(1);
    expect(instant).toHaveBeenCalledWith(5, controllers[4].signal);
    expect(state.quantity).toBe(5);
    expect(logged().map(([, outcome]) => outcome)).toEqual([
      "aborted",
      "aborted",
      "aborted",
      "aborted",
      "saved",
    ]);
  });
});

describe("fake api", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saveQuantity answers with the quantity after the delay", async () => {
    const pending = saveQuantity(4, { delayMs: 1000 });

    await vi.advanceTimersByTimeAsync(999);
    const settled = vi.fn();
    void pending.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(4);
  });

  it("sleep rejects with an AbortError when the signal aborts, and clears its timer", async () => {
    const controller = new AbortController();
    const pending = sleep(1000, controller.signal);

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AbortError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
