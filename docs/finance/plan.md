# Finance domain — implementation plan

Status: planning only, nothing in this doc is built yet. Written after a research pass
across `issebya-homes-website/apps/finance` (existing code) and real Airbnb/Booking.com
invoices/CSVs the user supplied. See `modelo-30-filing.md` and `invoices-filing.md` for
the filing-specific reference data (formulas, tax IDs, sources) this plan depends on.

## Scope recap

Three concerns that got conflated at the start of this conversation, now kept separate:

1. **Finance Tool** (`Tools > FIN` in `agent-architecture.mmd`) — feeds Orch-A's existing
   daily heartbeat digest. Small, simple: reads `finance_bookings` for a revenue/payout
   snapshot. Currently a stub (`src/tools/finance.ts`).
2. **Revenue predictability** — a forward-looking occupancy signal, 60 days from the end
   of the current month, meant to eventually inform Decide/Dispatch (not in v0.1.0 —
   nothing to dispatch to yet per spec). Reuses the same booking-calendar data
   `src/tools/availability.ts` already fetches; this is a new computation, not a new data
   source.
3. **Finance Cron Jobs** (`FinanceCron` subgraph) — monthly Modelo 30 + invoice-info
   report, quarterly tourist tax, both driven by CSVs uploaded once a month. Separate
   cadence, separate purpose, separate build track from (1) and (2) — confirmed by the
   diagram already modeling it this way before this conversation started.

Explicitly out of scope for v0.1.0 (per prior discussion, unchanged):
- Notification Center (reminders, "keep nagging until done") — diagrammed, not built.
- RFI-21 annual Airbnb form — Notification Center's job, later.
- Any automation of the actual government-portal filing steps (Modelo 30 submission,
  Portal das Finanças invoice creation, tourist tax portal upload) — those stay manual,
  human-performed. We produce the data/report; the user files it themselves.

## Where logic lives: finance app, not Orch-A

Orch-A reads, never writes (explicit user constraint). The existing finance app
(`issebya-homes-website/apps/finance`) already owns all tax/business logic for this
domain (tourist tax formula, VAT-inclusive fee math, CSV parsing) — new Modelo 30 and
invoice computation logic should live there too, as new **read-only** endpoints, not be
duplicated inside Orch-A. Orch-A's job stays: call an endpoint, format the result,
deliver via Telegram, same pattern as Availability today.

This means two repos are involved:
- `issebya-homes-website/apps/finance` — schema changes, parser changes, new endpoints,
  new upload page. (Cross-repo: none of this is buildable from within
  `issebya-homes-ai-system`.)
- `issebya-homes-ai-system` — new Orch-A workflows/entrypoints that call those endpoints
  and deliver to Telegram, plus the Availability revenue-predictability extension (local,
  no cross-repo dependency).

## Changes needed in `apps/finance`

### 1. Schema: `finance_bookings` needs a new field

Airbnb attributes its commission invoice to the **`Booked` date** (reservation-creation
date), not check-in or check-out — confirmed by matching an actual Airbnb VAT invoice's
date to a booking's `Booked` column (see `modelo-30-filing.md`). This date isn't
currently captured anywhere in `finance_bookings` (only `checkin_date`/`checkout_date`
exist). Needs a new column, e.g. `booked_date`, populated from the Airbnb CSV's `Booked`
column. Booking.com already has `checkin_date`/`checkout_date` and uses `checkout_date`
for its own invoice attribution (stated explicitly on its invoices) — no new column
needed on that side.

### 2. Airbnb parser fixes

Current parser (`parsers.ts`) targets the "Earnings"/Transaction-History export and
hardcodes `guests = 2` (documented limitation). The CSV format the user is actually
uploading (`Confirmation code, Status, Guest name, Contact, # of adults, # of children,
# of infants, Start date, End date, # of nights, Booked, Listing, Earnings`) has real
guest counts (`# of adults + # of children`, infants presumably excluded from the
tourist-tax/Modelo-30 guest count) and a `Booked` date — but only a single `Earnings`
figure, no separate commission/fee columns. Needs:
- Sum `# of adults + # of children` for `guests` instead of hardcoding 2.
- Capture `Booked` into the new `booked_date` field.
- Derive `platform_fee` and `gross_room_income` from `Earnings` alone using the verified
  formula in `modelo-30-filing.md` (`room_fee = Earnings / 0.9631`), rather than reading
  them as direct CSV columns like the old parser did.

### 3. Booking.com parser — mostly fine, one thing to verify

Existing parser already reads `Commission amount` + `Payment fee` for `platform_fee`,
and `Persons` for guest count — matches the new CSV header list given
(`"Reservation number","Invoice number","Booked on","Arrival","Departure","Booker
name","Guest name","Rooms","Persons","Room nights","Commission %","Original
amount","Final amount","Commission amount","Payment fee","Status","Guest
request","Currency","Hotel id","Property name","City","Country"`). One thing not yet
verified against a real CSV row: which of `Original amount` / `Final amount` is the
correct `gross_room_income` (what the guest paid) — the invoice shows `Room Sales`
matching what's presumably one of these two columns, but a real sample row is needed to
confirm which, in case a booking was modified/discounted after original creation.

