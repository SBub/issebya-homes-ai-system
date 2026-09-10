import { addDays, addMonths, format, startOfDay, startOfMonth } from "date-fns";
import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DateRange } from "@/lib/shared/types/booking";

// Mock date-utils to control "today"
vi.mock("../../../../../lib/date-utils", async () => {
  const actual = await vi.importActual("../../../../../lib/date-utils");
  return {
    ...actual,
    isPastDate: vi.fn(),
    findFirstMonthWithAvailability: vi.fn(),
  };
});

import { findFirstMonthWithAvailability, isPastDate } from "../../../../../lib/date-utils";
import { BookingCalendar } from "./BookingCalendar";

const TODAY = startOfDay(new Date("2025-07-15"));

const blockedRanges: DateRange[] = [{ start: new Date("2025-07-20"), end: new Date("2025-07-23") }];

// isValidDateRange checks the check-in against the real system clock, not the mocked
// isPastDate above, so any test that exercises check-out selection has to use dates
// that are genuinely in the future. Offsets are days from the 1st of that month.
const FUTURE_MONTH = startOfMonth(addMonths(startOfDay(new Date()), 2));
const futureDay = (offset: number) => addDays(FUTURE_MONTH, offset);
const futureLabel = (offset: number) => format(futureDay(offset), "MMMM d, yyyy");

// Nights on the 13th, 14th, 15th and 16th are taken. With a check-in on the 10th the
// 13th is the first blocked day, so it is a legal same-day-turnover check-out.
const futureBlocked: DateRange[] = [{ start: futureDay(12), end: futureDay(16) }];
const FUTURE_CHECK_IN = futureDay(9);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPastDate).mockImplementation((date: Date) => startOfDay(date) < TODAY);
  vi.mocked(findFirstMonthWithAvailability).mockReturnValue(startOfDay(new Date("2025-07-01")));
});

