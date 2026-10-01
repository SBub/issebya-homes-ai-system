"use client";

import { useState } from "react";
import { createFakeModel, type Message, type ScriptedRound } from "@/lib/harness/fake-model";
import { runTurn, tools, type TurnResult } from "@/lib/tool-loop/run-turn";

type Script = "answers" | "loops" | "empty";

const dates = { from: "2026-10-06", to: "2026-10-08" };

const SCRIPTS: Record<Script, { label: string; rounds: ScriptedRound[] }> = {
  answers: {
    label: "Answers after three rounds",
    rounds: [
      {
        toolCalls: [
          { toolName: "check_dates", input: dates },
          { toolName: "lookup_rate", input: dates },
        ],
      },
      { toolCalls: [{ toolName: "book_dates", input: dates }] },
      { text: "The 6th to the 8th is free at 120 EUR a night. I cannot book it for you here." },
    ],
  },
  loops: {
    label: "Keeps calling tools",
    rounds: Array.from({ length: 12 }, () => ({
      toolCalls: [{ toolName: "check_dates", input: dates }],
    })),
  },
  empty: {
    label: "Returns an empty reply",
    rounds: [{ toolCalls: [{ toolName: "lookup_rate", input: dates }] }, { text: "" }],
  },
};

const ENDED_TEXT: Record<TurnResult["ended"], string> = {
  text: "The model answered with text, so the loop returned it.",
  "empty-reply":
    "The model returned no text and no tool calls. The loop sent the fallback instead.",
  "round-cap": "The round cap fired on a tool message. The loop stopped and sent the fallback.",
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";
const fieldClass = "rounded-sm border border-gray-300 bg-white px-2 py-1";

function describePart(message: Message): string {
  if (message.role === "user") return `user: ${message.content}`;
  if (message.role === "tool") {
    const parts = message.content.map(
      (part) => `${part.toolName} (${part.toolCallId}): ${JSON.stringify(part.output)}`,
    );
    return `tool message, ${message.content.length} result${message.content.length === 1 ? "" : "s"}: ${parts.join("; ")}`;
  }
  if (typeof message.content === "string") return `assistant: ${message.content}`;
  const calls = message.content
    .filter((part) => part.type === "tool-call")
    .map((part) => `${part.toolName}(${JSON.stringify(part.input)})`);
  return `assistant asks for ${calls.length} tool call${calls.length === 1 ? "" : "s"}: ${calls.join(", ")}`;
}

/** Rounds as the loop sees them: the model's message, then the one tool message your loop built. */
function groupRounds(turnMessages: Message[]): Message[][] {
  const rounds: Message[][] = [];
  for (const message of turnMessages) {
    if (message.role === "assistant") rounds.push([message]);
    else rounds.at(-1)?.push(message);
  }
  return rounds;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Live demo for the `manual-tool-loop` doc. A scripted model from
 * `fake-model.ts` returns tool calls, then text; `run-turn.ts` runs the
 * loop with schema-only tools, its own dispatch, one batched tool message
 * per round, a round cap and a fallback reply. Pick a script and a cap, run
 * the turn, and read the rounds as they land.
 */
export function ToolLoopDemo({ delayMs = 400 }: { delayMs?: number }) {
  const [script, setScript] = useState<Script>("answers");
  const [maxRounds, setMaxRounds] = useState(4);
  const [messages, setMessages] = useState<Message[]>([]);
  const [result, setResult] = useState<TurnResult | null>(null);
  const [running, setRunning] = useState(false);

  const history: Message[] = [
    { role: "user", content: "Is the 6th to the 8th free, and how much?" },
  ];

  async function run() {
    setRunning(true);
    setResult(null);
    setMessages(history);
    const model = createFakeModel(SCRIPTS[script].rounds);
    const turn = await runTurn(model, history, {
      maxRounds,
      onRound: async (soFar) => {
        setMessages(soFar);
        if (delayMs > 0) await sleep(delayMs);
      },
    });
    setMessages(turn.messages);
    setResult(turn);
    setRunning(false);
  }

  const rounds = groupRounds(messages.slice(1));

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Model script
          <select
            value={script}
            onChange={(event) => setScript(event.target.value as Script)}
            disabled={running}
            className={fieldClass}
          >
            {Object.entries(SCRIPTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Round cap
          <input
            type="number"
            min={1}
            max={12}
            value={maxRounds}
            onChange={(event) => setMaxRounds(Math.max(1, Number(event.target.value) || 1))}
            disabled={running}
            className={`${fieldClass} w-20`}
          />
        </label>
        <button type="button" onClick={run} disabled={running} className={buttonClass}>
          Run turn
        </button>
        <span aria-live="polite" className="text-xs">
          {running ? "Running" : result ? `Ended after ${result.rounds} rounds` : "Idle"}
        </span>
      </div>

      <p className="mt-3 text-xs">
        Tools the model sees (schema only, no execute):{" "}
        {Object.entries(tools).map(([name, tool], index) => (
          <span key={name}>
            {index > 0 && ", "}
            <code>{name}</code> ({tool.description})
          </span>
        ))}
      </p>

      {messages.length > 0 && (
        <div className={`mt-3 ${boxClass}`}>
          <p className="font-mono text-xs">{describePart(messages[0])}</p>
          <ol aria-label="Rounds" className="mt-2 space-y-2">
            {rounds.map((round, index) => (
              <li key={index} className="font-mono text-xs">
                <span className="font-bold">Round {index + 1}</span>
                <ul className="ml-4 list-disc space-y-1">
                  {round.map((message, position) => (
                    <li key={position} className="[overflow-wrap:anywhere]">
                      {describePart(message)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      )}

      {result && (
        <div className={`mt-3 ${boxClass}`} aria-label="Turn result">
          <p className="font-mono text-xs [overflow-wrap:anywhere]">Reply: {result.reply}</p>
          <p className="mt-1 text-xs">{ENDED_TEXT[result.ended]}</p>
        </div>
      )}
    </div>
  );
}
