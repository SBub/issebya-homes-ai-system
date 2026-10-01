import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { TraceAnchorDemo } from "./TraceAnchorDemo";

async function setup() {
  const screen = await render(<TraceAnchorDemo />);
  return {
    screen,
    start: screen.getByRole("button", { name: "Start" }),
    approve: screen.getByRole("button", { name: "Approve" }),
    replay: screen.getByRole("button", { name: "Replay" }),
    ambient: screen.getByRole("checkbox", { name: /ambient context/ }),
    reusable: screen.getByRole("checkbox", { name: /Keep the anchor row/ }),
    tree: screen.getByLabelText("Span tree"),
    decisions: screen.getByLabelText("Decisions").getByRole("listitem"),
  };
}

/** The nesting as text: "root name" and "child name" lines, in order. */
function lines(tree: { element(): Element }) {
  return Array.from(tree.element().querySelectorAll("li")).map(
    (li) =>
      (li.firstChild?.textContent ?? "") + (li.querySelector(":scope > span")?.textContent ?? ""),
  );
}

test("Start opens the root in the route and every step nests under its anchor", async () => {
  const { screen, start, tree } = await setup();
  await start.click();

  await expect.element(screen.getByText(/Suspended on wait-for-decision/)).toBeVisible();
  await expect.element(screen.getByText(/3 spans, 1 anchor row\./)).toBeVisible();
  expect(lines(tree)).toEqual(["root request.received", "child prepare", "child request-approval"]);
});

test("Approve nests the decision under the gate span and the send step under the root, one trace", async () => {
  const { screen, start, approve, tree, decisions } = await setup();
  await start.click();
  await approve.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect
    .element(decisions.nth(0))
    .toHaveTextContent("decision 1: nested under the gate span, resumed the run");
  expect(lines(tree)).toEqual([
    "root request.received",
    "child prepare",
    "child request-approval",
    "child decision",
    "child send-link",
  ]);
  await expect.element(screen.getByText(/5 spans, 0 anchor rows\./)).toBeVisible();
});

test("Replay re-emits no span", async () => {
  const { screen, start, approve, replay } = await setup();
  await start.click();
  await approve.click();
  await replay.click();

  await expect.element(screen.getByText(/invocation 3 \(replay\)/)).toBeVisible();
  await expect.element(screen.getByText(/5 spans, 0 anchor rows\./)).toBeVisible();
});

test("a second Approve finds no anchor row: its own root, resumes nothing", async () => {
  const { screen, start, approve, tree, decisions } = await setup();
  await start.click();
  await approve.click();
  await approve.click();

  await expect
    .element(decisions.nth(1))
    .toHaveTextContent("decision 2: no anchor row, its own root, resumed nothing");
  expect(lines(tree).filter((line) => line.startsWith("root"))).toEqual([
    "root request.received",
    "root decision",
  ]);
  await expect.element(screen.getByText(/6 spans, 0 anchor rows\./)).toBeVisible();
});

test("a reusable row nests a stray second decision under the finished gate and stays", async () => {
  const { screen, start, approve, reusable, tree } = await setup();
  await reusable.click();
  await start.click();
  await approve.click();
  await approve.click();

  await expect.element(screen.getByText(/6 spans, 1 anchor row\./)).toBeVisible();
  expect(lines(tree).filter((line) => line === "child decision")).toHaveLength(2);
  expect(lines(tree).filter((line) => line.startsWith("root"))).toHaveLength(1);
});

test("on ambient context the trace splits into two roots at the pause", async () => {
  const { screen, start, approve, ambient, tree } = await setup();
  await ambient.click();
  await start.click();
  await approve.click();

  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  const all = lines(tree);
  expect(all.filter((line) => line === "root request")).toHaveLength(2);
  // Before the pause under the first root, after it under the second.
  expect(all.indexOf("child send-link")).toBeGreaterThan(all.lastIndexOf("root request"));
});