### 4. Modelo 30 endpoint (new)

`GET /api/finance/modelo30?month=&year=` — read-only, same auth pattern as
`/tourist-tax`. Per-platform breakdown (not combined — see `modelo-30-filing.md`):
- Airbnb: sum `booked_date` in the target month, base commission per booking =
  `(Earnings / 0.9631) × 0.03` (VAT already excluded by this formula).
- Booking.com: sum `checkout_date` in the target month, base commission = `Commission
  amount` directly (reverse-charge invoice — already VAT-exclusive, confirmed from a
  real Booking.com invoice's own wording).
- Output: `{ airbnb: { total, count }, booking_com: { total, count } }` for the month,
  plus enough per-booking detail to sanity-check the sum if needed.

### 5. Invoices endpoint (new)

`GET /api/finance/invoices?month=&year=` — read-only. For every reservation in the
month (both platforms), return `{ guest_name, checkin_date, checkout_date, room,
guest_paid }`. `guest_paid` computed per-platform per `invoices-filing.md`'s formulas.
Same monthly cadence as Modelo 30 (confirmed).

### 6. CSV upload page (new)

Hermes (the previous automation agent that ran the upload on the user's behalf) is
confirmed no longer running — a real gap, not optional. No existing admin dashboard to
extend (`crm-dashboard` is a different app/stack/backend entirely; the admin MCP server
was deleted from the repo and wouldn't fit browser file uploads regardless). Plan: one
new page directly in `apps/finance` (`src/app/upload/page.tsx`) — two file inputs
(Airbnb CSV, Booking.com CSV — "should support 2 of these csv uploads" — both required,
this is not a shared endpoint accepting either/or ambiguously), a text field for
`FINANCE_API_KEY` (reused as the form's password, no new auth system), submits to
`POST /api/finance/import`. Needs to support **historical backfill** — uploading
multiple months at once (Jan–Jul 2026, per the user's stated need) — the import endpoint
already upserts on `booking_id` so re-running/multi-month uploads should already be safe;
the page itself doesn't need month-range logic, just accepts whatever date range the
CSV export covers.

## Changes needed in `issebya-homes-ai-system` (this repo)

### 1. Revenue predictability (Availability extension)

New computation alongside the existing 30-day metric in `src/tools/availability.ts` (or
a new module) — occupancy over a 60-day window starting at the end of the current
calendar month (confirmed: not a rolling 60 days from today). Reuses the existing
`countOccupiedNights` logic, just a different window. Not wired into the daily digest
yet (no Decide/Dispatch consumer exists this version) — built as a standalone, tested
function ready for when it's needed, per the user's framing of this as forward-looking
infrastructure rather than an immediate digest change.

### 2. Finance Tool (daily digest) — swap stub for real read

`src/tools/finance.ts` currently stubs `room1`/`room2` sample data. Swap for a real call
to `GET /api/finance/bookings` (already deployed, confirmed working), same pattern as the
Availability integration. Small, low-risk, independent of everything else in this plan.

### 3. New scheduled entrypoints for Modelo 30 / invoices / tourist tax

Each needs its own cron trigger, separate from the daily heartbeat (`src/run.ts`) — a
monthly Modelo 30 + invoices run, and a quarterly tourist-tax run. Structurally: new
Mastra workflows (mirroring `heartbeat-workflow.ts`'s shape) plus new entrypoint scripts
(mirroring `src/run.ts`), each calling the relevant finance-app endpoint, formatting a
Telegram message (tourist tax also attaches the XLSX — see below), and delivering.
**Blocked on the still-open spec question**: where this actually deploys / what external
scheduler triggers these on the right cadence. Not resolved in this doc.

### 4. Tourist tax XLSX

Sheet 1 (Date/Room/Total nights paid/People/Total) reuses the existing, working CSV
logic verbatim from `GET /api/finance/tourist-tax` — just needs XLSX-wrapping instead of
CSV. Sheet 2 (Período / Agente económico / Unidade de alojamento) is new: mostly static
host/property fields from the user's screenshot (NIF, RNT, address, etc. — treated as
fixed config unless told otherwise) plus a computed `Período` string for the quarter
being filed. Needs an XLSX-generation library (e.g. `exceljs`) added as a dependency.
This generation step happens in Orch-A (reads the raw quarter data, assembles the file,
sends via Telegram), not in the finance app — keeps the finance app's API surface as
plain data, keeps "assemble the filing document" as a reporting/delivery concern.

## Known open risks / unverified assumptions

- Booking.com `Original amount` vs `Final amount` — which is `gross_room_income` /
  guest-paid, not yet confirmed against a real CSV row.
- Airbnb guest-paid formula (16.8% guest fee) verified against only 2 bookings — strong
  match (to the cent) but a third data point would firm this up further.
- Both platforms' guest/host fee structure is specific to the *current* pricing model.
  Airbnb is retiring split-fee pricing for EU hosts on **October 13, 2026** — all Airbnb
  fee formulas in this plan need revisiting after that date.
- Deployment/scheduling infrastructure for the new cron entrypoints is still an open
  spec question (same one flagged in `spec-v0.1.0.md`'s Open Questions).
