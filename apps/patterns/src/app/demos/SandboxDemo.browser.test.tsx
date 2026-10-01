import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { DemoRequest, DemoResponse } from "@/lib/sandbox/types";
import { PRESETS, SandboxDemo } from "./SandboxDemo";

const SENTINEL = "__RUNCODE_RESULT__";

/**
 * Stands in for the route: the engine runs on the server, so the browser
 * test answers each request with what /api/demo/sandbox returns for it,
 * keyed on the program's text. The engine itself is covered by the node
 * tests under src/lib/sandbox/__tests__.
 */
async function fakeRoute(body: DemoRequest): Promise<DemoResponse> {
  if (body.exposeSendLink) {
    return {
      refused:
        "runInSandbox: no shim for tool(s): sendLink. Add one to SUPPORTED_TOOLS and buildScript before exposing it.",
    };
  }
  if (body.code.includes("new Promise(() => {})")) {
    return {
      run: {
        stdout: "waiting for something that never comes\n",
        error: "timed out after 1000 ms",
        stopped: true,
        elapsedMs: 1001,
      },
      result: { ok: false, error: "timed out after 1000 ms", logs: [], calls: [] },
    };
  }
  const output = {
    ok: true as const,
    result: { from: "2026-10-13", to: "2026-10-15", nightly: 95, currency: "EUR" },
    logs: ["2026-10-10 to 2026-10-12 taken", "2026-10-13 to 2026-10-15 free"],
    calls: [
      { tool: "checkDates", args: { from: "2026-10-10", to: "2026-10-12" } },
      { tool: "checkDates", args: { from: "2026-10-13", to: "2026-10-15" } },
      { tool: "lookupRate", args: { room: "small" } },
    ],
  };
  return {
    run: {
      stdout: `${output.logs.join("\n")}\n${SENTINEL}${JSON.stringify(output)}\n`,
      error: null,
      stopped: true,
      elapsedMs: 12,
    },
    result: output,
  };
}

async function setup() {
  const screen = await render(<SandboxDemo run={fakeRoute} />);
  return {
    screen,
    run: screen.getByRole("button", { name: "Run" }),
    program: screen.getByRole("textbox", { name: "Program" }),
    expose: screen.getByRole("checkbox", { name: /Expose sendLink/ }),
    stdout: screen.getByLabelText("Stdout"),
    result: screen.getByLabelText("Result"),
    logs: screen.getByLabelText("Logs"),
    calls: screen.getByLabelText("Shim calls"),
  };
}

test("a program's logs and its sentinel line arrive on stdout and the result is parsed", async () => {
  const { run, program, stdout, result, logs, calls } = await setup();
  await expect.element(program).toHaveValue(PRESETS[0].code);
  await run.click();

  await expect.element(stdout).toHaveTextContent("12 ms, stopped");
  await expect.element(stdout).toHaveTextContent(`${SENTINEL}{"ok":true`);
  await expect
    .element(result)
    .toHaveTextContent('ok: {"from":"2026-10-13","to":"2026-10-15","nightly":95,"currency":"EUR"}');
  await expect.element(logs).toHaveTextContent("Logs (2)");
  await expect.element(logs).toHaveTextContent("2026-10-13 to 2026-10-15 free");
  await expect.element(calls).toHaveTextContent("Shim calls (3)");
  await expect.element(calls).toHaveTextContent('lookupRate({"room":"small"})');
});

test("a program that awaits forever is timed out and stopped", async () => {
  const { run, screen, stdout, result, calls } = await setup();
  await screen.getByRole("button", { name: "Hangs" }).click();
  await run.click();

  await expect.element(stdout).toHaveTextContent("1001 ms, stopped");
  await expect.element(result).toHaveTextContent("error: timed out after 1000 ms");
  await expect.element(calls).toHaveTextContent("Shim calls (0)");
});

test("a send exposed to the sandbox is refused before the VM starts", async () => {
  const { run, screen, expose } = await setup();
  await screen.getByRole("button", { name: "Tries to send" }).click();
  await expose.click();
  await run.click();

  await expect
    .element(screen.getByLabelText("Refused"))
    .toHaveTextContent("no shim for tool(s): sendLink");
});
