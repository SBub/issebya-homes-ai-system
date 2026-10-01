/**
 * Fold and distill memory, behind the `fold-and-distill-memory` demo. Rows
 * that fall out of the window the model sees are summarised into one fold
 * row, off the reply path, and a watermark (the id of the last folded row)
 * stops them being folded twice. When more than one fold is kept, the
 * oldest is distilled into one preferences summary and deleted. The memory
 * the model gets is one assistant-role message: the preferences and the
 * most recent fold.
 *
 * The wrong variants exist so the demo can show the failure:
 * - `watermark: "none"`: every fold starts from the first row again, so the
 *   same turns are summarised on every fold and reach the model twice.
 * - `folds: "keep-all"`: nothing is distilled, every fold is kept and every
 *   fold is injected, so the memory message grows without bound.
 */

export type Row = { id: number; role: "user" | "assistant"; content: string };

export type Fold = { id: number; summary: string; fromId: number; toId: number };

/** The one message memory becomes: assistant role, ahead of the history. */
export type MemoryMessage = { role: "assistant"; content: string };

export type Summarizer = {
  summarize(rows: Row[]): Promise<string>;
  distill(prior: string | null, summary: string): Promise<string>;
};

/** Stands in for the summariser model: joins the text. `delay` is the model's round trip. */
export function createJoiningSummarizer(delay = 0): Summarizer {
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, delay));
  return {
    async summarize(rows) {
      await wait();
      return rows.map((row) => `${row.role}: ${row.content}`).join(" | ");
    },
    async distill(prior, summary) {
      await wait();
      const facts = summary
        .split(" | ")
        .filter((line) => line.startsWith("user: "))
        .map((line) => line.slice("user: ".length));
      return [prior, ...facts].filter((part) => part !== null && part !== "").join("; ");
    },
  };
}

/** A user row starts a turn; the assistant rows after it belong to it. */
export function groupByTurn<R extends Row>(rows: R[]): R[][] {
  const groups: R[][] = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (row.role === "user" || current === undefined) groups.push([row]);
    else current.push(row);
  }
  return groups;
}

export type MemoryOptions = {
  summarizer: Summarizer;
  /** Turns the model sees verbatim; older turns fold. */
  windowTurns: number;
  /** Folds kept as they are; beyond this the oldest distils into the preferences. */
  maxRecentFolds: number;
  watermark?: "advance" | "none";
  folds?: "distill" | "keep-all";
};

type MemorySnapshot = {
  watermark: number | null;
  preferences: string | null;
  folds: Fold[];
  log: string[];
};

export type Memory = {
  /** Rows after the watermark. Applied before any window, never after. */
  unfolded<R extends Row>(rows: R[]): R[];
  /** The last `windowTurns` turns and everything older, over rows already past the watermark. */
  splitWindow<R extends Row>(rows: R[]): { kept: R[]; dropped: R[] };
  /** The memory message for the next turn: preferences and the most recent fold, or null. */
  buildMemoryMessage(): MemoryMessage | null;
  /** The fold path: summarise `dropped`, advance the watermark, distil the excess folds. */
  recordFold(dropped: Row[]): Promise<Fold | null>;
  /** `recordFold` over what `splitWindow` drops from the unfolded rows. */
  fold(rows: Row[]): Promise<Fold | null>;
  getSnapshot(): MemorySnapshot;
  subscribe(listener: () => void): () => void;
  reset(): void;
};

const EMPTY = (): MemorySnapshot => ({ watermark: null, preferences: null, folds: [], log: [] });

export function createMemory(options: MemoryOptions): Memory {
  const {
    summarizer,
    windowTurns,
    maxRecentFolds,
    watermark = "advance",
    folds = "distill",
  } = options;
  const listeners = new Set<() => void>();
  let snapshot = EMPTY();
  let nextFoldId = 1;

  function emit(next: Partial<MemorySnapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }
  const log = (line: string) => emit({ log: [...snapshot.log, line] });

  const memory: Memory = {
    unfolded(rows) {
      const index = rows.findIndex((row) => row.id === snapshot.watermark);
      return index === -1 ? rows : rows.slice(index + 1);
    },
    splitWindow(rows) {
      const groups = groupByTurn(rows);
      const cut = Math.max(0, groups.length - windowTurns);
      return { kept: groups.slice(cut).flat(), dropped: groups.slice(0, cut).flat() };
    },
    buildMemoryMessage() {
      const sections: string[] = [];
      if (snapshot.preferences) sections.push(`Preferences:\n${snapshot.preferences}`);
      const injected = folds === "keep-all" ? snapshot.folds : snapshot.folds.slice(-1);
      for (const fold of injected)
        sections.push(`Summary of earlier conversation:\n${fold.summary}`);
      if (sections.length === 0) return null;
      // One message, assistant role, ahead of the history.
      return { role: "assistant", content: sections.join("\n\n") };
    },
    async recordFold(dropped) {
      if (dropped.length === 0) {
        log("fold: nothing new dropped out of the window");
        return null;
      }
      const fromId = dropped[0].id;
      const toId = dropped[dropped.length - 1].id;
      const summary = await summarizer.summarize(dropped);
      const fold: Fold = { id: nextFoldId++, summary, fromId, toId };
      emit({
        folds: [...snapshot.folds, fold],
        // The watermark is the last folded row: the next fold starts after it.
        watermark: watermark === "advance" ? toId : snapshot.watermark,
      });
      log(
        `fold ${fold.id}: rows ${fromId} to ${toId} summarised${watermark === "advance" ? `, watermark now ${toId}` : ", watermark not advanced"}`,
      );
      if (folds === "distill") {
        while (snapshot.folds.length > maxRecentFolds) {
          const [oldest, ...rest] = snapshot.folds;
          const preferences = await summarizer.distill(snapshot.preferences, oldest.summary);
          emit({ preferences, folds: rest });
          log(`fold ${oldest.id} distilled into the preferences and deleted`);
        }
      }
      return fold;
    },
    fold(rows) {
      return memory.recordFold(memory.splitWindow(memory.unfolded(rows)).dropped);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      nextFoldId = 1;
      emit(EMPTY());
    },
  };
  return memory;
}
