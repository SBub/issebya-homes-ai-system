import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryFoldDemo } from "./MemoryFoldDemo";

const SLOW = 5000;

async function setup() {
  const screen = await render(<MemoryFoldDemo />);
  const send = screen.getByRole("button", { name: "Send a turn" });
  const sent = screen.getByLabelText("Sent turns").getByRole("listitem");
  const sendTurns = async (count: number) => {
    for (let turn = 1; turn <= count; turn++) {
      await send.click();
      await expect
        .element(sent.nth(turn - 1), { timeout: SLOW })
        .toHaveTextContent(`turn ${turn}:`);
      await expect.element(send, { timeout: SLOW }).toBeEnabled();
    }
  };
  return {
    screen,
    sendTurns,
    beforeSend: screen.getByRole("checkbox", { name: /before the send/ }),
    noWatermark: screen.getByRole("checkbox", { name: /No watermark/ }),
    keepAll: screen.getByRole("checkbox", { name: /every fold/ }),
    rows: screen.getByLabelText("Rows"),
    sent,
    folds: screen.getByLabelText("Fold log"),
    memory: screen.getByLabelText("Memory message"),
  };
}

test("the third turn folds the first, after the send, and the watermark moves to the last folded row", async () => {
  const { sendTurns, sent, rows, folds, memory } = await setup();
  await sendTurns(3);

  await expect
    .element(folds)
    .toHaveTextContent(
      "fold 1, rows 1 to 2: user: Is the 6th to the 8th free? | assistant: Yes, those dates are free.",
    );
  await expect.element(folds).toHaveTextContent("watermark now 2");
  await expect.element(rows).toHaveTextContent("watermark row 2");
  await expect.element(rows).toHaveTextContent("#2 assistant: Yes, those dates are free. (folded)");
  await expect
    .element(memory)
    .toHaveTextContent(
      "assistant: Summary of earlier conversation: user: Is the 6th to the 8th free?",
    );
  await expect.element(sent.nth(2)).toHaveTextContent(/reply sent after \d{1,2} ms/);
});

test("the fourth turn injects the fold first, then distils it into the preferences when the next fold lands", async () => {
  const { sendTurns, sent, folds, memory } = await setup();
  await sendTurns(4);

  await expect
    .element(sent.nth(3))
    .toHaveTextContent("turn 4: the model saw 4 messages (memory first)");
  await expect
    .element(folds)
    .toHaveTextContent("fold 1 distilled into the preferences and deleted");
  await expect.element(folds).toHaveTextContent("preferences: Is the 6th to the 8th free?");
  await expect.element(folds).toHaveTextContent("(1 kept)");
  await expect
    .element(memory)
    .toHaveTextContent(
      "Preferences: Is the 6th to the 8th free? Summary of earlier conversation: user: I prefer the quiet room at the back.",
    );
});

test("folding before the send makes the reply wait for the summariser", async () => {
  const { sendTurns, sent, beforeSend } = await setup();
  await beforeSend.click();
  await sendTurns(3);

  await expect.element(sent.nth(2)).toHaveTextContent(/reply sent after [3-9]\d\d ms/);
});

test("without the watermark the same rows fold again", async () => {
  const { sendTurns, noWatermark, folds } = await setup();
  await noWatermark.click();
  await sendTurns(4);

  await expect
    .element(folds)
    .toHaveTextContent("fold 1: rows 1 to 2 summarised, watermark not advanced");
  await expect.element(folds).toHaveTextContent("fold 2: rows 1 to 4 summarised");
});

test("keeping every fold injects every fold and distils nothing", async () => {
  const { sendTurns, keepAll, folds, memory } = await setup();
  await keepAll.click();
  await sendTurns(5);

  await expect.element(folds).toHaveTextContent("(3 kept)");
  await expect.element(folds).toHaveTextContent("preferences: none");
  expect(
    (memory.element().textContent ?? "").split("Summary of earlier conversation:"),
  ).toHaveLength(4);
});
