import { captureException } from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import {
  maskEmail,
  type PreArrivalBookingRow,
  preArrivalWindow,
  selectPreArrivalCandidates,
} from "@/lib/bookings/pre-arrival";
import { toCalendarDay } from "@/lib/date-utils";
import { sendPreArrivalEmail } from "@/lib/resend";
import { createAdminClient } from "@/lib/shared/supabase";

/**
 * Sends each confirmed guest their pre-arrival email two days before check-in.
 *
 * Called by Vercel Cron once a day, on the production deployment only, as a
 * GET with `Authorization: Bearer <CRON_SECRET>`. Hobby cron is best effort
 * (runs can be missed or delivered twice, never retried), so the route
 * reconciles state instead of targeting an instant: see
 * `lib/bookings/pre-arrival.ts` for which bookings are due.
 *
 * Each booking is claimed before it is sent, with an update that only matches
 * while `pre_arrival_email_sent_at` is still null. Two overlapping invocations
 * therefore send at most once: the second one's claim matches zero rows. A
 * failed send releases the claim so the next day's run retries.
 *
 * `?dryRun=1` (still authenticated) lists the candidates with masked emails
 * and neither claims nor sends.
 *
 * Logs carry booking ids only, never a guest's email or name.
 */

const LOG_PREFIX = "[cron/pre-arrival]";
const SENTRY_TAGS = { "cron.job": "pre-arrival" };

type GuestContact = { guest_name: string | null; email: string | null };

type BookingQueryRow = Omit<PreArrivalBookingRow, "guest_name" | "email"> & {
  guest_contacts: GuestContact | GuestContact[] | null;
};

type Outcome = { bookingId: string; checkIn: string };
type Skipped = Outcome & { reason: "too_late" | "no_email" | "already_claimed" };
type Failed = Outcome & { error: string };

// PostgREST returns a many-to-one embed as an object; accept an array too.
function flatten(row: BookingQueryRow): PreArrivalBookingRow {
  const { guest_contacts, ...booking } = row;
  const contact = Array.isArray(guest_contacts) ? guest_contacts[0] : guest_contacts;
  return { ...booking, guest_name: contact?.guest_name ?? null, email: contact?.email ?? null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set; refusing to run" }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = toCalendarDay(new Date());
  const { from, to } = preArrivalWindow(today);
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, room_type, check_in, check_out, status, pre_arrival_email_sent_at, guest_contacts(guest_name, email)",
    )
    .eq("status", "confirmed")
    .is("pre_arrival_email_sent_at", null)
    .gte("check_in", from)
    .lte("check_in", to);

  if (error) {
    console.error(`${LOG_PREFIX} failed to fetch bookings:`, error);
    captureException(error, { tags: { ...SENTRY_TAGS, "db.operation": "select_candidates" } });
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }

  const rows = ((data ?? []) as BookingQueryRow[]).map(flatten);
  const { candidates, tooLate } = selectPreArrivalCandidates(rows, today);

  const sent: Outcome[] = [];
  const skipped: Skipped[] = [];
  const failed: Failed[] = [];

  for (const booking of tooLate) {
    console.log(
      `${LOG_PREFIX} booking ${booking.id}: skipped, check-in ${booking.check_in} is today or past`,
    );
    skipped.push({ bookingId: booking.id, checkIn: booking.check_in, reason: "too_late" });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      today,
      candidates: candidates.map((c) => ({
        bookingId: c.id,
        checkIn: c.check_in,
        email: c.email ? maskEmail(c.email) : null,
      })),
      skipped,
    });
  }

  for (const booking of candidates) {
    const outcome = { bookingId: booking.id, checkIn: booking.check_in };

    if (!booking.email) {
      console.log(`${LOG_PREFIX} booking ${booking.id}: skipped, guest contact has no email`);
      captureException(new Error("Pre-arrival candidate has no email"), {
        tags: SENTRY_TAGS,
        extra: { bookingId: booking.id },
      });
      skipped.push({ ...outcome, reason: "no_email" });
      continue;
    }

    // The claim. `is null` is what makes a duplicate invocation a no-op.
    const { data: claimed, error: claimError } = await supabase
      .from("bookings")
      .update({ pre_arrival_email_sent_at: new Date().toISOString() })
      .eq("id", booking.id)
      .is("pre_arrival_email_sent_at", null)
      .select("id");

    if (claimError) {
      console.log(`${LOG_PREFIX} booking ${booking.id}: failed to claim`);
      captureException(claimError, {
        tags: { ...SENTRY_TAGS, "db.operation": "claim_booking" },
        extra: { bookingId: booking.id },
      });
      failed.push({ ...outcome, error: claimError.message });
      continue;
    }

    if (!claimed || claimed.length === 0) {
      console.log(`${LOG_PREFIX} booking ${booking.id}: skipped, already claimed`);
      skipped.push({ ...outcome, reason: "already_claimed" });
      continue;
    }

    try {
      await sendPreArrivalEmail({
        email: booking.email,
        guestName: booking.guest_name,
        roomType: booking.room_type,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
      });
      console.log(`${LOG_PREFIX} booking ${booking.id}: sent`);
      sent.push(outcome);
    } catch (sendError) {
      console.log(`${LOG_PREFIX} booking ${booking.id}: send failed, releasing claim`);
      captureException(sendError, {
        tags: { ...SENTRY_TAGS, "email.operation": "send_pre_arrival" },
        extra: { bookingId: booking.id },
      });

      const { error: releaseError } = await supabase
        .from("bookings")
        .update({ pre_arrival_email_sent_at: null })
        .eq("id", booking.id);

      if (releaseError) {
        captureException(releaseError, {
          tags: { ...SENTRY_TAGS, "db.operation": "release_claim" },
          extra: { bookingId: booking.id },
        });
      }

      failed.push({ ...outcome, error: errorMessage(sendError) });
    }
  }

  return NextResponse.json({ sent, skipped, failed });
}
