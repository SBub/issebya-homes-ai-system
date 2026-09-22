import { addDays, addMonths, format, startOfDay, startOfMonth } from "date-fns";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { toCalendarDay } from "@/lib/date-utils";
import type { DateRange } from "@/lib/shared/types/booking";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

// Both engines take the direct-visitor path: no ?phone=, so neither
// auto-expands, and no ?checkIn=/?checkOut=, so each falls back to its own
// server-computed defaults.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../../../../lib/sentry-booking", () => ({
  setBookingContext: vi.fn(),
  addBookingBreadcrumb: vi.fn(),
}));

// The real BookingEngineExpanded imports the submitBooking Server Function,
// and through it Stripe and Supabase, none of which belong in a browser
// test. This stub keeps the only part these tests are about: the real
// BookingCalendar, rendered with the availability and selection the engine
// was handed, so the assertions below run against the real calendar's real
// DOM rather than a restatement of it.
vi.mock("../../booking/[type]/ui/BookingEngineExpanded", async () => {
  const { BookingCalendar } = await import("../../booking/[type]/ui/BookingCalendar");

  return {
    BookingEngineExpanded: function StubExpanded({
      blockedDates,
      checkInDate,
      checkOutDate,
      onDateSelect,
    }: {
      blockedDates: DateRange[];
      checkInDate: Date | null;
      checkOutDate: Date | null;
      onDateSelect: (date: Date) => void;
    }) {
      return (
        <div data-testid="expanded-engine">
          <BookingCalendar
            blockedDates={blockedDates}
            selectedCheckIn={checkInDate}
            selectedCheckOut={checkOutDate}
            onDateSelect={onDateSelect}
          />
        </div>
      );
    },
  };
});

import { BookingClient } from "../../booking/[type]/ui/BookingClient";
import { RoomSwitcher } from "./RoomSwitcher";

// The real panels are two prerendered <BookingEngine> trees handed down as
// props from the Server Component. Anything renderable stands in for them
// here: the switcher only ever swaps the nodes it is given.
const panels = {
  room1: <p>room one panel</p>,
  room2: <p>room two panel</p>,
};

// Every fixture day is derived from today so it can never go stale, and every
// one of them sits in *next* month. That month is the right-hand half of the
// two-month calendar, and a day past the 6th can never also appear as a
// trailing cell of the current month's grid, so each aria-label below matches
// exactly one button.
const nextMonth = startOfMonth(addMonths(startOfDay(new Date()), 1));
const dayOfNextMonth = (dayNumber: number): Date => addDays(nextMonth, dayNumber - 1);

// isDateBlocked treats a range as start-inclusive and end-exclusive, so each
// of these blocks three nights and the middle one is what the tests assert on:
// a middle night can never be re-read as a legal check-out, whatever check-in
// happens to be selected.
const room1Blocked: DateRange[] = [{ start: dayOfNextMonth(10), end: dayOfNextMonth(13) }];
const room2Blocked: DateRange[] = [{ start: dayOfNextMonth(20), end: dayOfNextMonth(23) }];

const room1BlockedLabel = format(dayOfNextMonth(11), "MMMM d, yyyy");
const room2BlockedLabel = format(dayOfNextMonth(21), "MMMM d, yyyy");

const room1Props = {
  roomType: "room1" as const,
  blockedDates: room1Blocked,
  defaultCheckIn: toCalendarDay(dayOfNextMonth(2)),
  defaultCheckOut: toCalendarDay(dayOfNextMonth(4)),
  error: null,
  pricing: <div data-testid="room1-pricing">room 1 pricing</div>,
};

const room2Props = {
  roomType: "room2" as const,
  blockedDates: room2Blocked,
  defaultCheckIn: toCalendarDay(dayOfNextMonth(5)),
  defaultCheckOut: toCalendarDay(dayOfNextMonth(7)),
  error: null,
  pricing: <div data-testid="room2-pricing">room 2 pricing</div>,
};

// The calendar renders two months side by side but hides the second one below
// Tailwind's `sm` breakpoint, and every fixture day above is in that second
// month. The default test viewport is narrower than that, so the days would be
// present in the DOM but unclickable.
const widenToDesktop = () => page.viewport(1280, 900);

