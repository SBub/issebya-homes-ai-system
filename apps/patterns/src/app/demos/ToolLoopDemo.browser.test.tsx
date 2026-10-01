import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ToolLoopDemo } from "./ToolLoopDemo";

async function setup() {
  const screen = await render(<ToolLoopDemo delayMs={0} />);
  return {
    screen,
    run: screen.getByRole("button", { name: "Run turn" }),
    script: screen.getByRole("combobox", { name: "Model script" }),
    cap: screen.getByRole("spinbutton", { name: "Round cap" }),
    result: screen.getByLabelText("Turn result"),
  };
}

test("three scripted rounds: two batched results, an unknown tool error, then text", async () => {
  const { screen, run, result } = await setup();

  await run.click();

  await expect.element(screen.getByText("Ended after 3 rounds")).toBeVisible();
  await expect.element(screen.getByText("Round 1")).toBeVisible();
  await expect.element(screen.getByText(/tool message, 2 results/)).toBeVisible();
  await expect.element(screen.getByText(/Unknown tool/)).toBeVisible();
  await expect
    .element(result)
    .toHaveTextContent("Reply: The 6th to the 8th is free at 120 EUR a night.");
  await expect.element(result).toHaveTextContent("The model answered with text");
});

test("a model that keeps calling tools stops at the round cap with the fallback", async () => {
  const { screen, run, script, cap, result } = await setup();

  await script.selectOptions("Keeps calling tools");
  await cap.fill("4");
  await run.click();

  await expect.element(screen.getByText("Ended after 4 rounds")).toBeVisible();
  await expect.element(result).toHaveTextContent("Reply: Sorry, I could not process that.");
  await expect.element(result).toHaveTextContent("The round cap fired on a tool message");
  await expect.element(screen.getByText("Round 4")).toBeVisible();
  expect(screen.getByText("Round 5").query()).toBeNull();
});

test("an empty reply becomes the fallback text", async () => {
  const { screen, run, script, result } = await setup();

  await script.selectOptions("Returns an empty reply");
  await run.click();

  await expect.element(screen.getByText("Ended after 2 rounds")).toBeVisible();
  await expect.element(result).toHaveTextContent("Reply: Sorry, I could not process that.");
  await expect.element(result).toHaveTextContent("returned no text and no tool calls");
});

test("a cap of one ends the answering script on its first tool message", async () => {
  const { screen, run, cap, result } = await setup();

  await cap.fill("1");
  await run.click();

  await expect.element(screen.getByText("Ended after 1 rounds")).toBeVisible();
  await expect.element(result).toHaveTextContent("The round cap fired");
});
