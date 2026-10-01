import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryWindowDemo } from "./MemoryWindowDemo";

async function setup() {
  const screen = await render(<MemoryWindowDemo />);
  const send = screen.getByRole("button", { name: "Send a turn" });
  let sentSoFar = 0;
  const sendTurns = async (upTo: number) => {
    while (sentSoFar < upTo) {
      sentSoFar += 1;
      await send.click();
      await expect
        .element(screen.getByText(`What the model saw on turn ${sentSoFar}`))
        .toBeVisible();
    }
  };
  return {
    screen,
    sendTurns,
    saw: screen.getByLabelText("What the model saw"),
    turns: screen.getByLabelText("Messages").getByText(/^Turn (verbatim|as text)/),
    after: screen.getByLabelText("After the send"),
    rows: screen.getByLabelText("Stored rows"),
  };
}

test("on turn three the first turn replays as text and the last two verbatim, with no memory yet", async () => {
  const { screen, sendTurns, saw, turns, after } = await setup();
  await sendTurns(3);

  await expect.element(saw).toHaveTextContent("7 messages");
  await expect.element(screen.getByText("Turn as text, 2 messages")).toBeVisible();
  expect(turns.elements().map((element) => element.textContent)).toEqual([
    "Turn as text, 2 messages",
    "Turn verbatim, 4 messages",
    "Turn as text, 1 messages",
  ]);
  await expect.element(after).toHaveTextContent("turn 3: nothing fell out of the window");
  await expect.element(after).toHaveTextContent("watermark none");
});

test("the fourth send folds the first three turns, the fifth turn gets them as one memory message, the seventh distils", async () => {
  const { screen, sendTurns, saw, after, rows, turns } = await setup();
  await sendTurns(4);

  await expect.element(after).toHaveTextContent("turn 4: rows 1 to 6 became fold 1");
  await expect.element(after).toHaveTextContent("watermark row 6, 1 fold kept");
  await expect.element(rows).toHaveTextContent("#6 assistant: 95 EUR a night. (folded)");

  await sendTurns(5);

  await expect
    .element(saw)
    .toHaveTextContent(
      "Memory, one assistant message: Summary of earlier conversation: user: Is the 6th to the 8th free?",
    );
  expect(turns.elements().map((element) => element.textContent)).toEqual([
    "Turn verbatim, 4 messages",
    "Turn as text, 1 messages",
  ]);
  await expect.element(after).toHaveTextContent("turn 5: nothing fell out of the window");

  await sendTurns(7);

  expect(turns.elements().map((element) => element.textContent)).toEqual([
    "Turn as text, 2 messages",
    "Turn as text, 2 messages",
    "Turn verbatim, 4 messages",
    "Turn as text, 1 messages",
  ]);
  await expect.element(after).toHaveTextContent("turn 7: rows 7 to 12 became fold 2");
  await expect
    .element(after)
    .toHaveTextContent(
      "preferences: Is the 6th to the 8th free?; I prefer the quiet room at the back.; How much per night?",
    );
  await expect.element(after).toHaveTextContent("next memory message: Preferences:");
  await expect.element(screen.getByText("watermark row 12, 1 fold kept")).toBeVisible();
});
