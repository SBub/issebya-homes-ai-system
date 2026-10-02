import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { HistoryDemo } from "./HistoryDemo";

async function setup() {
  const screen = await render(<HistoryDemo />);
  return {
    screen,
    addTurn: screen.getByRole("button", { name: "Add a turn" }),
    verbatim: screen.getByRole("spinbutton", { name: "Verbatim turns" }),
    budget: screen.getByRole("slider", { name: "Token budget" }),
    rows: screen.getByLabelText("Stored rows").getByRole("listitem"),
    turns: screen.getByText(/^Turn \d+: /),
    seen: screen.getByLabelText("What the model sees"),
  };
}

/** Sets a range input the way a drag would, through React's own value setter. */
function slide(slider: { element: () => Element }, value: number) {
  const input = slider.element() as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("four stored turns: the last three replay verbatim, the first as text, nothing dropped", async () => {
  const { screen, rows, seen } = await setup();

  expect(rows.elements()).toHaveLength(8);
  await expect.element(rows.nth(1)).toHaveTextContent("3 turn messages");
  await expect.element(seen).toHaveTextContent("Nothing dropped.");
  await expect.element(screen.getByText("Turn 1: text, 2 messages")).toBeVisible();
  await expect.element(screen.getByText("Turn 2: verbatim, 4 messages")).toBeVisible();
  await expect.element(screen.getByText("Turn 4: verbatim, 4 messages")).toBeVisible();
  await expect.element(screen.getByText(/tool: check_dates -> /).first()).toBeVisible();
});

test("a smaller budget drops whole turns from the oldest and never the last", async () => {
  const { screen, budget, turns, seen } = await setup();

  slide(budget, 50);

  await expect.element(seen).toHaveTextContent("Dropped the 3 oldest turns, whole.");
  await expect.element(screen.getByText("Turn 4: verbatim, 4 messages")).toBeVisible();
  expect(turns.elements()).toHaveLength(1);
});

test("verbatim turns controls how many groups replay their tool messages", async () => {
  const { screen, verbatim } = await setup();

  await verbatim.fill("1");

  await expect.element(screen.getByText("Turn 3: text, 2 messages")).toBeVisible();
  await expect.element(screen.getByText("Turn 4: verbatim, 4 messages")).toBeVisible();
  expect(screen.getByText("Turn 2: verbatim, 4 messages").query()).toBeNull();
});

test("Add a turn stores a user row and an assistant row with its turn messages", async () => {
  const { screen, addTurn, rows } = await setup();

  await addTurn.click();

  expect(rows.elements()).toHaveLength(10);
  await expect.element(rows.nth(8)).toHaveTextContent("#9 user: Can I bring a dog?");
  await expect.element(rows.nth(9)).toHaveTextContent("3 turn messages");
  await expect.element(screen.getByText("Turn 5: verbatim, 4 messages")).toBeVisible();
  await expect.element(screen.getByText("Turn 2: text, 2 messages")).toBeVisible();
});