const room1DefaultCheckInDisplay = format(dayOfNextMonth(2), "d MMM yyyy");
const room2DefaultCheckInDisplay = format(dayOfNextMonth(5), "d MMM yyyy");

test("Room 1's panel is on screen first and Room 2's is not", async () => {
  const { getByText } = await render(<RoomSwitcher {...panels} />);

  await expect.element(getByText("room one panel")).toBeInTheDocument();
  await expect.element(page.getByText("room two panel")).not.toBeInTheDocument();
});

test("clicking the Room 2 tab swaps which panel is rendered", async () => {
  const { getByRole, getByText } = await render(<RoomSwitcher {...panels} />);

  await getByRole("tab", { name: "Room 2" }).click();

  await expect.element(getByText("room two panel")).toBeInTheDocument();
  await expect.element(page.getByText("room one panel")).not.toBeInTheDocument();
});

test("aria-selected follows the active tab", async () => {
  const { getByRole } = await render(<RoomSwitcher {...panels} />);

  await expect
    .element(getByRole("tab", { name: "Room 1" }))
    .toHaveAttribute("aria-selected", "true");
  await expect
    .element(getByRole("tab", { name: "Room 2" }))
    .toHaveAttribute("aria-selected", "false");

  await getByRole("tab", { name: "Room 2" }).click();

  await expect
    .element(getByRole("tab", { name: "Room 1" }))
    .toHaveAttribute("aria-selected", "false");
  await expect
    .element(getByRole("tab", { name: "Room 2" }))
    .toHaveAttribute("aria-selected", "true");
});

// The two tests below use the real BookingClient as each panel, because the
// defect they guard against is invisible with stand-in panels: the switcher
// swaps two nodes of the same component type at the same position, so without
// a key React reconciles them as one instance and updates props, and
// BookingClient reads its availability and its selection from props on mount
// only.
test("switching to Room 2 shows Room 2's blocked dates, not Room 1's", async () => {
  await widenToDesktop();

  const { getByLabelText, getByRole } = await render(
    <RoomSwitcher
      room1={<BookingClient {...room1Props} />}
      room2={<BookingClient {...room2Props} />}
    />,
  );

  await userEvent.click(getByLabelText("Book selected dates"));

  await expect.element(getByLabelText(room1BlockedLabel)).toBeDisabled();
  await expect.element(getByLabelText(room2BlockedLabel)).toBeEnabled();

  await getByRole("tab", { name: "Room 2" }).click();

  // The engine comes back collapsed because it remounted, which is why it has
  // to be expanded a second time.
  await userEvent.click(getByLabelText("Book selected dates"));

  await expect.element(getByLabelText(room2BlockedLabel)).toBeDisabled();
  await expect.element(getByLabelText(room1BlockedLabel)).toBeEnabled();
});

test("a date selected on Room 1 does not survive a switch to Room 2", async () => {
  await widenToDesktop();

  const { getByLabelText, getByRole } = await render(
    <RoomSwitcher
      room1={<BookingClient {...room1Props} />}
      room2={<BookingClient {...room2Props} />}
    />,
  );

  await expect
    .element(getByLabelText("Select check-in date"))
    .toHaveTextContent(room1DefaultCheckInDisplay);

  await userEvent.click(getByLabelText("Book selected dates"));
  await userEvent.click(getByLabelText(format(dayOfNextMonth(15), "MMMM d, yyyy")));
  await userEvent.click(getByLabelText(format(dayOfNextMonth(17), "MMMM d, yyyy")));

  await expect
    .element(getByLabelText("Select check-in date"))
    .toHaveTextContent(format(dayOfNextMonth(15), "d MMM yyyy"));

  await getByRole("tab", { name: "Room 2" }).click();

  await expect.element(page.getByTestId("expanded-engine")).not.toBeInTheDocument();
  await expect
    .element(getByLabelText("Select check-in date"))
    .toHaveTextContent(room2DefaultCheckInDisplay);
  await expect
    .element(getByLabelText("Select check-out date"))
    .toHaveTextContent(format(dayOfNextMonth(7), "d MMM yyyy"));
});
