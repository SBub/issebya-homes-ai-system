"use client";

import { useState, useSyncExternalStore } from "react";
import type { Message } from "@/lib/harness/fake-model";
import { createTable } from "@/lib/harness/store";
import type { MessageRow } from "@/lib/history/history";
import { createJoiningSummarizer, createMemory } from "@/lib/memory-fold/fold";
import {
  type LoadedMemory,
  type RowsTable,
  runTurn,
  type ScriptedTurn,
} from "@/lib/memory-window/window";

const TURNS: ScriptedTurn[] = [
  {
    question: "Is the 6th to the 8th free?",
    tool: {
      name: "check_dates",
      input: { from: "2026-10-06", to: "2026-10-08" },
      output: { free: true, from: "2026-10-06", to: "2026-10-08" },
    },
    reply: "Yes, the 6th to the 8th is free.",
  },
  {
    question: "I prefer the quiet room at the back.",
    tool: {
      name: "search_notes",
      input: { query: "quiet room" },
      output: { hits: ["The back room faces the garden."] },
    },
    reply: "Noted, the back room faces the garden.",
  },
  {
    question: "How much per night?",
    tool: {
      name: "lookup_rate",
      input: { room: "small" },
      output: { nightly: 95, currency: "EUR" },
    },
    reply: "95 EUR a night.",
  },
  {
    question: "Can we check in late, around 23:00?",
    tool: {
      name: "search_notes",
      input: { query: "late check-in" },
      output: { hits: ["Late check-in is fine with notice."] },
    },
    reply: "Late check-in is fine with notice.",
  },
  {
    question: "My name is Ana, two adults.",
    tool: {
      name: "search_notes",
      input: { query: "occupancy" },
      output: { hits: ["Up to two adults."] },
    },
    reply: "Thanks Ana, two adults noted.",
  },
  {
    question: "Is there parking?",
    tool: {
      name: "search_notes",
      input: { query: "parking" },
      output: { hits: ["Free street parking."] },
    },
    reply: "There is free street parking.",
  },
  {
    question: "We arrive by train.",
    tool: {
      name: "search_notes",
      input: { query: "station" },
      output: { hits: ["Ten minutes on foot from the station."] },
    },
    reply: "The station is ten minutes on foot.",
  },
  {
    question: "Is breakfast included?",
    tool: {
      name: "search_notes",
      input: { query: "breakfast" },
      output: { hits: ["Breakfast is not included."] },
    },
    reply: "Breakfast is not included.",
  },
];

const VERBATIM_TURNS = 2;
const MAX_TOKENS = 160;
const KEEP_TOKENS = 120;

type Sent = { turn: number; saw: LoadedMemory; folded: string };

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

function summarize(message: Message): string {
  if (typeof message.content === "string") return `${message.role}: ${message.content}`;
  if (message.role === "tool") {
    return `tool: ${message.content.map((part) => `${part.toolName} -> ${JSON.stringify(part.output)}`).join("; ")}`;
  }
  return `assistant: ${message.content
    .map((part) =>
      part.type === "tool-call" ? `${part.toolName}(${JSON.stringify(part.input)})` : part.text,
    )
    .join(" ")}`;
}

/**
 * Live demo for the `agent-memory-window` composite. Send a turn runs one
 * turn from `window.ts` on a harness table: the question is stored, the
 * watermark drops what is already folded, the last two turns replay their
 * tool messages verbatim and older ones as text, whole turns are trimmed to
 * the budget, and the memory message goes first. The reply is stored with
 * its turn messages and sent; then the fold runs: whatever the trim now
 * drops becomes one fold, the watermark moves, and an older fold distils
 * into the preferences. The left panel is what the model saw on the latest
 * turn; the right is the memory after the send.
 */
export function MemoryWindowDemo() {
  const [table] = useState<RowsTable>(() => createTable());
  const [memory] = useState(() =>
    createMemory({ summarizer: createJoiningSummarizer(), windowTurns: 0, maxRecentFolds: 1 }),
  );
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [busy, setBusy] = useState(false);

  const snapshot = useSyncExternalStore(memory.subscribe, memory.getSnapshot, memory.getSnapshot);
  const options = { verbatimTurns: VERBATIM_TURNS, budget: { max: MAX_TOKENS, keep: KEEP_TOKENS } };

  const sendTurn = async () => {
    setBusy(true);
    const turn = sent.length + 1;
    const { saw, fold } = await runTurn(table, memory, TURNS[(turn - 1) % TURNS.length], options);
    setRows(table.rows());
    setSent((current) => [
      ...current,
      {
        turn,
        saw,
        folded:
          fold === null
            ? "nothing fell out of the window"
            : `rows ${fold.fromId} to ${fold.toId} became fold ${fold.id}`,
      },
    ]);
    setBusy(false);
  };

  const reset = () => {
    table.clear();
    memory.reset();
    setRows([]);
    setSent([]);
  };

  const latest = sent.at(-1) ?? null;
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
        <span className="text-xs">
          {VERBATIM_TURNS} verbatim turns, {MAX_TOKENS} tokens max, trimmed to {KEEP_TOKENS}, one
          fold kept.
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="What the model saw" className={boxClass}>
          <h3 className="font-bold">
            What the model saw{latest === null ? "" : ` on turn ${latest.turn}`}
          </h3>
          {latest === null ? (
            <p className="mt-1 text-xs">No turn yet.</p>
          ) : (
            <>
              <p aria-live="polite" className="mt-1 text-xs">
                {latest.saw.messages.length} messages, {latest.saw.tokens.after} tokens of history
                {latest.saw.droppedRows.length === 0
                  ? ", nothing trimmed"
                  : `, ${latest.saw.droppedRows.length} rows trimmed`}
                .
              </p>
              <ol aria-label="Messages" className="mt-2 space-y-2 font-mono text-xs">
                {latest.saw.memoryMessage !== null && (
                  <li className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    <span className="font-bold">Memory, one assistant message:</span>{" "}
                    {latest.saw.memoryMessage.content}
                  </li>
                )}
                {latest.saw.groups.map((group, index) => {
                  const verbatim = group.some((message) => message.role === "tool");
                  return (
                    <li key={index}>
                      <span className="font-bold">
                        Turn {verbatim ? "verbatim" : "as text"}, {group.length} messages
                      </span>
                      <ul className="ml-4 list-disc space-y-1">
                        {group.map((message, position) => (
                          <li key={position} className="[overflow-wrap:anywhere]">
                            {summarize(message)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>

        <div className="space-y-3">
          <section aria-label="After the send" className={boxClass}>
            <h3 className="font-bold">
              After the send{" "}
              <span className="font-normal text-xs">
                (watermark {snapshot.watermark === null ? "none" : `row ${snapshot.watermark}`},{" "}
                {snapshot.folds.length} fold{snapshot.folds.length === 1 ? "" : "s"} kept)
              </span>
            </h3>
            {sent.length === 0 ? (
              <p className="mt-1 text-xs">No turn yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {sent.map((entry) => (
                  <li key={entry.turn}>
                    turn {entry.turn}: {entry.folded}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 font-mono text-xs [overflow-wrap:anywhere]">
              preferences: {snapshot.preferences ?? "none"}
            </p>
            <p className="mt-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
              next memory message: {nextMemory === null ? "none" : nextMemory.content}
            </p>
          </section>
          <section aria-label="Stored rows" className={boxClass}>
            <h3 className="font-bold">
              Rows <span className="font-normal text-xs">({rows.length})</span>
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
        </div>
      </div>
    </div>
  );
}
