import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ROOM_PRICING } from "pricing";
import type { BookingFormState } from "../actions";

// Mock BookingCalendar — child component, not our responsibility
vi.mock("./BookingCalendar", () => ({
  BookingCalendar: function MockCalendar() {
    return <div data-testid="mock-calendar">Mock Calendar</div>;
  },
}));

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
}));

// BookingEngineExpanded reads phone/guestName/email/source off the URL via
// useSearchParams — an empty URLSearchParams by default so tests exercise
// the "direct visitor" path unless a test overrides it.
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("../../../../../lib/sentry-booking", () => ({
  setBookingContext: vi.fn(),
  addBookingBreadcrumb: vi.fn(),
  captureBookingError: vi.fn(),
}));

// The form's `action` is a real Server Function reference (`submitBooking`),
// not a plain client callback — mock the module the same way the old
// suite mocked `window.fetch`, since that's now the seam between this
// component and "the server".
const mockSubmitBooking = vi.fn();
vi.mock("../actions", () => ({
  submitBooking: (...args: unknown[]) => mockSubmitBooking(...args),
}));

import { BookingEngineExpanded } from "./BookingEngineExpanded";

const checkIn = new Date("2025-08-01");
const checkOut = new Date("2025-08-04");

const defaultProps = {
  blockedDates: [],
  checkInDate: checkIn,
  checkOutDate: checkOut,
  onDateSelect: vi.fn(),
  onClose: vi.fn(),
  roomType: "room1" as const,
  error: null,
  updateAvailability: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  mockSubmitBooking.mockReset();
});

// Fills every contact field the way a real guest would before booking. Not
// required to enable the "Confirm booking" button (it's disabled only while
// pending — see below), just realistic test setup for the submission tests.
async function fillContactFields(
  getByLabelText: Awaited<ReturnType<typeof render>>["getByLabelText"],
) {
  await userEvent.fill(getByLabelText(/^name/i), "Guest Example");
  await userEvent.fill(getByLabelText(/email/i), "guest@example.com");
  await userEvent.fill(getByLabelText(/whatsapp number/i), "920742845");
}

test("user sees pricing summary when dates are provided", async () => {
  const { getByText } = await render(<BookingEngineExpanded {...defaultProps} />);

  const expectedBase = 3 * ROOM_PRICING.basePrice;
  const expectedTax = Math.min(3, ROOM_PRICING.touristTaxNights) * ROOM_PRICING.touristTax;
  const expectedTotal = expectedBase + expectedTax;

  await expect.element(getByText(`Total: ${expectedTotal}€`)).toBeInTheDocument();
  await expect.element(getByText(`Tourist tax: ${expectedTax}€*`)).toBeInTheDocument();
});

test("user sees dashes when no dates are provided", async () => {
  const { getByText } = await render(
    <BookingEngineExpanded {...defaultProps} checkInDate={null} checkOutDate={null} />,
  );

  await expect.element(getByText("Total: --€")).toBeInTheDocument();
  await expect.element(getByText("Tourist tax: --€*")).toBeInTheDocument();
});

test("user can increment person count to 2 and decrement back to 1", async () => {
  const { getByLabelText } = await render(<BookingEngineExpanded {...defaultProps} />);

  const decrement = getByLabelText("Decrease number of persons");
  const increment = getByLabelText("Increase number of persons");

  // Starts at 1 — can't go lower
  await expect.element(decrement).toBeDisabled();
  await expect.element(increment).toBeEnabled();

  // Increment to 2 — can't go higher
  await userEvent.click(increment);
  await expect.element(increment).toBeDisabled();
  await expect.element(decrement).toBeEnabled();

  // Decrement back to 1
  await userEvent.click(decrement);
  await expect.element(decrement).toBeDisabled();
});