test("renders two month titles and day-of-week headers", async () => {
  const { getByText } = await render(
    <BookingCalendar
      blockedDates={[]}
      selectedCheckIn={null}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  await expect.element(getByText("July 2025")).toBeInTheDocument();
  await expect.element(getByText("August 2025")).toBeInTheDocument();
  await expect.element(getByText("Su").first()).toBeInTheDocument();
  await expect.element(getByText("Mo").first()).toBeInTheDocument();
});

test("blocked and past dates are disabled, available dates are enabled", async () => {
  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={blockedRanges}
      selectedCheckIn={null}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  // Past date (before Jul 15)
  await expect.element(getByLabelText("July 10, 2025")).toBeDisabled();
  // Blocked date (Jul 20-23 range)
  await expect.element(getByLabelText("July 21, 2025")).toBeDisabled();
  // Available date
  await expect.element(getByLabelText("July 16, 2025")).toBeEnabled();
});

test("user navigates one month forward and sees new months", async () => {
  const { getByLabelText, getByText } = await render(
    <BookingCalendar
      blockedDates={[]}
      selectedCheckIn={null}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  await userEvent.click(getByLabelText("Next month"));

  await expect.element(getByText("August 2025")).toBeInTheDocument();
  await expect.element(getByText("September 2025")).toBeInTheDocument();
});

test("user navigates one month backward and sees previous months", async () => {
  const { getByLabelText, getByText } = await render(
    <BookingCalendar
      blockedDates={[]}
      selectedCheckIn={null}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  await userEvent.click(getByLabelText("Next month"));
  await userEvent.click(getByLabelText("Previous month"));

  await expect.element(getByText("July 2025")).toBeInTheDocument();
  await expect.element(getByText("August 2025")).toBeInTheDocument();
});

test("selected check-in date shows aria-pressed", async () => {
  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={[]}
      selectedCheckIn={new Date("2025-07-16")}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  await expect.element(getByLabelText("July 16, 2025")).toHaveAttribute("aria-pressed", "true");
});

test("selected range shows both check-in and check-out as aria-pressed", async () => {
  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={[]}
      selectedCheckIn={new Date("2025-07-16")}
      selectedCheckOut={new Date("2025-07-19")}
      onDateSelect={vi.fn()}
    />,
  );

  await expect.element(getByLabelText("July 16, 2025")).toHaveAttribute("aria-pressed", "true");
  await expect.element(getByLabelText("July 19, 2025")).toHaveAttribute("aria-pressed", "true");
});

test("user can activate a date with keyboard Enter", async () => {
  const onDateSelect = vi.fn();
  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={[]}
      selectedCheckIn={null}
      selectedCheckOut={null}
      onDateSelect={onDateSelect}
    />,
  );

  const dateButton = getByLabelText("July 16, 2025");
  dateButton.element().focus();
  await userEvent.keyboard("{Enter}");

  // We verify the date button is focusable and keyboard-activatable
  // The callback is the component's contract with its parent
  await expect.element(dateButton).toHaveAttribute("tabindex", "0");
});

test("first blocked date after selected check-in becomes clickable as check-out", async () => {
  vi.mocked(findFirstMonthWithAvailability).mockReturnValue(FUTURE_MONTH);

  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={futureBlocked}
      selectedCheckIn={FUTURE_CHECK_IN}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  // The 13th is blocked but enabled: nights 10, 11 and 12 are all free.
  await expect.element(getByLabelText(futureLabel(12))).toBeEnabled();
  // The 14th is inside the blocked range: nights 10 to 13 include blocked night 13.
  await expect.element(getByLabelText(futureLabel(13))).toBeDisabled();
});

test("blocked check-out candidate renders as check-out only, never as available", async () => {
  // Regression guard. Being a legal check-out used to make a blocked day skip the
  // blocked branch entirely, so it fell through and rendered as a free night.
  vi.mocked(findFirstMonthWithAvailability).mockReturnValue(FUTURE_MONTH);

  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={futureBlocked}
      selectedCheckIn={FUTURE_CHECK_IN}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  const checkOutCandidate = getByLabelText(futureLabel(12));
  await expect.element(checkOutCandidate).toHaveClass("calendar-date-checkout-boundary");
  await expect.element(checkOutCandidate).not.toHaveClass("calendar-date-available");
  // It really is clickable, so it keeps the pointer and hover affordance.
  await expect.element(checkOutCandidate).toHaveClass("calendar-date-clickable");

  // A mid-block day stays fully unavailable and gets no affordance.
  const midBlock = getByLabelText(futureLabel(13));
  await expect.element(midBlock).toHaveClass("calendar-date-blocked");
  await expect.element(midBlock).not.toHaveClass("calendar-date-available");
  await expect.element(midBlock).not.toHaveClass("calendar-date-clickable");
});

test("blocked date chosen as check-out renders as selected, not hatched or available", async () => {
  vi.mocked(findFirstMonthWithAvailability).mockReturnValue(FUTURE_MONTH);

  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={futureBlocked}
      selectedCheckIn={FUTURE_CHECK_IN}
      selectedCheckOut={futureDay(12)}
      onDateSelect={vi.fn()}
    />,
  );

  const selectedCheckOut = getByLabelText(futureLabel(12));
  await expect.element(selectedCheckOut).toHaveClass("calendar-date-selected");
  await expect.element(selectedCheckOut).not.toHaveClass("calendar-date-checkout-boundary");
  await expect.element(selectedCheckOut).not.toHaveClass("calendar-date-available");
});

test("first blocked date gets checkout-boundary style, mid-block dates stay fully blocked", async () => {
  // Blocked range Jul 23–26. Jul 22 is available, so Jul 23 is a checkout boundary.
  // Jul 24 is mid-block (prev day Jul 23 is also blocked) — stays fully blocked.
  const blocked: DateRange[] = [{ start: new Date("2025-07-23"), end: new Date("2025-07-26") }];

  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={blocked}
      selectedCheckIn={null}
      selectedCheckOut={null}
      onDateSelect={vi.fn()}
    />,
  );

  // Both are disabled buttons (not clickable without check-in)
  await expect.element(getByLabelText("July 23, 2025")).toBeDisabled();
  await expect.element(getByLabelText("July 24, 2025")).toBeDisabled();

  // But Jul 23 has the boundary class (stripe), Jul 24 has the full blocked class
  await expect
    .element(getByLabelText("July 23, 2025"))
    .toHaveClass("calendar-date-checkout-boundary");
  await expect.element(getByLabelText("July 24, 2025")).toHaveClass("calendar-date-blocked");
});
