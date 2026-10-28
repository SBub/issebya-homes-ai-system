import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SseProgressDemo } from "./SseProgressDemo";

/** Records every instance so a test can drive the stream by hand. */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.OPEN;
  readonly close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  emit(type: string, data: unknown, lastEventId = "") {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data), lastEventId }));
  }
}

const latest = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const screen = await render(<SseProgressDemo />);
  const runButton = screen.getByRole("button", { name: "Run demo" });
  const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
  const bar = screen.getByRole("progressbar", { name: "Demo progress" });
  // Dispatched outside React, like a real EventSource; `expect.element`
  // retries until React has rendered the update.
  const emit = (type: string, data: unknown, id?: string) => latest().emit(type, data, id);
  return { screen, runButton, disconnectButton, bar, emit };
}

test("Run demo opens /api/demo/progress with no resume id", async () => {
  const { runButton, disconnectButton } = await setup();

  await runButton.click();

  expect(FakeEventSource.instances).toHaveLength(1);
  expect(latest().url).toBe("/api/demo/progress");
  await expect.element(runButton).toBeDisabled();
  await expect.element(disconnectButton).toBeEnabled();
});

test("a progress event moves the bar and lists the event with its id", async () => {
  const { screen, runButton, bar, emit } = await setup();

  await runButton.click();
  emit("progress", { percent: 30, step: "Checking dates" }, "2");

  await expect.element(bar).toHaveAttribute("aria-valuenow", "30");
  await expect.element(screen.getByText("id 2: 30%, Checking dates")).toBeVisible();
});

test("done closes the source and shows the finished state", async () => {
  const { screen, runButton, emit } = await setup();

  await runButton.click();
  emit("progress", { percent: 100, step: "Confirmed" }, "5");
  emit("done", { lastId: 5 });

  expect(latest().close).toHaveBeenCalled();
  await expect.element(screen.getByText(/^Done\./)).toBeVisible();
  await expect.element(runButton).toBeEnabled();
});

test("Disconnect closes the source; Run demo again resumes after the last id", async () => {
  const { screen, runButton, disconnectButton, emit } = await setup();

  await runButton.click();
  emit("progress", { percent: 10, step: "Request received" }, "1");
  emit("progress", { percent: 30, step: "Checking dates" }, "2");
  const first = latest();

  await disconnectButton.click();
  expect(first.close).toHaveBeenCalled();
  await expect.element(screen.getByText(/^Disconnected\./)).toBeVisible();

  await runButton.click();

  expect(FakeEventSource.instances).toHaveLength(2);
  expect(latest().url).toBe("/api/demo/progress?lastEventId=2");
  await expect.element(screen.getByText("id 1: 10%, Request received")).toBeVisible();
  await expect.element(screen.getByText("Resumed after id 2")).toBeVisible();
});

test("after done, Run demo starts from scratch", async () => {
  const { screen, runButton, bar, emit } = await setup();

  await runButton.click();
  emit("progress", { percent: 100, step: "Confirmed" }, "5");
  emit("done", { lastId: 5 });

  await runButton.click();

  expect(latest().url).toBe("/api/demo/progress");
  await expect.element(bar).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByText("id 5: 100%, Confirmed").query()).toBeNull();
});

test("an error while reconnecting keeps running; an error after CLOSED shows the failure", async () => {
  const { screen, runButton, emit } = await setup();

  await runButton.click();
  latest().readyState = FakeEventSource.CONNECTING;
  emit("error", null);
  await expect.element(screen.getByText("Streaming.")).toBeVisible();

  latest().readyState = FakeEventSource.CLOSED;
  emit("error", null);
  await expect.element(screen.getByText(/gave up/)).toBeVisible();
});

test("unmount closes the source", async () => {
  const { screen, runButton } = await setup();

  await runButton.click();
  await screen.unmount();

  expect(latest().close).toHaveBeenCalled();
});
