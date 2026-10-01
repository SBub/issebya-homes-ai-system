"use client";

import { useState } from "react";
import { createBatchExporter, createTracer, type EndedSpan } from "@/lib/harness/span-exporter";
import { createStepRunner } from "@/lib/harness/step-runner";
import type { ToolContext } from "@/lib/tool-files/context";
import { runTool } from "@/lib/tool-files/run-tool";

const TODAY = "2026-10-01";

type Call = { label: string; toolName: string; input: Record<string, unknown> };

const CALLS: Call[] = [
  {
    label: "check_dates, free",
    toolName: "check_dates",
    input: { from: "2026-10-06", to: "2026-10-08" },
  },
  {
    label: "check_dates, in the past",
    toolName: "check_dates",
    input: { from: "2026-09-20", to: "2026-09-22" },
  },
  { label: "lookup_rate", toolName: "lookup_rate", input: { room: "small" } },
  { label: "lookup_rate, bad input", toolName: "lookup_rate", input: { room: "penthouse" } },
  {
    label: "book_dates, no such tool",
    toolName: "book_dates",
    input: { from: "2026-10-06", to: "2026-10-08" },
  },
];

type Entry = {
  call: Call;
  outcome: string;
  span: EndedSpan | null;
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

/**
 * Live demo for the `tool-file-convention` doc. Each button is one tool call
 * as the loop would dispatch it: a durable run whose function calls
 * `runTool` from `run-tool.ts`, which hands the call to the tool's own
 * `run<Tool>` in its own file. The result and the tool span's status are
 * shown side by side: a soft failure comes back as an object the model can
 * read, with the span marked failed; an unknown name comes back as an error
 * object from the dispatcher's `default`. The two checkboxes switch to the
 * wrong shapes, where the run fails and the model gets nothing.
 */
export function ToolFilesDemo() {
  const [exporter] = useState(() => createBatchExporter());
  const [tracer] = useState(() => createTracer(exporter));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [throwSoft, setThrowSoft] = useState(false);
  const [throwUnknown, setThrowUnknown] = useState(false);

  const dispatch = async (call: Call) => {
    const variant: ToolContext["variant"] = {
      softFailure: throwSoft ? "throw" : "return",
      unknownTool: throwUnknown ? "throw" : "error",
    };
    const { anchor } = await tracer.startRoot("tool.call", (span) => {
      span.setAttribute("tool.name", call.toolName);
    });
    const run = createStepRunner<unknown>(
      ({ step }) =>
        runTool(call.toolName, call.input, {
          step,
          tracer,
          traceAnchor: anchor,
          today: TODAY,
          variant,
        }),
      { trigger: { name: "tool.call", data: { toolName: call.toolName } } },
    );
    await run.start();
    await exporter.flush();
    const snapshot = run.getSnapshot();
    const span =
      exporter
        .getSnapshot()
        .exported.find(
          (entry) => entry.traceId === anchor.traceId && entry.name.startsWith("tool-"),
        ) ?? null;
    const outcome =
      snapshot.status === "done"
        ? `returned ${JSON.stringify(snapshot.result)}`
        : `the run failed: ${snapshot.error}. No tool result reaches the model.`;
    setEntries((current) => [...current, { call, outcome, span }]);
  };

  const reset = () => {
    exporter.clear();
    setEntries([]);
  };

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {CALLS.map((call) => (
          <button
            key={call.label}
            type="button"
            onClick={() => dispatch(call)}
            className={buttonClass}
          >
            {call.label}
          </button>
        ))}
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={throwSoft}
            onChange={(event) => setThrowSoft(event.target.checked)}
          />
          Throw on a soft failure (wrong)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={throwUnknown}
            onChange={(event) => setThrowUnknown(event.target.checked)}
          />
          Throw on an unknown tool name (wrong)
        </label>
      </div>
      <p className="mt-2 text-xs">
        Today is fixed at {TODAY}, so every call gives the same answer.
      </p>

      <section aria-label="Tool calls" className={`${boxClass} mt-3`}>
        <h3 className="font-bold">
          Calls <span className="font-normal text-xs">({entries.length})</span>
        </h3>
        {entries.length === 0 ? (
          <p className="mt-1 text-xs">None yet.</p>
        ) : (
          <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-2">
            {entries.map((entry, index) => (
              <li key={index} className="[overflow-wrap:anywhere]">
                <div>
                  {entry.call.toolName}({JSON.stringify(entry.call.input)})
                </div>
                <div>{entry.outcome}</div>
                <div className="text-gray-600">
                  {entry.span === null
                    ? "span: none, the step failed before a span ended"
                    : `span ${entry.span.name}: ${entry.span.status === "error" ? `error (${entry.span.error})` : "ok"}`}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
