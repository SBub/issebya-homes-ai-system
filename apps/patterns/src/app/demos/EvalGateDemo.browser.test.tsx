import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { EvalGateDemo } from "./EvalGateDemo";

async function setup() {
  const screen = await render(<EvalGateDemo />);
  return {
    screen,
    run: screen.getByRole("button", { name: "Run" }),
    mode: screen.getByRole("combobox", { name: "Break" }),
    trials: screen.getByRole("spinbutton", { name: "Trials per case" }),
    rows: screen.getByLabelText("Scores").getByRole("row"),
    verdict: screen.getByLabelText("Verdict"),
    averaged: screen.getByLabelText("Averaged"),
    failing: screen.getByLabelText("Failing rows"),
  };
}

test("the unbroken dataset passes every gate over five cases and three trials", async () => {
  const { run, rows, verdict, failing, screen } = await setup();
  await expect.element(screen.getByLabelText("Dataset")).toHaveTextContent("5 cases");
  await run.click();

  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*100\.0%\s*85\.0%\s*PASS/);
  await expect
    .element(rows.nth(2))
    .toHaveTextContent(/AI Disclosure\s*6\s*100\.0%\s*90\.0%\s*PASS/);
  await expect
    .element(rows.nth(3))
    .toHaveTextContent(/Security Invariant Held\s*3\s*100\.0%\s*90\.0%\s*PASS/);
  await expect.element(verdict).toHaveTextContent("PASS: every gated scorer");
  await expect.element(failing).toHaveTextContent("None.");
});

test("a wrong year fails Tool Call Match alone while the averaged number passes", async () => {
  const { run, mode, rows, verdict, averaged, failing } = await setup();
  await mode.selectOptions("wrong-year");
  await run.click();

  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*80\.0%\s*85\.0%\s*FAIL/);
  await expect
    .element(rows.nth(2))
    .toHaveTextContent(/AI Disclosure\s*6\s*100\.0%\s*90\.0%\s*PASS/);
  await expect
    .element(rows.nth(3))
    .toHaveTextContent(/Security Invariant Held\s*3\s*100\.0%\s*90\.0%\s*PASS/);
  await expect.element(verdict).toHaveTextContent("FAIL: Tool Call Match below threshold");
  await expect
    .element(averaged)
    .toHaveTextContent("93.3% against 90.0%: PASS. That is the weak scorer hidden.");
  await expect
    .element(failing)
    .toHaveTextContent(
      "dates-01 trial 1: Tool Call Match: check_dates name matched but args differ",
    );
});

test("the disclosure and the judge scorers each fail on their own case", async () => {
  const { run, mode, rows, verdict } = await setup();
  await mode.selectOptions("no-disclosure");
  await run.click();
  await expect.element(rows.nth(2)).toHaveTextContent(/AI Disclosure\s*6\s*50\.0%\s*90\.0%\s*FAIL/);
  await expect.element(verdict).toHaveTextContent("FAIL: AI Disclosure below threshold");

  await mode.selectOptions("leak");
  await run.click();
  await expect
    .element(rows.nth(3))
    .toHaveTextContent(/Security Invariant Held\s*3\s*0\.0%\s*90\.0%\s*FAIL/);
  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*100\.0%\s*85\.0%\s*PASS/);
  await expect.element(verdict).toHaveTextContent("FAIL: Security Invariant Held below threshold");
});

test("a flaky case fails on one trial and settles over three", async () => {
  const { run, mode, trials, rows, screen } = await setup();
  await mode.selectOptions("wrong-year-one-trial");
  await trials.fill("1");
  await run.click();
  await expect
    .element(screen.getByLabelText("Scores"))
    .toHaveTextContent("5 rows: 5 cases x 1 trial");
  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*5\s*80\.0%\s*85\.0%\s*FAIL/);

  await trials.fill("3");
  await run.click();
  await expect
    .element(screen.getByLabelText("Scores"))
    .toHaveTextContent("15 rows: 5 cases x 3 trials");
  await expect
    .element(rows.nth(1))
    .toHaveTextContent(/Tool Call Match\s*15\s*93\.3%\s*85\.0%\s*PASS/);
});
