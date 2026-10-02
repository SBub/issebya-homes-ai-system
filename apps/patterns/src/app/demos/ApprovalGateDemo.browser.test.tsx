import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ApprovalGateDemo } from "./ApprovalGateDemo";

const SLOW = 5000;

async function setup(timeoutMs = 20000) {
  const screen = await render(<ApprovalGateDemo timeoutMs={timeoutMs} />);
  return {
    screen,
    start: screen.getByRole("button", { name: "Start" }),
    approve: screen.getByRole("button", { name: "Approve" }),
    reject: screen.getByRole("button", { name: "Reject" }),
    replay: screen.getByRole("button", { name: "Replay" }),
    unstepped: screen.getByRole("checkbox", { name: /outside a step/ }),
    log: screen.getByLabelText("Runner log").getByRole("listitem"),
    notifications: screen.getByLabelText("Notifications").getByRole("listitem"),
    memo: screen.getByLabelText("Memoized steps").getByRole("listitem"),
    result: screen.getByLabelText("Result"),
  };
}

test("Start nudges once in its own step and suspends on the wait", async () => {
  const { screen, start, approve, notifications, memo } = await setup();

  await expect.element(approve).toBeDisabled();
  await start.click();

  await expect.element(screen.getByText(/Suspended on wait-for-decision/)).toBeVisible();
  await expect
    .element(screen.getByText(/Waiting for/))
    .toHaveTextContent(
      "Waiting for request.decided where data.requestId is req_1, for up to 20 s.",
    );
  await expect
    .element(notifications.nth(0))
    .toHaveTextContent('Approve "send the link for the 6th to the 8th"? (req_1)');
  expect(notifications.elements()).toHaveLength(1);
  await expect.element(memo.nth(0)).toHaveTextContent("notify-approver = true");
  await expect.element(approve).toBeEnabled();
});

test("Replay runs the function again, skips the memoized step and does not nudge twice", async () => {
  const { screen, start, replay, log, notifications } = await setup();

  await start.click();
  await replay.click();

  await expect.element(screen.getByText(/invocation 2 \(replay\)/)).toBeVisible();
  await expect
    .element(screen.getByText("step notify-approver: memoized, callback skipped"))
    .toBeVisible();
  expect(notifications.elements()).toHaveLength(1);
  await expect.element(screen.getByText(/Suspended on wait-for-decision/)).toBeVisible();
  expect(log.elements().length).toBeGreaterThanOrEqual(5);
});

test("Approve sends the event, the wait resumes and the send step runs", async () => {
  const { screen, start, approve, memo, result } = await setup();

  await start.click();
  await approve.click();

  await expect.element(screen.getByText("Done.")).toBeVisible();
  await expect.element(screen.getByText("event request.decided: matched")).toBeVisible();
  await expect.element(screen.getByText("step send-link: ran, result memoized")).toBeVisible();
  await expect.element(result).toHaveTextContent('"url":"/requests/req_1/link"');
  expect(memo.elements()).toHaveLength(3);
});

test("Reject resumes with the soft not-approved result and never runs the send step", async () => {
  const { screen, start, reject, result } = await setup();

  await start.click();
  await reject.click();

  await expect.element(screen.getByText("Done.")).toBeVisible();
  await expect.element(result).toHaveTextContent("This action was not approved.");
  expect(screen.getByText("step send-link: ran, result memoized").query()).toBeNull();
});

test("a timeout resumes the wait with null and gives the same soft result", async () => {
  const { screen, start, result } = await setup(300);

  await start.click();

  await expect.element(screen.getByText("Done."), { timeout: SLOW }).toBeVisible();
  await expect.element(screen.getByText(/timed out, resumes with null/)).toBeVisible();
  await expect.element(screen.getByText(/invocation 2 \(timeout\)/)).toBeVisible();
  await expect.element(result).toHaveTextContent("This action was not approved.");
});

test("a replay after Done answers every step from the memo", async () => {
  const { screen, start, approve, replay, log } = await setup();

  await start.click();
  await approve.click();
  await replay.click();

  await expect.element(screen.getByText(/invocation 3 \(replay\)/)).toBeVisible();
  // Once from the event invocation, once more from the replay.
  const memoizedWait = screen.getByText("wait wait-for-decision: memoized, returns at once");
  await expect.element(memoizedWait.nth(1)).toBeVisible();
  expect(memoizedWait.elements()).toHaveLength(2);
  await expect
    .element(screen.getByText("step send-link: memoized, callback skipped"))
    .toBeVisible();
  expect(log.elements().length).toBeGreaterThan(8);
});

test("the unstepped nudge goes out again on every replay", async () => {
  const { start, replay, unstepped, notifications } = await setup();

  await unstepped.click();
  await start.click();
  await replay.click();

  await expect.element(notifications.nth(1)).toBeVisible();
  expect(notifications.elements()).toHaveLength(2);
});
