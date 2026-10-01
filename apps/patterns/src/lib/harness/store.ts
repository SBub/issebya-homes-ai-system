/**
 * A Map-backed table for the agent harness demos: insert with a unique key,
 * the conflict a database raises on a duplicate, and the select a caller
 * runs after that conflict. No I/O, no dependencies.
 */

type Row<T> = T & { id: number };

/** The error Postgres raises as `23505 unique_violation`, with the key and value that clashed. */
export class UniqueViolationError extends Error {
  readonly code = "23505";
  readonly key: string;
  readonly value: unknown;

  constructor(key: string, value: unknown) {
    super(`duplicate key value violates unique constraint on "${key}"`);
    this.name = "UniqueViolationError";
    this.key = key;
    this.value = value;
  }
}

export type Table<T extends Record<string, unknown>> = {
  /** Appends a row with the next id. Throws `UniqueViolationError` when a unique key already holds the value. */
  insert(values: T): Row<T>;
  /** Every row whose `key` equals `value`, in insertion order. */
  selectBy<K extends keyof T & string>(key: K, value: T[K]): Row<T>[];
  rows(): Row<T>[];
  clear(): void;
};

/**
 * `unique` names the columns that may not repeat. As in Postgres, `null` and
 * `undefined` never conflict: a row without the key is always allowed.
 */
export function createTable<T extends Record<string, unknown>>(
  options: { unique?: Array<keyof T & string> } = {},
): Table<T> {
  const unique = options.unique ?? [];
  let rows: Row<T>[] = [];
  let nextId = 1;

  return {
    insert(values) {
      for (const key of unique) {
        const value = values[key];
        if (value === null || value === undefined) continue;
        if (rows.some((row) => row[key] === value)) throw new UniqueViolationError(key, value);
      }
      const row = { ...values, id: nextId++ };
      rows = [...rows, row];
      return row;
    },
    selectBy(key, value) {
      return rows.filter((row) => row[key] === value);
    },
    rows: () => rows,
    clear() {
      rows = [];
      nextId = 1;
    },
  };
}
