/**
 * The shapes the sandbox route and the `sandboxed-tool-shims` demo share.
 * No runtime imports, so the client component can import this file.
 */

type ShimCall = { tool: string; args: unknown };

/** What the program's run comes back as: the sentinel line, parsed. Logs and shim calls ride along either way. */
export type SandboxResult =
  | { ok: true; result: unknown; logs: string[]; calls: ShimCall[] }
  | { ok: false; error: string; logs: string[]; calls: ShimCall[] };

/** One execution of the generated script, before parsing. */
export type ScriptRun = {
  /** Everything the script wrote, the sentinel line included. */
  stdout: string;
  /** Set when the script could not finish: a timeout, or a syntax error. */
  error: string | null;
  /** True after the stop in `finally`: always, on every path. */
  stopped: boolean;
  elapsedMs: number;
};

export type DemoRequest = { code: string; exposeSendLink: boolean };

export type DemoResponse = { refused: string } | { run: ScriptRun; result: SandboxResult };
