# Refactor: Return Individual Bookings from `/api/availability`

## Problem

`GET /api/availability?room=X` currently merges all bookings — from iCal feeds (Airbnb, VRBO, Booking.com) and own Supabase bookings — into a single array of consolidated date windows via `mergeDateRanges`. Adjacent or overlapping bookings are collapsed into one larger range.

This makes the route usable for the calendar UI but unusable for any system that needs to know individual booking boundaries (check-in / check-out per booking).

## Goal

- Route returns individual, unmerged bookings from all sources
- Calendar UI continues to receive merged date ranges (aggregation moves to the hook)
- No change to the external API surface (same path, same query params)

## Response shape change

**Before:**

```json
{
  "blockedDates": [{ "start": "2026-07-01T00:00:00.000Z", "end": "2026-07-10T00:00:00.000Z" }]
}
```

Two adjacent bookings (Jul 1–5 and Jul 5–10) merged into one.

**After:**

```json
{
  "bookings": [
    { "start": "2026-07-01T00:00:00.000Z", "end": "2026-07-05T00:00:00.000Z" },
    { "start": "2026-07-05T00:00:00.000Z", "end": "2026-07-10T00:00:00.000Z" }
  ]
}
```

Each booking from each source is a separate entry.

## Affected files

### `packages/shared/src/types/booking.ts`

Update `AvailabilityData`:

```typescript
// Before
export type AvailabilityData = {
  blockedDates: DateRange[];
  error?: string;
};

// After
export type AvailabilityData = {
  bookings: DateRange[];
  error?: string;
};
```

### `src/lib/ical-parser.ts`

`mergeMultipleFeeds` currently calls `mergeDateRanges` internally (line 105). Remove that call — return raw extracted dates.

```typescript
// Before
const blockedDates = extractBlockedDates(allEvents);
const merged = mergeDateRanges(blockedDates);
return { blockedDates: merged, errors };

// After
const bookings = extractBlockedDates(allEvents);
return { bookings, errors };
```

Rename the returned field from `blockedDates` to `bookings` to match the new semantics.

### `src/app/api/availability/route.ts`

1. Update destructuring from `mergeMultipleFeeds` result: `blockedDates` → `bookings`
2. Remove the `mergeDateRanges` call that combines iCal + own bookings
3. Return `bookings` (flat concat of iCal bookings + own bookings) instead of `blockedDates`
4. Update cache type and `responseData` shape accordingly

```typescript
// Before
const { blockedDates: icalBlockedDates, errors } = icalResult;
const blockedDates = mergeDateRanges([...icalBlockedDates, ...ownBookings]);
return NextResponse.json({ blockedDates });

// After
const { bookings: icalBookings, errors } = icalResult;
const bookings = [...icalBookings, ...ownBookings];
return NextResponse.json({ bookings });
```

No sorting needed — callers decide if they need sorted output.

### `src/app/(main)/booking/[type]/hooks/useAvailabilityQuery.ts`

This is the only UI consumer. It must now do the merge itself before passing dates to the calendar.

1. Import `mergeDateRanges` from `@/lib/date-utils`
2. Update `AvailabilityResponse` type: `blockedDates` → `bookings`
3. After parsing dates from the response, call `mergeDateRanges` before assigning to `blockedDates`

```typescript
// Before
type AvailabilityResponse = {
  blockedDates: { start: string; end: string }[];
  error?: string;
};

// and in queryFn:
const blockedDates = data.blockedDates.map((range) => ({
  start: new Date(range.start),
  end: new Date(range.end),
}));

// After
type AvailabilityResponse = {
  bookings: { start: string; end: string }[];
  error?: string;
};

// and in queryFn:
import { mergeDateRanges } from "@/lib/date-utils";

const rawBookings = data.bookings.map((range) => ({
  start: new Date(range.start),
  end: new Date(range.end),
}));
const blockedDates = mergeDateRanges(rawBookings);
```

The rest of the hook is unchanged — it still exposes `blockedDates` to the calendar.

## Cache update

`route.ts` has an in-memory cache typed as `{ data: { blockedDates: DateRange[] } }`. Update to `{ data: { bookings: DateRange[] } }`.

## What does NOT change

- Route path: `GET /api/availability?room=X`
- Query params: `room`, `fresh`
- Cache TTL (1 hour)
- `DateRange` type (`{ start: Date, end: Date }`)
- `getOwnBookings` — still queries `booking_availability` for `check_in` / `check_out`
- Calendar UI behaviour — `useAvailabilityQuery` still exposes merged `blockedDates`
- `findFirstAvailableNights` still operates on merged dates in the hook

## Notes

- iCal events have date precision only (all-day events). `dtstart` maps to check-in date, `dtend` maps to check-out date. No time-of-day is available from external channels — this is a platform limitation, not a code gap.
- Own bookings from `booking_availability` are stored as `check_in` / `check_out`. If the DB columns are `date` (not `timestamp`), times will also be midnight. The spec does not change column types.
- External systems consuming `/api/availability` directly will need to handle the renamed field (`bookings` instead of `blockedDates`).
