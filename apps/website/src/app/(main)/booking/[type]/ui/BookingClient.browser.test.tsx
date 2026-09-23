import { addDays, format, startOfDay } from "date-fns";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  startSpan: vi.fn(),
}));

vi.mock("../../../../../lib/sentry-booking", () => ({
  setBookingContext: vi.fn(),
  addBookingBreadcrumb: vi.fn(),
}));

// BookingClient reads phone/guestName/email/source/checkIn/checkOut off the
// URL via useSearchParams — an empty URLSearchParams by default so tests
// exercise the "direct visitor" path unless a test overrides it.
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// Capture the onClose callback from Expanded
let capturedOnClose: (() => void) | null = null;

// Mock child components
vi.mock("./BookingEngineExpanded", () => ({
  BookingEngineExpanded: function MockExpanded({ onClose }: { onClose: () => void }) {
    capturedOnClose = onClose;
    return (
      <div data-testid="mock-expanded">
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

import { BookingClient } from "./BookingClient";

const defaultProps = {
  roomType: "room1" as const,
  blockedDates: [],
  // Calendar days, not instants: BookingClient parses them at browser-local
  // midnight, so the label the server sent is the day the guest is shown, in
  // every timezone the browser might be in.
  defaultCheckIn: "2025-07-17",
  defaultCheckOut: "2025-07-19",
  error: null,
  // Simulates the Server Component handed down from BookingEngine via the
  // "interleaving" pattern — BookingClient never imports BookingPricing.
  pricing: <div data-testid="mock-pricing">Mock Pricing</div>,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  capturedOnClose = null;
});

// The scroll tests spy on Element.prototype and window; clearAllMocks above
// resets call history but does not restore the originals.
afterEach(() => {
  vi.restoreAllMocks();
});

test("user sees error message when availability fetch failed and no dates are available", async () => {
  const { getByText } = await render(
    <BookingClient
      {...defaultProps}
      defaultCheckIn={null}
      defaultCheckOut={null}
      error="Failed to fetch availability data"
    />,
  );
  await expect.element(getByText("Failed to fetch availability data")).toBeInTheDocument();
});

test("user sees collapsed view with server-provided default dates", async () => {
  const { getByLabelText, getByTestId } = await render(<BookingClient {...defaultProps} />);
  await expect.element(getByLabelText("Select check-in date")).toBeInTheDocument();
  await expect.element(getByTestId("mock-pricing")).toBeInTheDocument();
  await expect.element(page.getByTestId("mock-expanded")).not.toBeInTheDocument();
});

test("pricing is rendered as a sibling between collapsed and expanded", async () => {
  const { getByLabelText, container } = await render(<BookingClient {...defaultProps} />);
  await expect.element(getByLabelText("Book selected dates")).toBeInTheDocument();

  const childIdsBeforeExpand = Array.from(
    container.querySelector(".booking-engine")?.children ?? [],
  ).map((el) => el.getAttribute("data-testid") ?? el.className);
  expect(childIdsBeforeExpand).toEqual(["booking-engine-collapsed", "mock-pricing"]);

  await userEvent.click(getByLabelText("Book selected dates"));

  const childIdsAfterExpand = Array.from(
    container.querySelector(".booking-engine")?.children ?? [],
  ).map((el) => el.getAttribute("data-testid") ?? el.className);
  expect(childIdsAfterExpand).toEqual([
    "booking-engine-collapsed",
    "mock-pricing",
    "mock-expanded",
  ]);
});

test("user sees expanded view after clicking expand", async () => {
  const { getByTestId, getByLabelText } = await render(<BookingClient {...defaultProps} />);

  await userEvent.click(getByLabelText("Book selected dates"));

  await expect.element(getByTestId("mock-expanded")).toBeInTheDocument();
});

test("expanded view hides when user clicks close", async () => {
  const { getByRole, getByLabelText } = await render(<BookingClient {...defaultProps} />);

  // Expand
  await userEvent.click(getByLabelText("Book selected dates"));
  await expect.element(page.getByTestId("mock-expanded")).toBeInTheDocument();

  // Close
  await userEvent.click(getByRole("button", { name: "Close" }));
  await expect.element(page.getByTestId("mock-expanded")).not.toBeInTheDocument();
});

// Closing used to scroll to the top of the document, which on the mobile room
// page is the gallery and in a blog post is the article's top. It must land on
// the same element expanding lands on: the engine, date row at the top.
test("closing the calendar scrolls back to the engine, not the page top", async () => {
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

  const { getByRole, getByLabelText, container } = await render(
    <BookingClient {...defaultProps} />,
  );
  await expect.element(getByLabelText("Book selected dates")).toBeInTheDocument();
  // A direct visitor is never scrolled on mount.
  expect(scrollIntoView).not.toHaveBeenCalled();

  await userEvent.click(getByLabelText("Book selected dates"));
  await expect.element(page.getByTestId("mock-expanded")).toBeInTheDocument();
  scrollIntoView.mockClear();

  await userEvent.click(getByRole("button", { name: "Close" }));
  await expect.element(page.getByTestId("mock-expanded")).not.toBeInTheDocument();

  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector(".booking-engine"));
  expect(scrollTo).not.toHaveBeenCalled();
});

// BookingWidget renders this same BookingClient mid-article inside the #book
// aside, so the fix has to hold there without any widget-specific code.
// Mirrors BOOKING_WIDGET_ANCHOR_ID; not imported because @/lib/blog/return-path
// pulls in the MDX post registry, which the browser test bundle cannot load.
const BOOKING_WIDGET_ANCHOR_ID = "book";

test("inside the blog widget arrangement, closing lands on the engine", async () => {
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

  const { getByRole, getByLabelText, container } = await render(
    <aside id={BOOKING_WIDGET_ANCHOR_ID}>
      <div style={{ height: 2000 }}>article above</div>
      <BookingClient {...defaultProps} />
    </aside>,
  );

  await userEvent.click(getByLabelText("Book selected dates"));
  await expect.element(page.getByTestId("mock-expanded")).toBeInTheDocument();
  scrollIntoView.mockClear();

  await userEvent.click(getByRole("button", { name: "Close" }));
  await expect.element(page.getByTestId("mock-expanded")).not.toBeInTheDocument();

  const engine = container.querySelector(`#${BOOKING_WIDGET_ANCHOR_ID} .booking-engine`);
  expect(engine).not.toBeNull();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView.mock.contexts[0]).toBe(engine);
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  expect(scrollTo).not.toHaveBeenCalled();
});

test("user sees formatted dates when provided", async () => {
  const { getByText } = await render(<BookingClient {...defaultProps} />);

  await expect.element(getByText("17 Jul 2025")).toBeInTheDocument();
  await expect.element(getByText("19 Jul 2025")).toBeInTheDocument();
});

test('user sees "Select date" placeholders when no dates', async () => {
  const { getByLabelText } = await render(
    <BookingClient {...defaultProps} defaultCheckIn={null} defaultCheckOut={null} />,
  );

  await expect.element(getByLabelText("Select check-in date")).toHaveTextContent("Select date");
  await expect.element(getByLabelText("Select check-out date")).toHaveTextContent("Select date");
});

test("all three collapsed buttons are clickable and accessible", async () => {
  const { getByLabelText } = await render(
    <BookingClient {...defaultProps} defaultCheckIn={null} defaultCheckOut={null} />,
  );

  await expect.element(getByLabelText("Select check-in date")).toBeEnabled();
  await expect.element(getByLabelText("Select check-out date")).toBeEnabled();
  await expect.element(getByLabelText("Book selected dates")).toBeEnabled();
});

test("calendar auto-expands when arriving via a GCA link", async () => {
  mockSearchParams = new URLSearchParams({ source: "gca", phone: "+351920742845" });

  const { getByTestId } = await render(<BookingClient {...defaultProps} />);

  await expect.element(getByTestId("mock-expanded")).toBeInTheDocument();
});

// The GCA sends links shaped
// https://issebya.com/booking/room1?checkIn=2026-09-01&checkOut=2026-09-05.
// Those params are calendar-day labels, so the guest has to be shown the days
// they name, not the days a UTC-midnight parse happens to land on in the
// browser's timezone.
test("user sees the exact days named by a GCA booking link", async () => {
  mockSearchParams = new URLSearchParams({
    checkIn: "2027-07-21",
    checkOut: "2027-07-24",
  });

  const { getByText } = await render(<BookingClient {...defaultProps} />);

  await expect.element(getByText("21 Jul 2027")).toBeInTheDocument();
  await expect.element(getByText("24 Jul 2027")).toBeInTheDocument();
});

// A GCA link whose dates cannot be applied used to fall back to the server
// defaults in silence, so the guest saw a stay they never agreed to with
// nothing explaining the swap. The notice below is the feedback path: the
// accept/reject decision is unchanged, the rejection is just no longer
// invisible. Future fixtures are built relative to today so they never go
// stale, and always through date-fns rather than new Date("yyyy-MM-dd"),
// which is UTC midnight (see AGENTS.md, "Calendar days are strings").
const TODAY = startOfDay(new Date());
const futureDay = (offset: number) => addDays(TODAY, offset);
const futureParam = (offset: number) => format(futureDay(offset), "yyyy-MM-dd");
const futureLabel = (offset: number) => format(futureDay(offset), "d MMM yyyy");

test("user sees why a link with past dates was not applied", async () => {
  mockSearchParams = new URLSearchParams({
    checkIn: "2020-01-10",
    checkOut: "2020-01-12",
    phone: "+351920742845",
    source: "gca",
  });

  const { getByRole, getByText } = await render(<BookingClient {...defaultProps} />);

  const notice = getByRole("status");
  await expect.element(notice).toHaveTextContent(/in the past/i);
  await expect.element(notice).toHaveTextContent("10 Jan 2020");
  await expect.element(notice).toHaveTextContent("12 Jan 2020");

  // The selection itself still falls back to the server defaults, unchanged.
  await expect.element(getByText("17 Jul 2025")).toBeInTheDocument();
  await expect.element(getByText("19 Jul 2025")).toBeInTheDocument();
});

test("user sees why a link overlapping a booked range was not applied", async () => {
  mockSearchParams = new URLSearchParams({
    checkIn: futureParam(30),
    checkOut: futureParam(33),
    phone: "+351920742845",
    source: "gca",
  });

  const { getByRole } = await render(
    <BookingClient
      {...defaultProps}
      blockedDates={[{ start: futureDay(30), end: futureDay(33) }]}
    />,
  );

  const notice = getByRole("status");
  await expect.element(notice).toHaveTextContent(/no longer available/i);
  await expect.element(notice).toHaveTextContent(futureLabel(30));
  await expect.element(notice).toHaveTextContent(futureLabel(33));
});

test("user sees a could-not-be-read notice for unparseable link dates", async () => {
  mockSearchParams = new URLSearchParams({ checkIn: "foo", checkOut: "bar" });

  const { getByRole } = await render(<BookingClient {...defaultProps} />);

  await expect.element(getByRole("status")).toHaveTextContent(/could not read the dates/i);
});

test("an inverted link range reads as could-not-be-read, with no dates named", async () => {
  mockSearchParams = new URLSearchParams({
    checkIn: futureParam(33),
    checkOut: futureParam(30),
  });

  const { getByRole } = await render(<BookingClient {...defaultProps} />);

  const notice = getByRole("status");
  await expect.element(notice).toHaveTextContent(/could not read the dates/i);
  await expect.element(notice).not.toHaveTextContent(futureLabel(33));
});

test("a valid future link is applied with no notice", async () => {
  mockSearchParams = new URLSearchParams({
    checkIn: futureParam(30),
    checkOut: futureParam(33),
    phone: "+351920742845",
    source: "gca",
  });

  const { getByText } = await render(<BookingClient {...defaultProps} />);

  await expect.element(getByText(futureLabel(30))).toBeInTheDocument();
  await expect.element(getByText(futureLabel(33))).toBeInTheDocument();
  await expect.element(page.getByRole("status")).not.toBeInTheDocument();
});

test("a URL with no dates renders no notice at all", async () => {
  const { getByLabelText } = await render(<BookingClient {...defaultProps} />);

  await expect.element(getByLabelText("Select check-in date")).toBeInTheDocument();
  await expect.element(page.getByRole("status")).not.toBeInTheDocument();
});
