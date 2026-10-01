"use client";

import { useState, useSyncExternalStore } from "react";
import { createStepRunner, type DurableRun } from "@/lib/harness/step-runner";
import {
  type ChatMessage,
  createChat,
  createRequestFunction,
  relayUpdate,
  type RelayOptions,
  type RequestResult,
} from "@/lib/in-band/request";

const QUESTIONS = [
  "Is late check-in at 23:00 possible?",
  "Is there parking at the house?",
  "Can we bring a small dog?",
];

type Request = { id: string; question: string; run: DurableRun<RequestResult> };

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";
const fieldClass = "rounded-sm border border-gray-300 bg-white px-2 py-1";

function statusOf(run: DurableRun<RequestResult>): string {
  const snapshot = run.getSnapshot();
  if (snapshot.status === "suspended" && snapshot.pendingWait !== null) {
    return `waiting for ${snapshot.pendingWait.event} where data.id is ${String(snapshot.pendingWait.value)}`;
  }
  if (snapshot.status === "done") return `done: ${JSON.stringify(snapshot.result)}`;
  return snapshot.status;
}

/**
 * Live demo for the `in-band-correlation` doc. New request starts a durable
 * function from `request.ts` that posts a question to the chat with the id in
 * a `[ref:<id>]` tag and waits. The reply box is the chat app: it delivers the
 * reply with the id of the message it replies to, and `relayUpdate` parses
 * the id out of that message's text and sends the event. The function then
 * posts a decision with the id in each button's data; a tap goes through the
 * same relay. A second reply or tap finds nothing waiting and is ignored.
 * With two requests pending, the checkbox switches the relay to "the latest
 * question", which resumes the wrong run.
 */
export function InBandDemo({ timeoutMs = 60000 }: { timeoutMs?: number }) {
  const [chat] = useState(() => createChat());
  const [requests, setRequests] = useState<Request[]>([]);
  const [relayLog, setRelayLog] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [text, setText] = useState("Yes, until 23:00.");
  const [lookup, setLookup] = useState<NonNullable<RelayOptions["lookup"]>>("message");
  const [, setTick] = useState(0);

  const messages = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot);
  const rerender = () => setTick((current) => current + 1);

  const newRequest = async () => {
    const id = `req_${requests.length + 1}`;
    const question = QUESTIONS[requests.length % QUESTIONS.length];
    const run = createStepRunner(createRequestFunction({ chat, timeout: timeoutMs }), {
      trigger: { name: "request.received", data: { id, question } },
    });
    run.subscribe(rerender);
    setRequests((current) => [...current, { id, question, run }]);
    await run.start();
  };

  const relay = async (update: Parameters<typeof relayUpdate>[0]) => {
    const outcome = await relayUpdate(update, {
      chat,
      runs: requests.map((request) => request.run),
      lookup,
    });
    const what = update.kind === "tap" ? `tap ${update.data}` : `reply to #${update.replyTo}`;
    setRelayLog((current) => [
      ...current,
      `${what}: parsed id ${outcome.id ?? "none"}${outcome.event ? `, sent ${outcome.event.name}` : ""}, ${outcome.note}`,
    ]);
  };

  const sendReply = async () => {
    const target =
      replyTo ?? messages.filter((message) => message.from === "agent").at(-1)?.id ?? null;
    if (target === null || text.trim() === "") return;
    await relay({ kind: "reply", replyTo: target, text: text.trim() });
  };

  const reset = () => {
    for (const request of requests) request.run.reset();
    setRequests([]);
    chat.clear();
    setRelayLog([]);
    setReplyTo(null);
  };

  const agentMessages = messages.filter((message) => message.from === "agent");

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={newRequest} className={buttonClass}>
          New request
        </button>
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={lookup === "latest"}
            onChange={(event) => setLookup(event.target.checked ? "latest" : "message")}
          />
          Resolve the latest question instead of the id in the message (wrong)
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="Chat" className={boxClass}>
          <h3 className="font-bold">Chat with the approver</h3>
          {messages.length === 0 ? (
            <p className="mt-1 text-xs">Empty.</p>
          ) : (
            <ol className="mt-2 space-y-2 font-mono text-xs">
              {messages.map((message: ChatMessage) => (
                <li key={message.id} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <span className="font-bold">
                    #{message.id} {message.from}
                    {message.replyTo !== null ? ` (reply to #${message.replyTo})` : ""}:
                  </span>{" "}
                  {message.text}
                  {message.buttons.length > 0 && (
                    <span className="ml-2 inline-flex gap-1">
                      {message.buttons.map((button) => (
                        <button
                          key={button.data}
                          type="button"
                          onClick={() => relay({ kind: "tap", data: button.data })}
                          className={buttonClass}
                          title={button.data}
                        >
                          {button.label} ({button.data})
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Reply to
              <select
                value={replyTo ?? agentMessages.at(-1)?.id ?? ""}
                onChange={(event) => setReplyTo(Number(event.target.value))}
                className={fieldClass}
                aria-label="Reply to"
              >
                {agentMessages.map((message) => (
                  <option key={message.id} value={message.id}>
                    #{message.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Reply text
              <input
                type="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                className={`${fieldClass} w-56`}
                aria-label="Reply text"
              />
            </label>
            <button
              type="button"
              onClick={sendReply}
              disabled={agentMessages.length === 0}
              className={buttonClass}
            >
              Send reply
            </button>
          </div>
        </section>

        <div className="space-y-3">
          <section aria-label="Requests" className={boxClass}>
            <h3 className="font-bold">Runs</h3>
            {requests.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 font-mono text-xs space-y-1">
                {requests.map((request) => (
                  <li key={request.id} className="[overflow-wrap:anywhere]">
                    {request.id}: {statusOf(request.run)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Relay log" className={boxClass}>
            <h3 className="font-bold">Relay</h3>
            {relayLog.length === 0 ? (
              <p className="mt-1 text-xs">Nothing yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {relayLog.map((line, index) => (
                  <li key={index} className="[overflow-wrap:anywhere]">
                    {line}
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
