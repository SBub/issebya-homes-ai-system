import { Component, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { BOOKING_UNAVAILABLE_COPY } from "@/lib/shared/booking-copy";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

// The real @sentry/nextjs cannot load in the browser runner (it reaches for
// `process`). This stand-in keeps the one contract the wrapper relies on:
// catch a render error in the subtree and show `fallback` instead.
vi.mock("@sentry/nextjs", () => ({
  ErrorBoundary: class StubErrorBoundary extends Component<
    { fallback: ReactNode; children: ReactNode },
    { failed: boolean }
  > {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      return this.state.failed ? this.props.fallback : this.props.children;
    }
  },
}));

// The real BookingEngine is an async Server Component that reads availability
// through Supabase, none of which belongs in a browser test. This synchronous
// stand-in lets each test pick what the guarded child does: render, throw, or
// suspend forever.
const engine = vi.hoisted(() => ({ mode: "render" as "render" | "throw" | "suspend" }));

vi.mock("./BookingEngine", () => ({
  BookingEngine: function StubEngine({ roomType }: { roomType: string }) {
    if (engine.mode === "throw") throw new Error("boom");
    if (engine.mode === "suspend") throw new Promise(() => {});
    return <div data-testid="mock-engine">{roomType}</div>;
  },
}));

import { BookingType } from "@/lib/shared/types/booking";
import { GuardedBookingEngine } from "./GuardedBookingEngine";

afterEach(() => {
  engine.mode = "render";
  vi.restoreAllMocks();
});

test("renders the engine when it neither throws nor suspends", async () => {
  const { getByTestId, container } = await render(
    <GuardedBookingEngine roomType={BookingType.room2} />,
  );

  await expect.element(getByTestId("mock-engine")).toHaveTextContent("room2");
  expect(container.querySelector(".booking-engine-error")).toBeNull();
  expect(container.querySelector('[data-testid="booking-skeleton-dates"]')).toBeNull();
});

test("a throwing engine degrades to the WhatsApp fallback", async () => {
  engine.mode = "throw";
  // React and Sentry both log the caught error; it is the expected path here.
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { getByRole, container } = await render(
    <GuardedBookingEngine roomType={BookingType.room1} />,
  );

  await expect
    .element(getByRole("link", { name: /WhatsApp/ }))
    .toHaveAttribute("href", "https://wa.me/351920742845");

  const message = container.querySelector(".booking-engine-error p.text-red-600");
  expect(message?.textContent).toBe(
    `${BOOKING_UNAVAILABLE_COPY.lead}WhatsApp (+351 920 742 845)${BOOKING_UNAVAILABLE_COPY.tail}`,
  );
});

test("a suspended engine shows the booking skeleton, not nothing", async () => {
  engine.mode = "suspend";

  const { getByTestId } = await render(<GuardedBookingEngine roomType={BookingType.room1} />);

  await expect.element(getByTestId("booking-skeleton-dates")).toBeInTheDocument();
});
