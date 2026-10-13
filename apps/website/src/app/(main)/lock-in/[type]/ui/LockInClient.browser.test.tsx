import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LOCK_IN_PRICING } from "pricing";
import type { BookingFormState } from "../../../booking/[type]/actions";

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
}));

vi.mock("../../../../../lib/sentry-booking", () => ({
  setBookingContext: vi.fn(),
  addBookingBreadcrumb: vi.fn(),
  captureBookingError: vi.fn(),
}));

// The seam between the form and "the server": the real module is a
// "use server" file.
const mockSubmitLockIn = vi.fn();
vi.mock("../../../booking/[type]/actions", () => ({
  submitLockIn: (...args: unknown[]) => mockSubmitLockIn(...args),
}));

import { LockInClient } from "./LockInClient";

const weeks = [
  { checkIn: "2026-11-02", checkOut: "2026-11-09", available: true },
  { checkIn: "2026-11-09", checkOut: "2026-11-16", available: false },
  { checkIn: "2026-11-16", checkOut: "2026-11-23", available: true },
];

const renderClient = () =>
  render(<LockInClient roomType="room1" weeks={weeks} hasAvailabilityError={false} />);

const failedState = {
  attempt: 1,
  errors: {},
  generalError: "Something went wrong",
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
} satisfies BookingFormState;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitLockIn.mockResolvedValue(failedState);
});

test("a booked week is a non-interactive card that never opens the form", async () => {
  const screen = await renderClient();

  const booked = screen.getByText("Booked");
  await expect.element(booked).toBeInTheDocument();

  const card = booked.element().closest(".lock-in-week");
  expect(card?.tagName).toBe("DIV");
  expect(card?.classList.contains("lock-in-week-available")).toBe(false);
  expect(card?.getAttribute("aria-disabled")).toBe("true");

  await userEvent.click(booked);
  await expect.element(screen.getByLabelText(/^name/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { pressed: true }).elements()).toHaveLength(0);
});

test("picking an available week opens the guest form with 7 nights, the week price and no tourist tax", async () => {
  const screen = await renderClient();

  const card = screen.getByRole("button", { name: /2 Nov – 9 Nov/ });
  await userEvent.click(card);

  await expect.element(screen.getByLabelText(/^name/i)).toBeVisible();
  await expect.element(card).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(screen.getByText(`Total: ${LOCK_IN_PRICING.weekPrice}€`))
    .toBeInTheDocument();
  await expect.element(screen.getByText(/night\(s\):\s*7/)).toBeInTheDocument();
  await expect.element(screen.getByText(/Tourist tax/)).not.toBeInTheDocument();

  const countryCode = screen.getByLabelText("Country code");
  await expect.element(countryCode).toHaveValue("PT");
  expect((countryCode.element() as HTMLSelectElement).selectedOptions[0]?.textContent).toMatch(
    /\+351 Portugal/,
  );
});

test("submitting sends the selected week to submitLockIn", async () => {
  const screen = await renderClient();

  await userEvent.click(screen.getByRole("button", { name: /16 Nov – 23 Nov/ }));
  await userEvent.fill(screen.getByLabelText(/^name/i), "Guest Example");
  await userEvent.fill(screen.getByLabelText(/email/i), "guest@example.com");
  await userEvent.fill(screen.getByLabelText(/whatsapp number/i), "920742845");
  await userEvent.click(screen.getByLabelText("Confirm booking"));

  await expect.element(screen.getByText("Something went wrong")).toBeInTheDocument();
  expect(mockSubmitLockIn).toHaveBeenCalledOnce();
  const [roomType, checkIn, checkOut] = mockSubmitLockIn.mock.calls[0];
  expect([roomType, checkIn, checkOut]).toEqual(["room1", "2026-11-16", "2026-11-23"]);
});
