import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DurableTurnDemo } from "./DurableTurnDemo";

async function setup() {
  const screen = await render(<DurableTurnDemo />);
  return {
    screen,
    receive: screen.getByRole("button", { name: "Receive message" }),
    approve: screen.getByRole("button", { name: "Approve" }),
    reject: screen.getByRole("button", { name: "Reject" }),
    replay: screen.getByRole("button", { name: "Replay" }),
    retry: screen.getByRole("button", { name: "Retry the reply write" }),
    tree: screen.getByLabelText("Span tree"),
    rows: screen.getByLabelText("Messages table").getByRole("listitem"),
    notifications: screen.getByLabelText("Notifications").getByRole("listitem"),
  };
}

function lines(tree: { element(): Element }) {
  return Array.from(tree.element().querySelectorAll("li")).map(
    (li) =>
      (li.firstChild?.textContent ?? "") + (li.querySelector(":scope > span")?.textContent ?? ""),
  );
}

test("Receive runs the loop in stepped spans until the gated tool pauses it", async () => {
  const { screen, receive, tree, rows, notifications } = await setup();
  await receive.click();

  await expect.element(screen.getByText(/Suspended on wait-for-decision/)).toBeVisible();
  await expect
    .element(notifications.nth(0))
    .toHaveTextContent(/Approve sending the link\? \(corr_/);
  expect(rows.elements()).toHaveLength(1);
  expect(lines(tree)).toEqual([
    "root message.received",
    "child record-inbound",
    "child turn",
    "child load-history",
    "child model-1",
    "child tool-call_1",
    "child model-2",
    "child notify-approver",
  ]);
});

test("Approve resumes the turn: one reply row keyed by the trace, sent once, one trace", async () => {
  const { screen, receive, approve, tree, rows, notifications } = await setup();
  await receive.click();
  await approve.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect
    .element(rows.nth(1))
    .toHaveTextContent("assistant: The 6th to the 8th is free. The link is on its way.");
  expect(rows.elements()).toHaveLength(2);
  await expect.element(notifications.nth(1)).toHaveTextContent(/Reply to conversation-1:/);
  expect(lines(tree)).toEqual([
    "root message.received",
    "child record-inbound",
    "child turn",
    "child load-history",
    "child model-1",
    "child tool-call_1",
    "child model-2",
    "child notify-approver",
    "child decision",
    "child send-link",
    "child model-3",
    "child record-reply",
    "child send-reply",
  ]);
});

test("Replay repeats nothing: no new span, row or notification", async () => {
  const { screen, receive, approve, replay, tree, rows, notifications } = await setup();
  await receive.click();
  await approve.click();
  await replay.click();

  await expect.element(screen.getByText(/invocation 3 \(replay\)/)).toBeVisible();
  expect(lines(tree)).toHaveLength(13);
  expect(rows.elements()).toHaveLength(2);
  expect(notifications.elements()).toHaveLength(2);
});

test("a retried reply write returns the existing row", async () => {
  const { screen, receive, approve, retry, rows } = await setup();
  await receive.click();
  await approve.click();
  await retry.click();

  await expect
    .element(screen.getByText("retry 1: conflict on the trace id, existing row 2 returned"))
    .toBeVisible();
  expect(rows.elements()).toHaveLength(3);
  await expect.element(screen.getByText(/\(2 rows\)/)).toBeVisible();
});

test("Reject gives the model the not-approved result and the turn still replies", async () => {
  const { screen, receive, reject, tree, rows } = await setup();
  await receive.click();
  await reject.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  expect(lines(tree)).not.toContain("child send-link");
  expect(rows.elements()).toHaveLength(2);
});
