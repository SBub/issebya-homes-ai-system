"use client";

import { useState } from "react";
import type { Message } from "@/lib/harness/fake-model";
import { createTable } from "@/lib/harness/store";
import {
  buildHistory,
  estimateTokens,
  finalizeTurn,
  type MessageRow,
  trimToBudget,
} from "@/lib/history/history";

type StoredRow = Omit<MessageRow, "id">;

type ScriptedTurn = {
  question: string;
  tool: { name: string; input: Record<string, unknown>; output: unknown };
  reply: string;
};

const SAMPLE_TURNS: ScriptedTurn[] = [
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
    question: "How much per night?",
    tool: {
      name: "lookup_rate",
      input: { from: "2026-10-06", to: "2026-10-08" },
      output: { nightly: 120, currency: "EUR", nights: 2, total: 240 },
    },
    reply: "120 EUR a night, 240 EUR for the two nights.",
  },
  {
    question: "Is breakfast included?",
    tool: {
      name: "search_notes",
      input: { query: "breakfast" },
      output: { hits: ["Breakfast is not included. A bakery is two doors down."] },
    },
    reply: "Breakfast is not included, but there is a bakery two doors down.",
  },
  {
    question: "And the 10th to the 12th instead?",
    tool: {
      name: "check_dates",
      input: { from: "2026-10-10", to: "2026-10-12" },
      output: { free: false, from: "2026-10-10", to: "2026-10-12" },
    },
    reply: "The 10th to the 12th is taken. The 6th to the 8th is still free.",
  },
  {
    question: "Can I bring a dog?",
    tool: {
      name: "search_notes",
      input: { query: "pets" },
      output: { hits: ["Small dogs are welcome at no extra charge."] },
    },
    reply: "Small dogs are welcome at no extra charge.",
  },
  {
    question: "Ok, the 6th to the 8th then.",
    tool: {
      name: "check_dates",
      input: { from: "2026-10-06", to: "2026-10-08" },
      output: { free: true, from: "2026-10-06", to: "2026-10-08" },
    },
    reply: "Still free. I will send you the link once the owner confirms.",
  },
];

const INITIAL_TURNS = 4;

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";
const fieldClass = "rounded-sm border border-gray-300 bg-white px-2 py-1";

function turnRows(turn: ScriptedTurn, index: number): StoredRow[] {
  const callId = `call_${index + 1}`;
  const tail: Message[] = [
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: callId, toolName: turn.tool.name, input: turn.tool.input },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: callId,
          toolName: turn.tool.name,
          output: turn.tool.output,
        },
      ],
    },
    { role: "assistant", content: turn.reply },
  ];
  return [
    { role: "user", content: turn.question, turnMessages: null },
    { role: "assistant", content: turn.reply, turnMessages: finalizeTurn(tail, turn.reply) },
  ];
}

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
 * Live demo for the `turn-replay-history` doc. Rows live in a table from
 * `store.ts`: a user row per question and an assistant row carrying the
 * turn's own messages, made self-contained by `finalizeTurn`. On every
 * change the history is rebuilt by `buildHistory` (the last N turns
 * verbatim, older turns as text) and cut by `trimToBudget` (whole turns from
 * the oldest, never the last). Add turns, move the budget, and read what the
 * model would see.
 */
export function HistoryDemo() {
  const [table] = useState(() => {
    const created = createTable<StoredRow>();
    SAMPLE_TURNS.slice(0, INITIAL_TURNS).forEach((turn, index) => {
      for (const row of turnRows(turn, index)) created.insert(row);
    });
    return created;
  });
  const [rows, setRows] = useState<MessageRow[]>(() => table.rows());
  const [verbatimTurns, setVerbatimTurns] = useState(3);
  const [maxTokens, setMaxTokens] = useState(400);

  const turnCount = rows.filter((row) => row.role === "user").length;

  const addTurn = () => {
    const turn = SAMPLE_TURNS[turnCount % SAMPLE_TURNS.length];
    for (const row of turnRows(turn, turnCount)) table.insert(row);
    setRows(table.rows());
  };

  const groups = buildHistory(rows, { verbatimTurns });
  const keep = Math.round(maxTokens * 0.75);
  const { kept, dropped } = trimToBudget(groups, { max: maxTokens, keep });
  const before = estimateTokens(groups.flat());
  const after = estimateTokens(kept.flat());

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" onClick={addTurn} className={buttonClass}>
          Add a turn
        </button>
        <label className="flex flex-col gap-1 text-xs">
          Verbatim turns
          <input
            type="number"
            min={0}
            max={10}
            value={verbatimTurns}
            onChange={(event) => setVerbatimTurns(Math.max(0, Number(event.target.value) || 0))}
            className={`${fieldClass} w-20`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Token budget: {maxTokens} max, trim to {keep}
          <input
            type="range"
            min={50}
            max={1000}
            step={10}
            value={maxTokens}
            onChange={(event) => setMaxTokens(Number(event.target.value))}
            aria-label="Token budget"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="Stored rows" className={boxClass}>
          <h3 className="font-bold">
            Stored rows <span className="font-normal text-xs">({turnCount} turns)</span>
          </h3>
          <ol className="mt-2 space-y-1 font-mono text-xs">
            {rows.map((row) => (
              <li key={row.id} className="[overflow-wrap:anywhere]">
                #{row.id} {row.role}: {row.content}
                {row.role === "assistant" && (
                  <span className="text-gray-600">
                    {" "}
                    ({row.turnMessages ? `${row.turnMessages.length} turn messages` : "text only"})
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="What the model sees" className={boxClass}>
          <h3 className="font-bold">What the model sees</h3>
          <p aria-live="polite" className="mt-1 text-xs">
            {before} tokens before trimming, {after} after.{" "}
            {dropped === 0
              ? "Nothing dropped."
              : `Dropped the ${dropped} oldest turn${dropped === 1 ? "" : "s"}, whole.`}
          </p>
          <ol aria-label="Replayed turns" className="mt-2 space-y-2">
            {kept.map((group, index) => {
              const turnNumber = dropped + index + 1;
              const verbatim = group.some((message) => message.role === "tool");
              return (
                <li key={turnNumber} className="font-mono text-xs">
                  <span className="font-bold">
                    Turn {turnNumber}: {verbatim ? "verbatim" : "text"}, {group.length} messages
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
        </section>
      </div>
    </div>
  );
}
