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

// Capture the onExpand callback from Collapsed
let capturedOnExpand: (() => void) | null = null;
// Capture the onClose callback from Expanded
let capturedOnClose: (() => void) | null = null;

// Mock child components
vi.mock("./BookingEngineCollapsed", () => ({
  BookingEngineCollapsed: function MockCollapsed({ onExpand }: { onExpand: () => void }) {
    capturedOnExpand = onExpand;
    return (
      <div data-testid="mock-collapsed">
        <button onClick={onExpand}>Expand</button>
      </div>
    );
  },
}));

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

vi.mock("./BookingEngineSkeleton", () => ({
  BookingEngineSkeleton: function MockSkeleton() {
    return <div data-testid="mock-skeleton">Loading...</div>;
  },
}));

// Mock the availability hook
const mockUseAvailabilityQuery = vi.fn();
vi.mock("../hooks/useAvailabilityQuery", () => ({
  useAvailabilityQuery: (...args: unknown[]) => mockUseAvailabilityQuery(...args),
}));

import { BookingEngine } from "./BookingEngine";

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnExpand = null;
  capturedOnClose = null;
});

test("user sees skeleton while availability is loading", async () => {
  mockUseAvailabilityQuery.mockReturnValue({
    blockedDates: [],
    checkInDate: null,
    checkOutDate: null,
    isLoading: true,
    error: null,
    setCheckIn: vi.fn(),
    setCheckOut: vi.fn(),
    validateRange: vi.fn(),
  });

  const { getByTestId } = await render(<BookingEngine roomType="room1" />);
  await expect.element(getByTestId("mock-skeleton")).toBeInTheDocument();
});

test("user sees error message when availability fetch fails", async () => {
  mockUseAvailabilityQuery.mockReturnValue({
    blockedDates: [],
    checkInDate: null,
    checkOutDate: null,
    isLoading: false,
    error: "Failed to fetch availability data",
    setCheckIn: vi.fn(),
    setCheckOut: vi.fn(),
    validateRange: vi.fn(),
  });

  const { getByText } = await render(<BookingEngine roomType="room1" />);
  await expect.element(getByText("Failed to fetch availability data")).toBeInTheDocument();
});

test("user sees collapsed view after loading", async () => {
  mockUseAvailabilityQuery.mockReturnValue({
    blockedDates: [],
    checkInDate: new Date("2025-07-17"),
    checkOutDate: new Date("2025-07-19"),
    isLoading: false,
    error: null,
    setCheckIn: vi.fn(),
    setCheckOut: vi.fn(),
    validateRange: vi.fn(),
  });

  const { getByTestId } = await render(<BookingEngine roomType="room1" />);
  await expect.element(getByTestId("mock-collapsed")).toBeInTheDocument();
  await expect.element(page.getByTestId("mock-expanded")).not.toBeInTheDocument();
});

test("user sees expanded view after clicking expand", async () => {
  mockUseAvailabilityQuery.mockReturnValue({
    blockedDates: [],
    checkInDate: new Date("2025-07-17"),
    checkOutDate: new Date("2025-07-19"),
    isLoading: false,
    error: null,
    setCheckIn: vi.fn(),
    setCheckOut: vi.fn(),
    validateRange: vi.fn(),
  });

  const { getByTestId, getByRole } = await render(<BookingEngine roomType="room1" />);

  await userEvent.click(getByRole("button", { name: "Expand" }));

  await expect.element(getByTestId("mock-expanded")).toBeInTheDocument();
});

test("expanded view hides when user clicks close", async () => {
  mockUseAvailabilityQuery.mockReturnValue({
    blockedDates: [],
    checkInDate: new Date("2025-07-17"),
    checkOutDate: new Date("2025-07-19"),
    isLoading: false,
    error: null,
    setCheckIn: vi.fn(),
    setCheckOut: vi.fn(),
    validateRange: vi.fn(),
  });

  const { getByRole } = await render(<BookingEngine roomType="room1" />);

  // Expand
  await userEvent.click(getByRole("button", { name: "Expand" }));
  await expect.element(page.getByTestId("mock-expanded")).toBeInTheDocument();

  // Close
  await userEvent.click(getByRole("button", { name: "Close" }));
  await expect.element(page.getByTestId("mock-expanded")).not.toBeInTheDocument();
});
