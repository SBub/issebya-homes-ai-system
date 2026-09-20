import { addDays, addMonths, format, startOfMonth } from "date-fns";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { toCalendarDay } from "@/lib/date-utils";
import type { DateRange } from "@/lib/shared/types/booking";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

// The last test mounts the real booking engine rather than a stand-in, so it
// needs the same seams the engine's own tests use: Sentry, the search params
// the engine reads on mount, and the booking Server Action, which cannot load
// in the browser pool.
vi.mock("../../../../lib/sentry-booking", () => ({
  setBookingContext: vi.fn(),
  addBookingBreadcrumb: vi.fn(),
  captureBookingError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../../booking/[type]/actions", () => ({
  submitBooking: vi.fn(),
}));

import { BookingClient } from "../../booking/[type]/ui/BookingClient";
import { RoomSwitcher } from "./RoomSwitcher";

// The real panels are two prerendered <BookingEngine> trees handed down as
// props from the Server Component. Anything renderable stands in for them
// here: the switcher only ever swaps the nodes it is given.
const panels = {
  room1: <p>room one panel</p>,
  room2: <p>room two panel</p>,
};

test("room 1's panel is on screen first and room 2's is not", async () => {
  const { getByText } = await render(<RoomSwitcher {...panels} />);

  await expect.element(getByText("room one panel")).toBeInTheDocument();
  await expect.element(page.getByText("room two panel")).not.toBeInTheDocument();
});

test("clicking the room 2 tab swaps which panel is rendered", async () => {
  const { getByRole, getByText } = await render(<RoomSwitcher {...panels} />);

  await getByRole("tab", { name: "room 2" }).click();

  await expect.element(getByText("room two panel")).toBeInTheDocument();
  await expect.element(page.getByText("room one panel")).not.toBeInTheDocument();
});

test("aria-selected follows the active tab", async () => {
  const { getByRole } = await render(<RoomSwitcher {...panels} />);

  await expect
    .element(getByRole("tab", { name: "room 1" }))
    .toHaveAttribute("aria-selected", "true");
  await expect
    .element(getByRole("tab", { name: "room 2" }))
    .toHaveAttribute("aria-selected", "false");

  await getByRole("tab", { name: "room 2" }).click();

  await expect
    .element(getByRole("tab", { name: "room 1" }))
    .toHaveAttribute("aria-selected", "false");
  await expect
    .element(getByRole("tab", { name: "room 2" }))
    .toHaveAttribute("aria-selected", "true");
});

// Everything below drives the real composition. Stand-in panels hold no state,
// so they cannot tell a remount apart from a props update, which is exactly
// how a switcher that never switched passed the three tests above.

// The calendar draws the month it opens on plus the following one, and it
// opens on the first month with any free day, which is this one. Next month is
// therefore always drawn, always in the future, and never goes stale.
const NEXT_MONTH = startOfMonth(addMonths(new Date(), 1));
const nextMonthDay = (dayOfMonth: number) => addDays(NEXT_MONTH, dayOfMonth - 1);
const nextMonthLabel = (dayOfMonth: number) => format(nextMonthDay(dayOfMonth), "MMMM d, yyyy");

// Mid-month on purpose. The drawn grids spill up to six days into the
// neighbouring months, so a day near either end of next month can appear
// twice on screen and leave the locator ambiguous.
const ROOM1_BLOCKED: DateRange[] = [{ start: nextMonthDay(9), end: nextMonthDay(12) }];
const ROOM2_BLOCKED: DateRange[] = [{ start: nextMonthDay(15), end: nextMonthDay(18) }];
const ROOM1_BLOCKED_DAY = 10;
const ROOM2_BLOCKED_DAY = 16;

// Each room gets its own default nights, clear of both blocked windows, the
// way the server computes them per room.
function roomPanel(roomType: "room1" | "room2") {
  const isRoom1 = roomType === "room1";

  return (
    <BookingClient
      roomType={roomType}
      blockedDates={isRoom1 ? ROOM1_BLOCKED : ROOM2_BLOCKED}
      defaultCheckIn={toCalendarDay(nextMonthDay(isRoom1 ? 1 : 25))}
      defaultCheckOut={toCalendarDay(nextMonthDay(isRoom1 ? 3 : 27))}
      error={null}
      pricing={<div data-testid="mock-pricing" />}
    />
  );
}

test("switching rooms shows the new room's availability, not the previous room's", async () => {
  const { getByLabelText, getByRole } = await render(
    <RoomSwitcher room1={roomPanel("room1")} room2={roomPanel("room2")} />,
  );

  await userEvent.click(getByLabelText("Book selected dates"));
  await expect.element(getByLabelText("Confirm booking")).toBeInTheDocument();

  // Room 2's blocked window is free for room 1.
  const blockedForRoom2 = getByLabelText(nextMonthLabel(ROOM2_BLOCKED_DAY));
  await expect.element(blockedForRoom2).toBeEnabled();
  await expect.element(blockedForRoom2).not.toHaveClass("calendar-date-blocked");

  await getByRole("tab", { name: "room 2" }).click();

  // The engine remounted, so it is back at room 2's own defaults with room 1's
  // open calendar and selection gone.
  await expect.element(page.getByLabelText("Confirm booking")).not.toBeInTheDocument();
  await expect.element(getByLabelText("Book selected dates")).toBeInTheDocument();

  await userEvent.click(getByLabelText("Book selected dates"));

  // Room 2's own blocked window is now the one on screen, and room 1's is free.
  await expect.element(getByLabelText(nextMonthLabel(ROOM2_BLOCKED_DAY))).toBeDisabled();
  await expect
    .element(getByLabelText(nextMonthLabel(ROOM2_BLOCKED_DAY)))
    .toHaveClass("calendar-date-blocked");

  const blockedForRoom1 = getByLabelText(nextMonthLabel(ROOM1_BLOCKED_DAY));
  await expect.element(blockedForRoom1).toBeEnabled();
  await expect.element(blockedForRoom1).not.toHaveClass("calendar-date-blocked");
});
