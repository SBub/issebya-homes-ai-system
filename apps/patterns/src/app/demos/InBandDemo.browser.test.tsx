import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { InBandDemo } from "./InBandDemo";

async function setup() {
  const screen = await render(<InBandDemo />);
  return {
    screen,
    newRequest: screen.getByRole("button", { name: "New request" }),
    sendReply: screen.getByRole("button", { name: "Send reply" }),
    replyTo: screen.getByRole("combobox", { name: "Reply to" }),
    replyText: screen.getByRole("textbox", { name: "Reply text" }),
    latest: screen.getByRole("checkbox", { name: /latest question/ }),
    chat: screen.getByLabelText("Chat").getByRole("listitem"),
    runs: screen.getByLabelText("Requests").getByRole("listitem"),
    relay: screen.getByLabelText("Relay log").getByRole("listitem"),
  };
}

test("the question carries the id in a ref tag and a reply to it resumes the run", async () => {
  const { screen, newRequest, sendReply, chat, runs, relay } = await setup();
  await newRequest.click();

  await expect.element(chat.nth(0)).toHaveTextContent("[ref:req_1]");
  await expect
    .element(runs.nth(0))
    .toHaveTextContent("waiting for request.answered where data.id is req_1");

  await sendReply.click();

  await expect
    .element(relay.nth(0))
    .toHaveTextContent(
      "reply to #1: parsed id req_1, sent request.answered, resumed the run waiting on req_1",
    );
  await expect
    .element(chat.nth(1))
    .toHaveTextContent("#2 approver (reply to #1): Yes, until 23:00.");
  await expect.element(chat.nth(2)).toHaveTextContent('The answer is "Yes, until 23:00."');
  await expect
    .element(screen.getByRole("button", { name: "Approve (approve:req_1)" }))
    .toBeVisible();
  await expect
    .element(runs.nth(0))
    .toHaveTextContent("waiting for request.decided where data.id is req_1");
});

test("a tap carries the id in the button data and finishes the run; a second tap is ignored", async () => {
  const { screen, newRequest, sendReply, runs, relay } = await setup();
  await newRequest.click();
  await sendReply.click();
  await screen.getByRole("button", { name: "Approve (approve:req_1)" }).click();

  await expect
    .element(relay.nth(1))
    .toHaveTextContent(
      "tap approve:req_1: parsed id req_1, sent request.decided, resumed the run waiting on req_1",
    );
  await expect
    .element(runs.nth(0))
    .toHaveTextContent('done: {"answer":"Yes, until 23:00.","approved":true}');

  await screen.getByRole("button", { name: "Reject (reject:req_1)" }).click();
  await expect.element(relay.nth(2)).toHaveTextContent("no run is waiting on req_1: ignored");
  await expect.element(runs.nth(0)).toHaveTextContent('"approved":true');
});

test("a second reply to the same question is ignored", async () => {
  const { newRequest, sendReply, replyTo, relay, runs } = await setup();
  await newRequest.click();
  await sendReply.click();
  await replyTo.selectOptions("1");
  await sendReply.click();

  await expect
    .element(relay.nth(1))
    .toHaveTextContent(
      "reply to #1: parsed id req_1, sent request.answered, no run is waiting on req_1: ignored",
    );
  await expect.element(runs.nth(0)).toHaveTextContent("waiting for request.decided");
});

test("with two requests pending, the id in the message resumes the right run and the latest-question lookup the wrong one", async () => {
  const { newRequest, sendReply, replyTo, latest, relay, runs } = await setup();
  await newRequest.click();
  await newRequest.click();
  await replyTo.selectOptions("1");
  await sendReply.click();

  await expect.element(relay.nth(0)).toHaveTextContent("reply to #1: parsed id req_1");
  await expect.element(runs.nth(0)).toHaveTextContent("waiting for request.decided");
  await expect
    .element(runs.nth(1))
    .toHaveTextContent("waiting for request.answered where data.id is req_2");

  await latest.click();
  await newRequest.click();
  await replyTo.selectOptions("2");
  await sendReply.click();

  await expect
    .element(relay.nth(1))
    .toHaveTextContent(
      "reply to #2: parsed id req_3, sent request.answered, resumed the run waiting on req_3",
    );
  await expect
    .element(runs.nth(1))
    .toHaveTextContent("waiting for request.answered where data.id is req_2");
  await expect.element(runs.nth(2)).toHaveTextContent("waiting for request.decided");
});
