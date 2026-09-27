import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useDebouncedValue } from "../use-debounced-value";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Renders the hook and records every distinct value it returns. */
async function renderDebounced(initial: string) {
  const emitted: string[] = [];
  const hook = await renderHook(
    (value?: string) => {
      const debounced = useDebouncedValue(value ?? initial, 300);
      if (emitted.at(-1) !== debounced) emitted.push(debounced);
      return debounced;
    },
    { initialProps: initial },
  );
  const advance = (ms: number) => hook.act(() => vi.advanceTimersByTime(ms));
  return Object.assign(hook, { emitted, advance });
}

test("returns the initial value on the first render", async () => {
  const hook = await renderDebounced("");

  expect(hook.result.current).toBe("");
});

test("emits the last value once, 300 ms after a burst of changes", async () => {
  const hook = await renderDebounced("");

  await hook.rerender("a");
  await hook.rerender("ab");
  await hook.rerender("abc");

  await hook.advance(299);
  expect(hook.result.current).toBe("");

  await hook.advance(1);
  expect(hook.result.current).toBe("abc");
  expect(hook.emitted).toEqual(["", "abc"]);
});

test("a change inside the window restarts it", async () => {
  const hook = await renderDebounced("");

  await hook.rerender("a");
  await hook.advance(200);
  await hook.rerender("ab");

  await hook.advance(299);
  expect(hook.result.current).toBe("");

  await hook.advance(1);
  expect(hook.result.current).toBe("ab");
  expect(hook.emitted).toEqual(["", "ab"]);
});
