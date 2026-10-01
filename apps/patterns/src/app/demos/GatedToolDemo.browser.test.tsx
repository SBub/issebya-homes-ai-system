import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { GatedToolDemo } from "./GatedToolDemo";

async function setup() {
  const screen = await render(<GatedToolDemo />);
  return {
    screen,
    call: screen.getByRole("button", { name: "Model calls send_link", exact: true }),
    past: screen.getByRole("button", { name: "Model calls send_link with past dates" }),
    approve: screen.getByRole("button", { name: "Approve" }),
    reject: screen.getByRole("button", { name: "Reject" }),
    replay: screen.getByRole("button", { name: "Replay" }),
    chat: screen.getByLabelText("Chat"),
    result: screen.getByLabelText("Tool result"),
    tree: screen.getByLabelText("Span tree"),
    log: screen.getByLabelText("Runner log").getByRole("listitem"),
  };
}

function lines(tree: { element(): Element }) {
  return Array.from(tree.element().querySelectorAll("li")).map(
    (li) =>
      (li.firstChild?.textContent ?? "") + (li.querySelector(":scope > span")?.textContent ?? ""),
  );
}

test("the call re-checks, records the anchor, nudges with the id in the buttons, and pauses", async () => {
  const { screen, call, chat, tree, approve } = await setup();
  await call.click();

  await expect.element(screen.getByText(/Suspended on wait-for-decision/)).toBeVisible();
  await expect.element(screen.getByText(/1 anchor row\./)).toBeVisible();
  await expect
    .element(chat)
    .toHaveTextContent("Send the link for 2026-10-06 to 2026-10-08 to ana@example.com? Approve?");
  await expect.element(approve).toBeVisible();
  expect(lines(tree)).toEqual([
    "root message.received",
    "child gate-send_link",
    "child nudge-approver",
  ]);
});

test("Approve resumes the run: the decision nests under the gate and the run half gives the URL", async () => {
  const { screen, call, approve, chat, result, tree } = await setup();
  await call.click();
  await approve.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect
    .element(chat)
    .toHaveTextContent("decision nested under the gate span, resumed the run");
  await expect
    .element(result)
    .toHaveTextContent('{"url":"/book?from=2026-10-06&to=2026-10-08&email=ana%40example.com"}');
  expect(lines(tree)).toEqual([
    "root message.received",
    "child gate-send_link",
    "child nudge-approver",
    "child decision",
    "child gate-decision",
    "child tool-send_link",
  ]);
  await expect.element(screen.getByText(/0 anchor rows\./)).toBeVisible();
});

test("Reject gives the model the not-approved object; a second tap is its own root and resumes nothing", async () => {
  const { screen, call, reject, approve, chat, result, tree } = await setup();
  await call.click();
  await reject.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect
    .element(result)
    .toHaveTextContent('{"approved":false,"message":"This action was not approved.');
  expect(lines(tree)).not.toContain("child tool-send_link");

  await approve.click();
  await expect
    .element(chat)
    .toHaveTextContent("no anchor row, decision is its own root, resumed nothing");
  expect(lines(tree)).toContain("root decision");
});

test("past dates are refused before anyone is nudged", async () => {
  const { screen, past, chat, result, tree } = await setup();
  await past.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect.element(chat).toHaveTextContent("Nothing sent.");
  await expect.element(result).toHaveTextContent('"reason":"past_date"');
  expect(lines(tree)).toEqual(["root message.received", "child gate-send_link"]);
});

test("Replay repeats nothing", async () => {
  const { screen, call, approve, replay, tree, log } = await setup();
  await call.click();
  await approve.click();
  await replay.click();

  await expect.element(screen.getByText(/invocation 3 \(replay\)/)).toBeVisible();
  expect(lines(tree)).toHaveLength(6);
  expect(log.elements().filter((li) => li.textContent?.includes(": ran")).length).toBe(6);
});
