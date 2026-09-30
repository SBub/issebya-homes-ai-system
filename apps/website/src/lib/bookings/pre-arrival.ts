import { addDays } from "date-fns";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";

/**
 * Which bookings are due their pre-arrival email.
 *
 * This reconciles state rather than hitting an instant. Vercel Cron on Hobby
 * fires once a day, somewhere inside the scheduled hour, and may skip or
 * repeat a run, so "send to bookings exactly 48 hours away" would miss guests
 * and email others twice. Instead every run picks up each confirmed booking
 * that has not been emailed yet and whose check-in is tomorrow or the day
 * after. A missed run is caught up the next day, and a booking made inside
 * the window still gets its email.
 *
 * Check-in today (or earlier) is too late: the guest is already on the way,
 * so those rows are reported as skipped and never sent.
 *
 * `today` is a calendar day string. On Vercel the server runs in UTC, so
 * `toCalendarDay(new Date())` there is the UTC day.
 */

export type PreArrivalBookingRow = {
  id: string;
  room_type: string;
  check_in: string; // "yyyy-MM-dd"
  check_out: string; // "yyyy-MM-dd"
  status: string;
  pre_arrival_email_sent_at: string | null;
  guest_name: string | null;
  email: string | null;
};

function dayOffset(today: string, days: number): string {
  return toCalendarDay(addDays(fromCalendarDay(today), days));
}

/**
 * The check-in range the cron route queries: today through today+2. Today is
 * included only so same-day bookings can be logged as too late; past
 * bookings are never fetched.
 */
export function preArrivalWindow(today: string): { from: string; to: string } {
  return { from: today, to: dayOffset(today, 2) };
}

export function selectPreArrivalCandidates(
  rows: PreArrivalBookingRow[],
  today: string,
): { candidates: PreArrivalBookingRow[]; tooLate: PreArrivalBookingRow[] } {
  // "yyyy-MM-dd" strings compare correctly as plain strings.
  const due = new Set([dayOffset(today, 1), dayOffset(today, 2)]);
  const candidates: PreArrivalBookingRow[] = [];
  const tooLate: PreArrivalBookingRow[] = [];

  for (const row of rows) {
    // The query filters these too; this is defence in depth.
    if (row.status !== "confirmed" || row.pre_arrival_email_sent_at !== null) continue;

    if (due.has(row.check_in)) {
      candidates.push(row);
    } else if (row.check_in <= today) {
      tooLate.push(row);
    }
  }

  return { candidates, tooLate };
}

export function firstName(guestName: string | null): string | null {
  const first = guestName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** `anna@example.com` becomes `a***@example.com`. Used only by the dry run. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  return `${email.slice(0, Math.min(1, at))}***${email.slice(at)}`;
}
