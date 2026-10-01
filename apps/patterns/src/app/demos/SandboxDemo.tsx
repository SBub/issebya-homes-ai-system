"use client";

import { useState } from "react";
import type { DemoRequest, DemoResponse } from "@/lib/sandbox/types";

type Preset = { label: string; code: string };

export const PRESETS: Preset[] = [
  {
    label: "Next free range",
    code: `const candidates = [
  { from: "2026-10-10", to: "2026-10-12" },
  { from: "2026-10-13", to: "2026-10-15" },
];
for (const range of candidates) {
  const check = await tools.checkDates(range);
  console.log(range.from, "to", range.to, check.ok ? (check.free ? "free" : "taken") : check.reason);
  if (check.ok && check.free) {
    const rate = await tools.lookupRate({ room: "small" });
    return { ...range, nightly: rate.nightly, currency: rate.currency };
  }
}
return null;`,
  },
  {
    label: "Throws",
    code: `const rate = await tools.lookupRate({ room: "penthouse" });
return rate;`,
  },
  {
    label: "Hangs",
    code: `console.log("waiting for something that never comes");
await new Promise(() => {});
return "unreachable";`,
  },
  {
    label: "Busy loop",
    code: `while (true) {}
return "unreachable";`,
  },
  {
    label: "Tries to send",
    code: `return await tools.sendLink({ from: "2026-10-13", to: "2026-10-15" });`,
  },
];

async function postToRoute(body: DemoRequest): Promise<DemoResponse> {
  const response = await fetch("/api/demo/sandbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as DemoResponse;
}

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

/**
 * Live demo for the `sandboxed-tool-shims` doc. The textarea is the
 * program a model would write; Run posts it to /api/demo/sandbox, where it
 * runs in `node:vm` inside a generated script with the shims, a one second
 * timeout and a stop in `finally`. The panels show the raw stdout, the
 * sentinel line parsed into the result, the logs, and the shim call log.
 * The checkbox exposes a send to the sandbox, which the engine refuses
 * before the VM starts because no shim exists for it.
 */
export function SandboxDemo({ run = postToRoute }: { run?: typeof postToRoute }) {
  const [code, setCode] = useState(PRESETS[0].code);
  const [exposeSendLink, setExposeSendLink] = useState(false);
  const [response, setResponse] = useState<DemoResponse | null>(null);
  const [running, setRunning] = useState(false);

  const start = async () => {
    setRunning(true);
    setResponse(await run({ code, exposeSendLink }));
    setRunning(false);
  };

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setCode(preset.code)}
            className={buttonClass}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="mt-2 block">
        <span className="text-xs">Program (an async function body)</span>
        <textarea
          aria-label="Program"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          rows={10}
          className="mt-1 w-full rounded-sm border border-gray-300 bg-white p-2 font-mono text-xs"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <button type="button" onClick={start} disabled={running} className={buttonClass}>
          Run
        </button>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={exposeSendLink}
            onChange={(event) => setExposeSendLink(event.target.checked)}
          />
          Expose sendLink to the sandbox (wrong)
        </label>
      </div>

      {response !== null && "refused" in response ? (
        <section aria-label="Refused" className={`${boxClass} mt-3`}>
          <h3 className="font-bold">Refused before the VM started</h3>
          <p className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">{response.refused}</p>
        </section>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <section aria-label="Stdout" className={boxClass}>
            <h3 className="font-bold">
              stdout{" "}
              {response !== null && (
                <span className="font-normal text-xs">
                  ({response.run.elapsedMs} ms, {response.run.stopped ? "stopped" : "not stopped"})
                </span>
              )}
            </h3>
            {response === null ? (
              <p className="mt-1 text-xs">Not run yet.</p>
            ) : (
              <pre className="mt-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
                {response.run.stdout || "(nothing)"}
              </pre>
            )}
          </section>
          <section aria-label="Result" className={boxClass}>
            <h3 className="font-bold">Parsed result</h3>
            {response === null ? (
              <p className="mt-1 text-xs">Not run yet.</p>
            ) : (
              <pre className="mt-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
                {response.result.ok
                  ? `ok: ${JSON.stringify(response.result.result)}`
                  : `error: ${response.result.error}`}
              </pre>
            )}
          </section>
          <section aria-label="Logs" className={boxClass}>
            <h3 className="font-bold">
              Logs{" "}
              <span className="font-normal text-xs">({response?.result.logs.length ?? 0})</span>
            </h3>
            {response === null || response.result.logs.length === 0 ? (
              <p className="mt-1 text-xs">None.</p>
            ) : (
              <ol className="mt-1 list-decimal pl-5 font-mono text-xs">
                {response.result.logs.map((line, index) => (
                  <li key={index} className="[overflow-wrap:anywhere]">
                    {line}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Shim calls" className={boxClass}>
            <h3 className="font-bold">
              Shim calls{" "}
              <span className="font-normal text-xs">({response?.result.calls.length ?? 0})</span>
            </h3>
            {response === null || response.result.calls.length === 0 ? (
              <p className="mt-1 text-xs">None.</p>
            ) : (
              <ol className="mt-1 list-decimal pl-5 font-mono text-xs">
                {response.result.calls.map((call, index) => (
                  <li key={index} className="[overflow-wrap:anywhere]">
                    {call.tool}({JSON.stringify(call.args)})
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
