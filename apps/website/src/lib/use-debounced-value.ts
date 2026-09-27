import { useEffect, useState } from "react";

/**
 * `value`, held back until it has stopped changing for `delayMs`. Every change
 * restarts the wait, so a burst of changes yields one new value. Only the
 * returned value waits: the caller keeps rendering the raw `value` (an input
 * shows each keystroke at once).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  // Synchronising with a timer, which is an external system.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
