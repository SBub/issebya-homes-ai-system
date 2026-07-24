import { createAdminClient } from "./supabase";

// Populates guest_contacts from apps/finance's finance_bookings history
// (name, room, stay dates, stay count, platform) so a human can later fill
// in `phone` manually once they recognize a guest by their WhatsApp number.
// finance_bookings has no phone/email at all — that's the whole reason this
// sync leaves `phone` untouched rather than trying to derive it.
//
// Re-runnable by design (run again after every future CSV import into
// apps/finance): matching against an existing guest_contacts row is done via
// guest_name_normalized (see the schema migration
// supabase/migrations/20260721090350_..._to_guest_contacts.sql for why),
// not a one-off insert.

export interface FinanceBookingRow {
  guest_name: string;
  room: string;
  checkin_date: string;
  checkout_date: string;
  /** finance_bookings.platform — 'airbnb' | 'booking_com' | 'direct'. */
  platform: string;
}

export interface AggregatedGuestContact {
  /** Display name, taken verbatim (original casing) from the most recent booking. */
  guestName: string;
  /** guestName.trim().toLowerCase() — the key bookings are grouped by. */
  guestNameNormalized: string;
  /** Room of the most recent booking (by checkin_date). */
  lastRoom: string;
  /** checkin_date of that same most-recent booking. */
  lastStayCheckin: string;
  /** checkout_date of that same most-recent booking. */
  lastStayCheckout: string;
  /** Count of bookings collapsed into this normalized guest. */
  totalStays: number;
  /** platform of that same most-recent booking (by checkin_date). */
  platform: string;
}

// Pure — no DB access, so this is unit-testable without touching Supabase.
//
// Groups bookings by guest_name.trim().toLowerCase() rather than the raw
// guest_name, because real finance_bookings data already contains
// case-only duplicates for the same person (e.g. "Marion Tremintin" and
// "MARION TREMINTIN" — same room, nearby dates). Grouping by the raw string
// would incorrectly create two guest_contacts rows for one real guest.
//
// Within each group, "most recent" is determined by checkin_date, not by
// input order — callers may pass bookings in any order (e.g. straight off a
// paginated Supabase select), so this must not assume pre-sorted input.
export function aggregateFinanceBookings(bookings: FinanceBookingRow[]): AggregatedGuestContact[] {
  const groups = new Map<string, FinanceBookingRow[]>();

  for (const booking of bookings) {
    const normalized = booking.guest_name.trim().toLowerCase();
    const group = groups.get(normalized);
    if (group) {
      group.push(booking);
    } else {
      groups.set(normalized, [booking]);
    }
  }

  const result: AggregatedGuestContact[] = [];
  for (const [guestNameNormalized, groupBookings] of groups) {
    const mostRecent = groupBookings.reduce((latest, current) =>
      current.checkin_date > latest.checkin_date ? current : latest,
    );
    result.push({
      guestName: mostRecent.guest_name,
      guestNameNormalized,
      lastRoom: mostRecent.room,
      lastStayCheckin: mostRecent.checkin_date,
      lastStayCheckout: mostRecent.checkout_date,
      totalStays: groupBookings.length,
      platform: mostRecent.platform,
    });
  }

  return result;
}

export interface FinanceSyncSummary {
  created: number;
  updated: number;
  guests: string[];
}

// Orchestration: reads finance_bookings, aggregates it, then upserts
// guest_contacts by guest_name_normalized (plain equality lookup, not a
// DB-level ON CONFLICT — see the migration comment for why). `phone` is
// never written here; it stays null on insert and untouched on update, to be
// filled in manually later.
//
// Uses createAdminClient() (service-role key, bypasses RLS) to read
// finance_bookings even though GCA doesn't own that table. This is a
// deliberate, narrow exception for this cross-cutting sync job only — not a
// general pattern for GCA code to reach into other apps' tables.
export async function syncGuestContactsFromFinance(): Promise<FinanceSyncSummary> {
  const supabase = createAdminClient();

  const { data: bookings, error: bookingsError } = await supabase
    .from("finance_bookings")
    .select("guest_name, room, checkin_date, checkout_date, platform");
  if (bookingsError) throw bookingsError;

  const aggregated = aggregateFinanceBookings(bookings ?? []);

  let created = 0;
  let updated = 0;
  const guests: string[] = [];

  for (const guest of aggregated) {
    const { data: existing, error: lookupError } = await supabase
      .from("guest_contacts")
      .select("id")
      .eq("guest_name_normalized", guest.guestNameNormalized)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
      const { error: updateError } = await supabase
        .from("guest_contacts")
        .update({
          guest_name: guest.guestName,
          last_room: guest.lastRoom,
          last_stay_checkin: guest.lastStayCheckin,
          last_stay_checkout: guest.lastStayCheckout,
          total_stays: guest.totalStays,
          platform: guest.platform,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updateError) throw updateError;
      updated++;
    } else {
      const { error: insertError } = await supabase.from("guest_contacts").insert({
        guest_name: guest.guestName,
        guest_name_normalized: guest.guestNameNormalized,
        last_room: guest.lastRoom,
        last_stay_checkin: guest.lastStayCheckin,
        last_stay_checkout: guest.lastStayCheckout,
        total_stays: guest.totalStays,
        platform: guest.platform,
      });
      if (insertError) throw insertError;
      created++;
    }

    guests.push(guest.guestName);
  }

  return { created, updated, guests };
}
