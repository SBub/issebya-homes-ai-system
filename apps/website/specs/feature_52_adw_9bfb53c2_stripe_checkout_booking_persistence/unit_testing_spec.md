# Unit Testing Spec: Stripe Checkout, Booking Persistence, Confirmation Email, and Internal iCal

## Test Scope

### In Scope

- `src/lib/ical-generator.ts` — `generateICalFeed`: pure string generation from booking records
- `src/lib/resend.ts` — `sendBookingConfirmationEmail`: email composition (mock Resend SDK)
- `src/app/api/checkout/create/route.ts` — POST handler: request validation (missing fields, invalid dates, invalid roomType)
- `src/app/api/webhook/stripe/route.ts` — POST handler: signature verification, event handling, database insert (mock Stripe + Supabase)
- `src/app/api/ical/[room]/route.ts` — GET handler: room param validation, response content type

---

## New Unit Tests

### Test Files to Create

- `src/lib/ical-generator.unit.test.ts`
- `src/lib/resend.unit.test.ts`
- `src/app/api/checkout/create/route.unit.test.ts`
- `src/app/api/webhook/stripe/route.unit.test.ts`
- `src/app/api/ical/[room]/route.unit.test.ts`

---

### Coverage Areas

- iCal string generation: VCALENDAR structure, VEVENT per booking, date formatting
- Email HTML composition: subject, booking details present in HTML
- Checkout route: Zod validation, date guard, Stripe call shape
- Webhook route: signature failure → 400; unknown event → 200; completed event → DB insert + email
- iCal route: invalid room → 400; valid room → `text/calendar` content type

---

### Test Cases

#### `generateICalFeed` (`src/lib/ical-generator.ts`)

**Purpose**: Converts an array of booking records into a valid `.ics` string.

**Test Cases**:

- With 0 bookings: output contains `BEGIN:VCALENDAR` and `END:VCALENDAR`, no `BEGIN:VEVENT`
- With 1 booking: output contains exactly one `BEGIN:VEVENT`/`END:VEVENT` pair; `DTSTART;VALUE=DATE` uses YYYYMMDD format; `UID` is `[access_token]@issebya.homes`; `DTSTAMP` is in UTC format
- With 2 bookings: output contains two VEVENT blocks
- PRODID line is present: `-//Issebya Homes//Booking Calendar//EN`
- SUMMARY contains the first 8 chars of access_token: `Booking [tokenPrefix]`
- DTEND uses the check_out date in YYYYMMDD format

#### `sendBookingConfirmationEmail` (`src/lib/resend.ts`)

**Purpose**: Composes and sends an HTML confirmation email via Resend SDK.

**Test Cases**:

- Mock Resend SDK's `emails.send`; verify it is called with `subject: 'Booking Confirmed – Issebya Homes'`
- HTML body contains the room type label (e.g., "Room 1")
- HTML body contains formatted check-in and check-out dates
- HTML body contains the total amount
- HTML body contains a link to `/booking/confirmation?session=...`
- Throws if `RESEND_API_KEY` is missing (Resend constructor error)

#### `POST /api/checkout/create` (`src/app/api/checkout/create/route.ts`)

**Purpose**: Validates request body and creates a Stripe Checkout session.

**Test Cases**:

- Missing `roomType` field → 400 with validation error
- Missing `email` field → 400 with validation error
- Missing `checkIn` field → 400 with validation error
- Invalid `roomType` (e.g., `"house"`) → 400 with validation error
- Invalid date format for `checkIn` (e.g., `"10-07-2026"`) → 400 with validation error
- `checkOut` before `checkIn` → 400 with validation error
- Past `checkIn` date → 400
- Valid request with mocked Stripe → 200 with `{ url: "https://checkout.stripe.com/..." }`
- Stripe session created with correct `metadata` (roomType, checkIn, checkOut, personCount, email, nights, basePrice, touristTax, total as strings)
- `success_url` contains `/booking/confirmation?session={CHECKOUT_SESSION_ID}`
- `cancel_url` contains `/booking/room1` for roomType room1

#### `POST /api/webhook/stripe` (`src/app/api/webhook/stripe/route.ts`)

**Purpose**: Verifies Stripe webhook signature and persists confirmed bookings.

**Test Cases**:

- Missing `stripe-signature` header → 400
- Invalid signature (constructEvent throws) → 400
- Unknown event type (e.g., `payment_intent.created`) → 200 with `{ received: true }` (no DB insert)
- `checkout.session.completed` with null metadata → 200 (logs error, no insert)
- `checkout.session.completed` with valid metadata → inserts correct row into `bookings` table (mock admin client)
- `checkout.session.completed` with valid metadata → calls `sendBookingConfirmationEmail` with correct args
- Duplicate session (DB returns unique constraint error code `23505`) → 200 (no 500 error)
- Email sending failure → still returns 200 (email errors are non-fatal)

#### `GET /api/ical/[room]` (`src/app/api/ical/[room]/route.ts`)

**Purpose**: Serves `.ics` feed for a room's confirmed bookings.

**Test Cases**:

- `room = 'invalid'` → 400 response
- `room = 'room1'` with mocked Supabase returning empty array → 200, `Content-Type: text/calendar; charset=utf-8`, body contains `BEGIN:VCALENDAR`
- `room = 'room2'` with mocked Supabase returning 1 booking → body contains `BEGIN:VEVENT`
- Supabase error → 500 response

---

## Failed/Broken Tests (if applicable)

No existing unit tests are expected to break from this implementation. The changes to existing files are:

- `src/schemas/booking.ts` — added `checkoutSchema` (additive, no removal)
- `src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` — client component (not in unit test scope)
- `src/app/(main)/booking/[type]/ui/BookingEngine.tsx` — client component (not in unit test scope)
- `src/app/api/availability/route.ts` — added internal iCal URL to feed list (no schema changes)

### Validation Command

`yarn test:unit` or `npx vitest --project=unit`
