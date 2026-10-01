import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ReleaseGateDemo } from "./ReleaseGateDemo";

async function setup() {
  const screen = await render(<ReleaseGateDemo />);
  return {
    screen,
    run: screen.getByRole("button", { name: "Run" }),
    scenario: screen.getByRole("combobox", { name: "Scenario" }),
    check: screen.getByRole("checkbox", { name: /Check the dataset/ }),
    registry: screen.getByLabelText("Registry", { exact: true }),
    gate: screen.getByLabelText("Release gate"),
    rows: screen.getByLabelText("Release gate").getByRole("row"),
    verdict: screen.getByLabelText("Verdict"),
  };
}

test("in step, the gate passes on the registry the tool files export", async () => {
  const { run, registry, rows, verdict } = await setup();
  await expect.element(registry).toHaveTextContent("check_dates, lookup_rate");
  await run.click();

  await expect.element(registry).toHaveTextContent("Args compared for: check_dates.");
  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*100\.0%\s*85\.0%\s*PASS/);
  await expect
    .element(verdict)
    .toHaveTextContent("PASS: every scorer at or above its own threshold, args compared.");
});

test("a wrong year fails Tool Call Match loudly", async () => {
  const { run, scenario, rows, verdict } = await setup();
  await scenario.selectOptions("wrong-year");
  await run.click();

  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*80\.0%\s*85\.0%\s*FAIL/);
  await expect.element(verdict).toHaveTextContent("FAIL: Tool Call Match below threshold.");
});

test("a rename that missed the allowlist fails before any row runs", async () => {
  const { run, scenario, registry, gate, verdict } = await setup();
  await scenario.selectOptions("renamed");
  await run.click();

  await expect.element(registry).toHaveTextContent("check_availability, lookup_rate");
  await expect.element(registry).toHaveTextContent("Args compared for: no registered tool.");
  await expect.element(verdict).toHaveTextContent("FAIL before any row ran.");
  await expect
    .element(gate)
    .toHaveTextContent(
      'the args allowlist names "check_dates", which is not a tool, so its args would never be compared',
    );
});

test("without the check, the same rename passes silently", async () => {
  const { run, scenario, check, rows, verdict } = await setup();
  await scenario.selectOptions("renamed");
  await check.click();
  await run.click();

  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*100\.0%\s*85\.0%\s*PASS/);
  await expect
    .element(verdict)
    .toHaveTextContent("PASS, and the wrong year was never compared. That is the silent pass.");
});
