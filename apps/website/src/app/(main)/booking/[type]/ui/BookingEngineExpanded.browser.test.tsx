import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ROOM_PRICING } from "pricing";

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

vi.mock("../../../../../lib/sentry-booking", () => ({
  setBookingContext: vi.fn(),
  addBookingBreadcrumb: vi.fn(),
  captureBookingError: vi.fn(),
}));

import { BookingEngineExpanded } from "./BookingEngineExpanded";

const checkIn = new Date("2025-08-01");
const checkOut = new Date("2025-08-04");
const originalFetch = window.fetch;

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const defaultProps = {
  blockedDates: [],
  checkInDate: checkIn,
  checkOutDate: checkOut,
  onDateSelect: vi.fn(),
  onClose: vi.fn(),
  roomType: "room1" as const,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.fetch = vi.fn() as typeof window.fetch;
});

afterEach(() => {
  window.fetch = originalFetch;
});

test("user sees pricing summary when dates are provided", async () => {
  const { getByText } = await renderWithQuery(<BookingEngineExpanded {...defaultProps} />);

  const expectedBase = 3 * ROOM_PRICING.basePrice;
  const expectedTax = Math.min(3, ROOM_PRICING.touristTaxNights) * ROOM_PRICING.touristTax;
  const expectedTotal = expectedBase + expectedTax;

  await expect.element(getByText(`Total: ${expectedTotal}€`)).toBeInTheDocument();
  await expect.element(getByText(`Tourist tax: ${expectedTax}€*`)).toBeInTheDocument();
});

test("user sees dashes when no dates are provided", async () => {
  const { getByText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} checkInDate={null} checkOutDate={null} />,
  );

  await expect.element(getByText("Total: --€")).toBeInTheDocument();
  await expect.element(getByText("Tourist tax: --€*")).toBeInTheDocument();
});

test("user can increment person count to 2 and decrement back to 1", async () => {
  const { getByLabelText } = await renderWithQuery(<BookingEngineExpanded {...defaultProps} />);

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

test("user sees email validation error after leaving invalid email", async () => {
  const { getByLabelText, getByText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} />,
  );

  await userEvent.fill(getByLabelText(/email/i), "not-an-email");
  await userEvent.tab();

  await expect.element(getByText(/please enter a valid email/i)).toBeInTheDocument();
  await expect.element(getByLabelText(/email/i)).toHaveAttribute("aria-invalid", "true");
});

test("email error disappears when user starts typing again", async () => {
  const { getByLabelText, getByText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} />,
  );

  await userEvent.fill(getByLabelText(/email/i), "bad");
  await userEvent.tab();
  await expect.element(getByText(/please enter a valid email/i)).toBeInTheDocument();

  await userEvent.fill(getByLabelText(/email/i), "guest@example.com");
  await expect.element(page.getByText(/please enter a valid email/i)).not.toBeInTheDocument();
});

test("book button is disabled until email and dates are provided", async () => {
  const { getByLabelText } = await renderWithQuery(<BookingEngineExpanded {...defaultProps} />);

  // No email — disabled
  await expect.element(getByLabelText("Confirm booking")).toBeDisabled();

  // With email — enabled
  await userEvent.fill(getByLabelText(/email/i), "guest@example.com");
  await expect.element(getByLabelText("Confirm booking")).toBeEnabled();
});

test("book button is disabled when dates are missing", async () => {
  const { getByLabelText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} checkInDate={null} checkOutDate={null} />,
  );

  await userEvent.fill(getByLabelText(/email/i), "guest@example.com");
  await expect.element(getByLabelText("Confirm booking")).toBeDisabled();
});

test('user sees "booking..." while API call is in progress', async () => {
  // Fetch that never resolves
  vi.mocked(window.fetch).mockReturnValue(new Promise(() => {}));

  const { getByLabelText, getByText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} />,
  );

  await userEvent.fill(getByLabelText(/email/i), "guest@example.com");
  await userEvent.click(getByLabelText("Confirm booking"));

  await expect.element(getByText("booking...")).toBeInTheDocument();
  await expect.element(getByLabelText("Confirm booking")).toBeDisabled();
});

test("user sees error message when booking API fails", async () => {
  vi.mocked(window.fetch)
    .mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: "dates_unavailable",
          message: "Dates no longer available",
        }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ bookings: [] }),
    } as Response);

  const { getByLabelText, getByText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} />,
  );

  await userEvent.fill(getByLabelText(/email/i), "guest@example.com");
  await userEvent.click(getByLabelText("Confirm booking"));

  await expect
    .element(getByText(/these dates were just booked by someone else/i))
    .toBeInTheDocument();
});

test("user sees error message passed from parent", async () => {
  const { getByText } = await renderWithQuery(
    <BookingEngineExpanded {...defaultProps} error="Something went wrong" />,
  );

  await expect.element(getByText("Something went wrong")).toBeInTheDocument();
});

test("tourist tax info link is present", async () => {
  const { getByRole } = await renderWithQuery(<BookingEngineExpanded {...defaultProps} />);

  const link = getByRole("link", { name: /tourist tax/i });
  await expect.element(link).toBeInTheDocument();
});