test("book button starts enabled, with no fields filled and no dates selected", async () => {
  // No client-side gating on field content or dates anymore — the server
  // action is the sole source of truth for validation (it returns a
  // friendly "Please select check-in and check-out dates." generalError
  // when dates are missing, rather than the button pre-blocking the click).
  const { getByLabelText } = await render(
    <BookingEngineExpanded {...defaultProps} checkInDate={null} checkOutDate={null} />,
  );

  await expect.element(getByLabelText("Confirm booking")).toBeEnabled();
});

test("user sees the server's friendly message when submitting without dates", async () => {
  mockSubmitBooking.mockResolvedValue({
    attempt: 1,
    errors: {},
    generalError: "Please select check-in and check-out dates.",
    values: {
      guestName: "Guest Example",
      email: "guest@example.com",
      countryId: "PT",
      localNumber: "920742845",
      whatsappOptIn: false,
    },
    blockedDates: null,
    success: false,
    url: null,
    guestContactId: null,
  } satisfies BookingFormState);

  const { getByLabelText, getByText } = await render(
    <BookingEngineExpanded {...defaultProps} checkInDate={null} checkOutDate={null} />,
  );

  await fillContactFields(getByLabelText);
  await userEvent.click(getByLabelText("Confirm booking"));

  await expect
    .element(getByText(/please select check-in and check-out dates/i))
    .toBeInTheDocument();
});

test('user sees "booking..." while the action is in progress', async () => {
  let resolveAction!: (value: unknown) => void;
  mockSubmitBooking.mockReturnValue(
    new Promise((resolve) => {
      resolveAction = resolve;
    }),
  );

  const { getByLabelText, getByText } = await render(<BookingEngineExpanded {...defaultProps} />);

  await expect.element(getByLabelText("Confirm booking")).toBeEnabled();

  await fillContactFields(getByLabelText);
  await userEvent.click(getByLabelText("Confirm booking"));

  await expect.element(getByText("booking...")).toBeInTheDocument();
  await expect.element(getByLabelText("Confirm booking")).toBeDisabled();

  // Settle the pending action before the test ends — leaving a Server
  // Function call permanently unresolved bleeds into later tests (React's
  // pending-transition bookkeeping doesn't seem to fully let go otherwise).
  resolveAction({
    attempt: 1,
    errors: {},
    generalError: "",
    values: {
      guestName: "Guest Example",
      email: "guest@example.com",
      countryId: "PT",
      localNumber: "920742845",
      whatsappOptIn: false,
    },
    blockedDates: null,
    success: false,
    url: null,
    guestContactId: null,
  } satisfies BookingFormState);
});

test("user sees error message and refreshed calendar when dates are no longer available", async () => {
  mockSubmitBooking.mockResolvedValue({
    attempt: 1,
    errors: {},
    generalError:
      "Sorry, these dates were just booked by someone else. The calendar has been refreshed. Please select new dates.",
    values: {
      guestName: "Guest Example",
      email: "guest@example.com",
      countryId: "PT",
      localNumber: "920742845",
      whatsappOptIn: false,
    },
    blockedDates: [],
    success: false,
    url: null,
    guestContactId: null,
  } satisfies BookingFormState);

  const { getByLabelText, getByText } = await render(<BookingEngineExpanded {...defaultProps} />);

  await fillContactFields(getByLabelText);
  await userEvent.click(getByLabelText("Confirm booking"));

  await expect
    .element(getByText(/these dates were just booked by someone else/i))
    .toBeInTheDocument();

  // updateAvailability is called inline inside the action wrapper before
  // the resolved state (and thus this error text) ever commits, so this
  // is safe to assert directly — no waiting needed.
  expect(defaultProps.updateAvailability).toHaveBeenCalledWith([]);
});

test("user sees error message passed from parent", async () => {
  const { getByText } = await render(
    <BookingEngineExpanded {...defaultProps} error="Something went wrong" />,
  );

  await expect.element(getByText("Something went wrong")).toBeInTheDocument();
});

test("tourist tax info link is present", async () => {
  const { getByRole } = await render(<BookingEngineExpanded {...defaultProps} />);

  const link = getByRole("link", { name: /tourist tax/i });
  await expect.element(link).toBeInTheDocument();
});
