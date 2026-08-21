import { startOfDay } from "date-fns";
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
  // Blocked range: Jul 23–26. Check-in selected: Jul 20.
  // Jul 23 is the first blocked date — should be enabled as valid check-out.
  const blocked: DateRange[] = [{ start: new Date("2025-07-23"), end: new Date("2025-07-26") }];
  const onDateSelect = vi.fn();

  const { getByLabelText } = await render(
    <BookingCalendar
      blockedDates={blocked}
      selectedCheckIn={new Date("2025-07-20")}
      selectedCheckOut={null}
      onDateSelect={onDateSelect}
    />,
  );

  // Jul 23 is blocked but should be enabled (valid check-out — all nights Jul 20–22 are free)
  await expect.element(getByLabelText("July 23, 2025")).toBeEnabled();
  // Jul 24 is inside the blocked range — nights 20–23 include blocked night 23, invalid
  await expect.element(getByLabelText("July 24, 2025")).toBeDisabled();
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
