import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { SteppedEffectsDemo } from "./SteppedEffectsDemo";

async function setup() {
  const screen = await render(<SteppedEffectsDemo />);
  return {
    screen,
    run: screen.getByRole("button", { name: "Run" }),
    replay: screen.getByRole("button", { name: "Replay" }),
    variant: screen.getByRole("combobox", { name: "Variant" }),
    log: screen.getByLabelText("Runner log").getByRole("listitem"),
    effects: screen.getByLabelText("Side effects").getByRole("listitem"),
    memo: screen.getByLabelText("Memoized steps").getByRole("listitem"),
  };
}

test("Run performs each side effect once, in its own step", async () => {
  const { screen, run, effects, memo } = await setup();
  await run.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect
    .element(effects.nth(4))
    .toHaveTextContent('send reply "The 6th to the 8th is free."');
  expect(effects.elements()).toHaveLength(5);
  expect(memo.elements().map((element) => element.textContent)).toEqual([
    "load-prompt",
    "model-1",
    "tools-1",
    "model-2",
    "send-reply",
  ]);
  await expect.element(screen.getByText(/1 prompt fetches, 1 replies sent/)).toBeVisible();
});

test("Replay runs the function from the top and every step answers from the memo", async () => {
  const { screen, run, replay, effects, log } = await setup();
  await run.click();
  await replay.click();

  await expect
    .element(screen.getByText("invocation 2 (replay): the function runs from the top"))
    .toBeVisible();
  const memoized = screen.getByText(/memoized, callback skipped/);
  await expect.element(memoized.nth(4)).toBeVisible();
  expect(memoized.elements()).toHaveLength(5);
  expect(effects.elements()).toHaveLength(5);
  expect(log.elements().length).toBeGreaterThan(10);
});

test("a send outside a step goes out again on Replay", async () => {
  const { screen, run, replay, variant, effects } = await setup();
  await variant.selectOptions("send-unstepped");
  await run.click();
  await replay.click();

  await expect.element(screen.getByText(/2 replies sent/)).toBeVisible();
  expect(effects.elements().filter((e) => e.textContent?.includes("send reply"))).toHaveLength(2);
  await expect.element(effects.nth(5)).toHaveTextContent("invocation 2: send reply");
});

test("a prompt fetched in the loop is fetched once more per finished round on Replay", async () => {
  const { screen, run, replay, variant } = await setup();
  await variant.selectOptions("prompt-in-loop");
  await run.click();
  await expect.element(screen.getByText(/2 prompt fetches/)).toBeVisible();
  await replay.click();

  await expect.element(screen.getByText(/4 prompt fetches, 1 replies sent/)).toBeVisible();
});

test("a step inside a step is refused", async () => {
  const { screen, run, variant } = await setup();
  await variant.selectOptions("nested");
  await run.click();

  await expect.element(screen.getByText(/^Failed\./)).toBeVisible();
  await expect
    .element(screen.getByText(/step "send-reply" was called inside step "model-2"/))
    .toBeVisible();
  await expect.element(screen.getByText(/0 replies sent/)).toBeVisible();
});
