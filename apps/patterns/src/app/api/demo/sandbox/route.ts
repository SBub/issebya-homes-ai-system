import { z } from "zod";
import { sandboxApi } from "@/lib/sandbox/run-code";
import { runInSandbox, type SandboxApi } from "@/lib/sandbox/sandbox";
import type { DemoResponse, ScriptRun } from "@/lib/sandbox/types";

/**
 * POST /api/demo/sandbox: the engine behind the `sandboxed-tool-shims`
 * demo. The program runs in `node:vm` in this process, standing in for the
 * microVM production uses. No env vars, no database. `exposeSendLink` adds
 * a key the engine has no shim for, to show the refusal before the VM
 * starts.
 */

const TODAY = "2026-10-01";
const TIMEOUT_MS = 1_000;

const bodySchema = z.object({ code: z.string(), exposeSendLink: z.boolean().optional() });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "code is required" }, { status: 400 });

  const api: SandboxApi = parsed.data.exposeSendLink
    ? { ...sandboxApi, sendLink: () => ({ sent: true }) }
    : sandboxApi;

  let run: ScriptRun | null = null;
  try {
    const result = await runInSandbox(parsed.data.code, api, {
      today: TODAY,
      timeoutMs: TIMEOUT_MS,
      onScriptRun: (scriptRun) => {
        run = scriptRun;
      },
    });
    const response: DemoResponse = {
      run: run ?? { stdout: "", error: null, stopped: true, elapsedMs: 0 },
      result,
    };
    return Response.json(response);
  } catch (thrown) {
    const response: DemoResponse = {
      refused: thrown instanceof Error ? thrown.message : String(thrown),
    };
    return Response.json(response);
  }
}
