"use client";

import { useState, useSyncExternalStore } from "react";
import {
  createJoiningSummarizer,
  createMemory,
  type MemoryMessage,
  type MemoryOptions,
  type Row,
} from "@/lib/memory-fold/fold";

const TURNS: Array<{ question: string; reply: string }> = [
  { question: "Is the 6th to the 8th free?", reply: "Yes, those dates are free." },
  { question: "I prefer the quiet room at the back.", reply: "Noted, the quiet room it is." },
  { question: "Can I check in late, around 23:00?", reply: "Late check-in is fine." },
  { question: "My name is Ana, we are two adults.", reply: "Thanks Ana, two adults noted." },
  { question: "Is there parking nearby?", reply: "There is free parking on the street." },
  { question: "We will arrive by train.", reply: "The station is ten minutes on foot." },
];

const SUMMARIZER_DELAY = 300;
const WINDOW_TURNS = 2;
const MAX_RECENT_FOLDS = 1;

type FoldTiming = "after-send" | "before-send";

type SentTurn = {
  turn: number;
  sentAfterMs: number;
  saw: number;
  memoryMessage: MemoryMessage | null;
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

/**
 * Live demo for the `fold-and-distill-memory` doc. Send a turn stores a
 * user row and an assistant row, sends the reply, and then folds: the turns
 * that fell out of a two-turn window are summarised by a joining stand-in
 * for the model into one fold row, the watermark moves to the last folded
 * row, and once a second fold exists the older one is distilled into the
 * preferences. The memory message panel is what the next turn gets, one
 * assistant message. The checkboxes switch to the wrong shapes: folding
 * before the send, which the reply waits for; no watermark, which folds the
 * same rows again; and keeping every fold, which injects them all.
 */
export function MemoryFoldDemo() {
  const [timing, setTiming] = useState<FoldTiming>("after-send");
  const [watermark, setWatermark] = useState<NonNullable<MemoryOptions["watermark"]>>("advance");
  const [folds, setFolds] = useState<NonNullable<MemoryOptions["folds"]>>("distill");
  const [memory, setMemory] = useState(() =>
    createMemory({
      summarizer: createJoiningSummarizer(SUMMARIZER_DELAY),
      windowTurns: WINDOW_TURNS,
      maxRecentFolds: MAX_RECENT_FOLDS,
    }),
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [sent, setSent] = useState<SentTurn[]>([]);
  const [busy, setBusy] = useState(false);

  const snapshot = useSyncExternalStore(memory.subscribe, memory.getSnapshot, memory.getSnapshot);

  const sendTurn = async () => {
    const turn = sent.length + 1;
    const script = TURNS[(turn - 1) % TURNS.length];
    const started = performance.now();
    setBusy(true);

    // The turn: store the message, build what the model sees, reply, store the reply.
    const withQuestion = [
      ...rows,
      { id: rows.length + 1, role: "user" as const, content: script.question },
    ];
    const memoryMessage = memory.buildMemoryMessage();
    const history = memory.splitWindow(memory.unfolded(withQuestion));
    const saw = history.kept.length + (memoryMessage === null ? 0 : 1);
    const stored = [
      ...withQuestion,
      { id: withQuestion.length + 1, role: "assistant" as const, content: script.reply },
    ];
    setRows(stored);

    if (timing === "before-send") await memory.fold(stored);
    // The send. From here the person has their reply.
    const sentAfterMs = Math.round(performance.now() - started);
    setSent((current) => [...current, { turn, sentAfterMs, saw, memoryMessage }]);
    if (timing === "after-send") await memory.fold(stored);
    setBusy(false);
  };

  const rebuild = (next: {
    watermark?: MemoryOptions["watermark"];
    folds?: MemoryOptions["folds"];
  }) => {
    const nextWatermark = next.watermark ?? watermark;
    const nextFolds = next.folds ?? folds;
    setWatermark(nextWatermark);
    setFolds(nextFolds);
    setMemory(
      createMemory({
        summarizer: createJoiningSummarizer(SUMMARIZER_DELAY),
        windowTurns: WINDOW_TURNS,
        maxRecentFolds: MAX_RECENT_FOLDS,
        watermark: nextWatermark,
        folds: nextFolds,
      }),
    );
    setRows([]);
    setSent([]);
  };

  const reset = () => rebuild({});
  const nextMemory = memory.buildMemoryMessage();

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={sendTurn} disabled={busy} className={buttonClass}>
          Send a turn
        </button>
        <button type="button" onClick={reset} disabled={busy} className={buttonClass}>
          Reset
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={timing === "before-send"}
            onChange={(event) => setTiming(event.target.checked ? "before-send" : "after-send")}
          />
          Fold before the send (wrong)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={watermark === "none"}
            onChange={(event) => rebuild({ watermark: event.target.checked ? "none" : "advance" })}
          />
          No watermark (wrong)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={folds === "keep-all"}
            onChange={(event) => rebuild({ folds: event.target.checked ? "keep-all" : "distill" })}
          />
          Keep and inject every fold (wrong)
        </label>
      </div>
      <p className="mt-2 text-xs">
        The window is {WINDOW_TURNS} turns, one fold is kept, and the summariser takes{" "}
        {SUMMARIZER_DELAY} ms.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <section aria-label="Rows" className={boxClass}>
            <h3 className="font-bold">
              Rows{" "}
              <span className="font-normal text-xs">
                (watermark {snapshot.watermark === null ? "none" : `row ${snapshot.watermark}`})
              </span>
            </h3>
            {rows.length === 0 ? (
              <p className="mt-1 text-xs">Empty.</p>
            ) : (
              <ol className="mt-2 space-y-1 font-mono text-xs">
                {rows.map((row) => (
                  <li key={row.id} className="[overflow-wrap:anywhere]">
                    #{row.id} {row.role}: {row.content}
                    {snapshot.watermark !== null && row.id <= snapshot.watermark && (
                      <span className="text-gray-600"> (folded)</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Sent turns" className={boxClass}>
            <h3 className="font-bold">Turns sent</h3>
            {sent.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {sent.map((entry) => (
                  <li key={entry.turn}>
                    turn {entry.turn}: the model saw {entry.saw} messages
                    {entry.memoryMessage === null ? "" : " (memory first)"}, reply sent after{" "}
                    {entry.sentAfterMs} ms
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <div className="space-y-3">
          <section aria-label="Fold log" className={boxClass}>
            <h3 className="font-bold">
              Folds <span className="font-normal text-xs">({snapshot.folds.length} kept)</span>
            </h3>
            {snapshot.folds.length > 0 && (
              <ul className="mt-2 list-disc pl-5 font-mono text-xs space-y-1">
                {snapshot.folds.map((fold) => (
                  <li key={fold.id} className="[overflow-wrap:anywhere]">
                    fold {fold.id}, rows {fold.fromId} to {fold.toId}: {fold.summary}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 font-mono text-xs [overflow-wrap:anywhere]">
              preferences: {snapshot.preferences ?? "none"}
            </p>
            {snapshot.log.length === 0 ? (
              <p className="mt-1 text-xs">No fold yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {snapshot.log.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Memory message" className={boxClass}>
            <h3 className="font-bold">Injected on the next turn</h3>
            {nextMemory === null ? (
              <p className="mt-1 text-xs">No memory message: nothing has folded.</p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
                {nextMemory.role}: {nextMemory.content}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
