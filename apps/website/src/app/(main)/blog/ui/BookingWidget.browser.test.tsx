import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { BookingType } from "@/lib/shared/types/booking";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

// Mirrors BOOKING_WIDGET_ANCHOR_ID. The real module pulls in the MDX post
// registry, which the browser test bundle cannot load.
const BOOKING_WIDGET_ANCHOR_ID = "book";
vi.mock("@/lib/blog/return-path", () => ({ BOOKING_WIDGET_ANCHOR_ID: "book" }));

// The real engine is an async Server Component that reaches Stripe and
// Supabase. This test is about the widget's box, not what is inside it.
vi.mock("../../booking/[type]/ui/GuardedBookingEngine", () => ({
  GuardedBookingEngine: ({ roomType }: { roomType: BookingType }) => (
    <div data-testid={`engine-${roomType}`} />
  ),
}));

import { BookingWidget } from "./BookingWidget";

// The layout blog/[slug]/page.tsx produces, reduced to its geometry: a
// floated hero in a flow-root container, a short paragraph, then the widget.
// A float pushes only line boxes aside, so without `clear` the aside's own
// box (border and background) would start beside the float, under the photo.
// The float is fixed in pixels so the test does not depend on the viewport.
test("the widget starts below a float that precedes it", async () => {
  const { getByTestId } = await render(
    <div className="flow-root" style={{ width: 800 }}>
      <div data-testid="float" className="float-left" style={{ width: 200, height: 200 }} />
      <p>A short paragraph.</p>
      <BookingWidget />
    </div>,
  );

  const aside = getByTestId("booking-widget").element();
  const float = getByTestId("float").element();

  expect(aside.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    float.getBoundingClientRect().bottom,
  );
  expect(aside).toHaveAttribute("id", BOOKING_WIDGET_ANCHOR_ID);
});
