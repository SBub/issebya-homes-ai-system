import { beforeEach, expect, test, vi } from "vitest";
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
