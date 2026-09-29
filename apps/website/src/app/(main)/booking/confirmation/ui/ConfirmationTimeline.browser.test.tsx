import posthog from "posthog-js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { BookingStepRow } from "@/lib/bookings/steps";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { ConfirmationTimeline, STEP_LABELS, TIMEOUT_COPY } from "./ConfirmationTimeline";

// Stands in for the browser's EventSource: records every instance so a test
// can play the server's side with `emit` and check `close`.
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, event: Event = new MessageEvent(name, { data: "{}" })) {
    this.dispatchEvent(event);
  }
}

const TOKEN = "a".repeat(64);
const AT = "2026-09-29T10:00:00.000Z";

const confirmed: BookingStepRow = {
  status: "confirmed",
  confirmed_at: AT,
  guest_email_sent_at: null,
  owner_email_sent_at: null,
};

const lines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="confirmation-timeline"] li')).map(
    (li) => li.textContent,
  );

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("renders the seeded steps and opens one stream for the token", async () => {
  const { getByText, container } = await render(
    <ConfirmationTimeline token={TOKEN} email="guest@example.com" initial={confirmed} />,
  );

  await expect.element(getByText(STEP_LABELS.confirmed)).toBeVisible();
  expect(lines(container)).toEqual([STEP_LABELS.payment_received, STEP_LABELS.confirmed]);
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(FakeEventSource.instances[0].url).toBe(`/api/bookings/${TOKEN}/events`);
});

test("appends streamed steps in order, closes on done and reports once", async () => {
  const { getByText, container } = await render(
    <ConfirmationTimeline token={TOKEN} email="guest@example.com" initial={confirmed} />,
  );
  const source = FakeEventSource.instances[0];

  source.emit("guest_email_sent");
  source.emit("owner_email_sent");
  source.emit("done");
  source.emit("done");

  await expect.element(getByText(STEP_LABELS.owner_email_sent)).toBeVisible();
  expect(lines(container)).toEqual([
    STEP_LABELS.payment_received,
    STEP_LABELS.confirmed,
    "Confirmation sent to guest@example.com",
    STEP_LABELS.owner_email_sent,
  ]);
  expect(source.closed).toBe(true);
  expect(posthog.capture).toHaveBeenCalledOnce();
  expect(posthog.capture).toHaveBeenCalledWith("booking_confirmation_stream_completed", {
    steps: 4,
    seconds: expect.any(Number),
  });
});

test("does not duplicate a step the server re-sends", async () => {
  const { getByText, container } = await render(
    <ConfirmationTimeline token={TOKEN} email="guest@example.com" initial={confirmed} />,
  );
  const source = FakeEventSource.instances[0];

  source.emit("confirmed");
  source.emit("guest_email_sent");

  await expect.element(getByText("Confirmation sent to guest@example.com")).toBeVisible();
  expect(lines(container)).toEqual([
    STEP_LABELS.payment_received,
    STEP_LABELS.confirmed,
    "Confirmation sent to guest@example.com",
  ]);
});

test("shows the timeout sentence and closes on timeout", async () => {
  const { getByText } = await render(
    <ConfirmationTimeline token={TOKEN} email="guest@example.com" initial={confirmed} />,
  );
  const source = FakeEventSource.instances[0];

  source.emit("timeout");

  await expect.element(getByText(TIMEOUT_COPY)).toBeVisible();
  expect(source.closed).toBe(true);
});

test("closes on the server's error event but not on a plain connection error", async () => {
  await render(
    <ConfirmationTimeline token={TOKEN} email="guest@example.com" initial={confirmed} />,
  );
  const source = FakeEventSource.instances[0];

  source.emit("error", new Event("error"));
  expect(source.closed).toBe(false);

  source.emit("error", new MessageEvent("error", { data: '{"message":"x"}' }));
  expect(source.closed).toBe(true);
});

test("renders a finished booking statically without opening a stream", async () => {
  const { getByText, container } = await render(
    <ConfirmationTimeline
      token={TOKEN}
      email="guest@example.com"
      initial={{ ...confirmed, guest_email_sent_at: AT, owner_email_sent_at: AT }}
    />,
  );

  await expect.element(getByText(STEP_LABELS.owner_email_sent)).toBeVisible();
  expect(lines(container)).toHaveLength(4);
  expect(FakeEventSource.instances).toHaveLength(0);
  expect(posthog.capture).not.toHaveBeenCalled();
});

test("renders statically without a token", async () => {
  const { getByText } = await render(
    <ConfirmationTimeline token={null} email={null} initial={confirmed} />,
  );

  await expect.element(getByText(STEP_LABELS.confirmed)).toBeVisible();
  expect(FakeEventSource.instances).toHaveLength(0);
});

test("closes the stream on unmount", async () => {
  const { unmount } = await render(
    <ConfirmationTimeline token={TOKEN} email="guest@example.com" initial={confirmed} />,
  );
  const source = FakeEventSource.instances[0];

  await unmount();

  expect(source.closed).toBe(true);
});
