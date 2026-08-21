# Feature: Stripe Checkout, Booking Persistence, Confirmation Email, and Internal iCal

## Metadata

issue_number: `52`
adw_id: `9bfb53c2`
issue_json: `{"number":52,"title":"Continue Booking Flow with Stripe Checkout, Confirmation Email, and Booking Persistence","body":"Extend the booking flow with redirect users to Stripe Checkout, display booking details, and finalize the reservation after successful payment.\n\nUser Flow\n\t1.\tUser selects check-in and check-out dates, adjust amount of people\n\t2.\tUser clicks Book.\n\t3.\tUser is redirected to Stripe Checkout showing booking summary.\n\t4.\tAfter successful payment:\n\t•\tBooking is stored in the database.\n\t•\tConfirmation email is sent.\n\t•\tBooking is added to internal iCal (internal iCal should be hosted on the website)\n\nStripe Checkout Requirements\n\nStripe Checkout page should display:\n\t•\tSelected room image\n\t•\tNumber of guests\n\t•\tCheck-in and check-out dates\n\t•\tTotal price\n\t•\tPrice breakdown:\n\t•\tRoom price\n\t•\tTourist tax\n\nPost-Payment Behavior\n\t•\tPersist booking in database (based on existing booking table fields).\n\t•\tGenerate unique token for booking retrieval.\n\t•\tSend confirmation email via Resend containing:\n\t•\t   Reservation details\n\t•\t   Link to preview reservation using token.\n\t•\tCreate iCal entry for the booking.\n\nEnvironment Configuration\n\t•\tDevelopment: Stripe test environment\n\t•\tProduction: Stripe live environment"}`

## Feature Description

This feature extends the existing booking flow to complete the payment lifecycle. Currently, users can select dates and see pricing in the booking engine, but clicking "book" does nothing. This feature connects the booking engine to Stripe Checkout, persists confirmed bookings in the database, sends confirmation emails via Resend, and adds bookings to an internally hosted iCal feed that can be consumed by external calendars (Airbnb, Booking.com, etc.).

The feature covers:

1. **Stripe Checkout session creation** — a new API route creates a Stripe Checkout session with line items for room price and tourist tax, embedded booking metadata (dates, guests, room type), and a room image.
2. **Stripe webhook handling** — listens for `checkout.session.completed` events to trigger post-payment actions.
3. **Booking persistence** — saves confirmed bookings to a new `bookings` table in Supabase with a unique access token for retrieval.
4. **Confirmation email** — sends an HTML email via Resend with full reservation details and a link to view the booking.
5. **Internal iCal hosting** — serves a dynamically generated iCal feed per room at `/api/ical/[room]` so that bookings made through this website are reflected on external platforms.
6. **Booking confirmation page** — users land on `/booking/confirmation/[token]` after payment, displaying their reservation details.

## User Story

As a guest
I want to pay for my selected dates via Stripe Checkout and immediately receive confirmation
So that my booking is secured and I have proof of my reservation with all the details

## Problem Statement

The booking engine shows dates, pricing and a "book" button, but clicking it does nothing — there is no payment pathway, no booking record is stored, and no confirmation is sent. Guests who want to book directly through the website have no way to complete a reservation.

## Solution Statement

Implement a complete payment and post-payment pipeline:

- Create a Stripe Checkout session via a new API route (`/api/checkout/create`) that embeds booking metadata and passes a room image.
- After successful payment, Stripe sends a webhook to `/api/webhook/stripe` which stores the booking in Supabase, sends a confirmation email via Resend, and the booking becomes available in the internal iCal feed.
- The user is redirected to `/booking/confirmation/[token]` where they can see full reservation details.
- An internal iCal route at `/api/ical/[room]` generates a `.ics` feed from confirmed bookings so the room's availability is always up-to-date across all platforms.

This is not an admin feature — no Radix UI components are required beyond what already exists in the UI.

## Visual Requirements from Mockup

No mockups provided in issue. The issue describes functional requirements only.

---

## Relevant Files

### Existing Files to Modify

- `src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` — The "book" button's `handleBook` callback currently only `console.log`s. This must be wired to call the Stripe checkout API and redirect.
- `src/app/(main)/booking/[type]/ui/BookingEngineCollapsed.tsx` — Minor: the outer "book" button may also need to open the expanded engine first (already handled by `onExpand`, no change needed).
- `src/types/booking.ts` — Already has a `Booking` type with `payment_intent`, `email`, `status` etc. fields. The existing `Booking` type maps closely to the new `bookings` database table.
- `src/schemas/booking.ts` — May need a new Zod schema for the checkout API request payload.
- `src/lib/ical-parser.ts` — Already has iCal parsing utilities. The internal iCal generator can reuse date formatting patterns.
- `src/app/api/availability/route.ts` — The internal iCal feed from `/api/ical/[room]` must be added to `ROOM_ICAL_FEEDS` so the website's own bookings block off dates.

### New Files to Create

- `src/app/api/checkout/create/route.ts` — API route: creates Stripe Checkout session with line items, metadata, room image, and success/cancel redirect URLs.
- `src/app/api/webhook/stripe/route.ts` — API route: receives Stripe webhook events, verifies signature, handles `checkout.session.completed` to persist booking and trigger side effects.
- `src/app/api/ical/[room]/route.ts` — API route: generates and serves a `.ics` iCal feed for each room (room1, room2) from confirmed bookings in the database.
- `src/app/(main)/booking/confirmation/[token]/page.tsx` — Server component: booking confirmation page shown after successful payment, fetches booking by token and displays reservation details.
- `src/app/(main)/booking/confirmation/[token]/ui/BookingConfirmationDetails.tsx` — Server component: renders the confirmed booking details (dates, guests, room, price breakdown, access token link).
- `src/lib/resend.ts` — Email sending utility wrapping the Resend SDK for sending confirmation emails.
- `src/lib/ical-generator.ts` — Utility to generate iCal (`.ics`) strings from booking records.
- `src/lib/stripe.ts` — Stripe client singleton (server-side only).
- `specs/feature_52_adw_9bfb53c2_stripe_checkout_booking_persistence/e2e_testing_spec.md` — E2E test spec.
- `specs/feature_52_adw_9bfb53c2_stripe_checkout_booking_persistence/unit_testing_spec.md` — Unit test spec.

### Reference Files

- `src/lib/supabase.ts` — Supabase client factory (`createClient`, `createAdminClient`).
- `src/lib/price-utils.ts` — Price calculation utilities (`calculateTotalPrice`, `calculateNights`, `calculateTouristTax`).
- `src/lib/pricing.ts` — Pricing constants (`ROOM_PRICING`).
- `src/lib/validation.ts` — Zod error formatting (`formatZodErrors`).
- `src/lib/date-utils.ts` — Date utilities for iCal feed processing.
- `src/utils/images.ts` — Room image arrays (`room1Images`, `room2Images`).
- `src/app/api/bookings/custom/route.ts` — Reference for existing booking creation pattern.
- `app_docs/database/database-interaction-rules.md` — Database interaction patterns.
- `app_docs/dynamic-url-construction.md` — URL construction rules (derive origin from request).
- `app_docs/environment-setup.md` — Environment variable documentation rules.
- `app_docs/nextjs-patterns-guide.md` — Next.js route and page patterns.
- `app_docs/testing/unit_test_spec_format.md` — Unit test specification format.
- `app_docs/testing/e2e_example.md` — E2E test format example.
- `app_docs/testing/e2e_runner.md` — E2E test execution guide.
- `vitest.config.ts` — Test configuration and patterns.

---

## Implementation Plan

### Phase 1: Foundation

Set up the new `bookings` table in Supabase, configure Stripe environment variables, and create the server-side utilities needed by all subsequent phases.

1. **Database**: Create the `bookings` table with the schema defined in Prerequisites.
2. **Stripe client** (`src/lib/stripe.ts`): Singleton Stripe instance using `STRIPE_SECRET_KEY`.
3. **Resend utility** (`src/lib/resend.ts`): Wrapper around the Resend SDK for sending confirmation emails.
4. **iCal generator** (`src/lib/ical-generator.ts`): Converts booking records into a valid `.ics` string.

### Phase 2: Core Implementation

5. **Checkout API** (`src/app/api/checkout/create/route.ts`): Accepts `{ roomType, checkIn, checkOut, personCount, email }`, calculates price breakdown, creates Stripe Checkout session with:
   - Two line items: "Room price" and "Tourist tax" (in cents)
   - `metadata`: all booking fields needed for post-payment persistence
   - `images`: first image of the selected room
   - `success_url`: `/booking/confirmation/{CHECKOUT_SESSION_ID}` (Stripe replaces `{CHECKOUT_SESSION_ID}` with actual session ID)
   - `cancel_url`: `/booking/[roomType]`

6. **Stripe webhook handler** (`src/app/api/webhook/stripe/route.ts`):
   - Verify signature using `STRIPE_WEBHOOK_SECRET`
   - On `checkout.session.completed`:
     a. Extract metadata from session
     b. Insert booking into `bookings` table
     c. Send confirmation email via `src/lib/resend.ts`
     d. Return 200

7. **Internal iCal feed** (`src/app/api/ical/[room]/route.ts`):
   - Validate `room` param (`room1`, `room2`)
   - Query `bookings` table for confirmed bookings for that room
   - Generate `.ics` using `src/lib/ical-generator.ts`
   - Return with `Content-Type: text/calendar`

8. **BookingEngine wiring** (`src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx`):
   - Add email input field (required before booking)
   - `handleBook` calls `POST /api/checkout/create` with dates, persons, email, roomType
   - On success, redirect to the returned Stripe Checkout URL via `window.location.href`
   - Handle loading and error states

### Phase 3: Integration

9. **Confirmation page** (`src/app/(main)/booking/confirmation/[token]/page.tsx`):
   - Fetch booking by token from `bookings_public` view
   - Render `BookingConfirmationDetails` component

10. **BookingConfirmationDetails** (`src/app/(main)/booking/confirmation/[token]/ui/BookingConfirmationDetails.tsx`):
    - Display: room image, room type, check-in, check-out, nights, guests, price breakdown (room + tourist tax), total, confirmation message

11. **Update availability feeds** (`src/app/api/availability/route.ts`):
    - Add `/api/ical/room1` and `/api/ical/room2` to `ROOM_ICAL_FEEDS` so website bookings block off dates in the calendar.
    - Use absolute URL derived from request origin for the internal iCal URLs.

12. **Test specification files**: Create E2E and unit test specs.

---

## Technical Considerations

### Price Calculation

The existing `calculateTotalPrice` in `src/lib/price-utils.ts` handles all price logic:

- `basePrice = nights × 65€`
- `touristTax = min(nights, 3) × personCount × 2€`
- `total = basePrice + touristTax`

For Stripe, amounts must be in **cents** (multiply by 100, use integer). Stripe `currency` = `"eur"`.

Stripe line items:

```
Line item 1: "Room - [nights] nights" → amount = basePrice × 100 cents
Line item 2: "Tourist tax" → amount = touristTax × 100 cents
```

### Stripe Checkout Session Metadata

The session metadata must carry all data needed to persist the booking after payment, since the webhook has no other source of truth:

```json
{
  "roomType": "room1",
  "checkIn": "2026-07-10",
  "checkOut": "2026-07-14",
  "personCount": "2",
  "email": "guest@example.com",
  "nights": "4",
  "basePrice": "260",
  "touristTax": "12",
  "total": "272"
}
```

Note: Stripe metadata values must be strings.

### Stripe Image URL

Stripe Checkout accepts `images` as an array of absolute HTTPS URLs. In development, Stripe cannot reach `localhost` images. Use the absolute public image URL for the first image of the room:

```typescript
// room1 first image: /bed.webp → must be absolute
// Use a hardcoded production URL or skip images in development
const imageUrl =
  process.env.NODE_ENV === "production"
    ? `${origin}/bed.webp` // room1
    : undefined;
```

A simpler approach: pass the image URL only when in production (or skip it entirely if not critical to MVP).

### Webhook Secret Verification

The raw request body must be passed to `stripe.webhooks.constructEvent()`. In Next.js App Router, use `await request.text()` (not `.json()`) to get the raw body for signature verification.

### Internal iCal Feed URL in ROOM_ICAL_FEEDS

`ROOM_ICAL_FEEDS` in the availability route is a static object. The internal iCal URL cannot be derived from `request.url` here because it's used before any request is made. Options:

- Use `process.env.NEXT_PUBLIC_BASE_URL` (but the app_docs say don't hardcode URLs)
- Derive the URL inside the GET handler from `request.url` and build the internal feed URL dynamically, then merge with external feeds

The cleanest solution: in the availability API route, derive the internal iCal URL from the incoming request's origin and add it alongside the external feeds at request time.

### iCal Generator

The generated `.ics` file needs:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Issebya Homes//Booking Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260710
DTEND;VALUE=DATE:20260714
SUMMARY:Booking [token_prefix]
UID:[access_token]@issebya.homes
DTSTAMP:[created_at in UTC iCal format]
END:VEVENT
...
END:VCALENDAR
```

Use `date-fns` (already installed) for date formatting.

### Confirmation Email Content

Email sent via Resend to the guest's email address:

- **Subject**: "Booking Confirmation – Issebya Homes"
- **Body** (HTML): Room type, check-in date, check-out date, number of nights, guests, price breakdown (room + tourist tax + total), link to `/booking/confirmation/[token]`
- **From**: a verified Resend sender address (requires environment config)

### Booking Persistence: `bookings` table

A new table (different from `custom_bookings` which is for admin-created offers). This table stores direct guest bookings confirmed via Stripe payment.

### Performance

- The iCal feed endpoint should use appropriate HTTP cache headers (`Cache-Control: public, max-age=300`) to avoid excessive database queries from external platforms polling frequently.
- The internal iCal feed is added to `ROOM_ICAL_FEEDS` alongside external feeds, so it benefits from the existing 1-hour in-memory cache on the availability endpoint.

### Security

- Webhook signature verification is **mandatory** — never process webhook events without verifying `STRIPE_WEBHOOK_SECRET`.
- The `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must only be used server-side (in API routes, never in client components).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not needed for Stripe Checkout (server-side redirect flow — no client-side Stripe.js required).
- Use `createAdminClient()` (service role key) for webhook-triggered database inserts.
- The booking confirmation page uses `access_token` in URL (not UUID), consistent with database interaction rules.

### Accessibility

- The email input added to `BookingEngineExpanded` must have a proper label and ARIA attributes.
- The confirmation page is a server component — standard semantic HTML.
- Error states in the booking engine (API failure, email required) must be visible to screen readers.

### Error Handling

- **Checkout API**: Return 400 if required fields are missing or dates are invalid; return 500 on Stripe API errors.
- **Webhook handler**: Return 400 on signature verification failure; return 500 on database errors. Always return 200 on unhandled event types (so Stripe doesn't retry).
- **iCal route**: Return 400 for invalid room param; return 500 on database error.
- **Booking engine**: Display inline error if checkout API call fails; disable "book" button while loading.

---

## Prerequisites (BLOCKING)

Complete ALL prerequisites before running /implement. These require human action and cannot be automated.

### Infrastructure Tasks

- [ ] **Create `bookings` table and `bookings_public` view**
  - **Action**: Execute SQL in Supabase Dashboard > SQL Editor
  - **SQL**:

    ```sql
    -- Table: direct guest bookings confirmed via Stripe
    CREATE TABLE bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      access_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
      room_type TEXT NOT NULL CHECK (room_type IN ('room1', 'room2')),
      check_in DATE NOT NULL,
      check_out DATE NOT NULL,
      nights INTEGER NOT NULL,
      person_count INTEGER NOT NULL,
      base_price DECIMAL(10, 2) NOT NULL,
      tourist_tax DECIMAL(10, 2) NOT NULL,
      total_amount DECIMAL(10, 2) NOT NULL,
      email TEXT NOT NULL,
      stripe_session_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- View for guest access (anon key)
    CREATE VIEW bookings_public AS
      SELECT
        access_token,
        room_type,
        check_in,
        check_out,
        nights,
        person_count,
        base_price,
        tourist_tax,
        total_amount,
        email,
        status,
        created_at
      FROM bookings;

    -- Enable RLS
    ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

    -- RLS Policies
    CREATE POLICY "Allow public select" ON bookings
      FOR SELECT USING (true);

    CREATE POLICY "Allow service role insert" ON bookings
      FOR INSERT WITH CHECK (true);

    CREATE POLICY "Allow service role update" ON bookings
      FOR UPDATE USING (true);
    ```

  - **Verify**: Run `SELECT * FROM bookings LIMIT 1;` in SQL Editor — should return empty result set (not "relation does not exist" error)
  - **Verify**: Run `SELECT * FROM bookings_public LIMIT 1;` — same result

### Environment Tasks

- [ ] **`STRIPE_SECRET_KEY`** — Stripe secret API key
  - **Where**: `.env.development`
  - **Value**: Use `sk_test_...` for development, `sk_live_...` for production
  - **Verify**: Variable exists and starts with `sk_test_` or `sk_live_`
  - **Note**: Already in `.env.development` based on existing `webhook` script; verify it's set

- [ ] **`STRIPE_WEBHOOK_SECRET`** — Stripe webhook signing secret
  - **Where**: `.env.development`
  - **Value**: Obtain from Stripe Dashboard > Webhooks or from `stripe listen` CLI output
  - **Verify**: Variable exists and starts with `whsec_`
  - **Note**: Needed for webhook signature verification

- [ ] **`RESEND_API_KEY`** — Resend email API key
  - **Where**: `.env.development`
  - **Value**: Obtain from Resend Dashboard
  - **Verify**: Variable exists and starts with `re_`
  - **Note**: Already configured per codebase exploration

- [ ] **`RESEND_FROM_EMAIL`** — Verified sender email address for Resend
  - **Where**: `.env.development`
  - **Value**: A verified email address in your Resend account (e.g., `bookings@issebya.homes` or `noreply@issebya.homes`)
  - **Verify**: Variable exists and is a valid email address
  - **Note**: Resend requires the "from" address domain to be verified in their dashboard

- [ ] **Register Stripe Webhook endpoint**
  - **Action**: In Stripe Dashboard > Webhooks, add endpoint URL: `https://[your-domain]/api/webhook/stripe`
  - **Event**: Select `checkout.session.completed`
  - **For local dev**: Run `yarn webhook` (already configured in package.json: `stripe listen --forward-to localhost:3000/api/webhook/stripe`)
  - **Verify**: Stripe Dashboard shows the endpoint as active

---

NOTE: The /implement command will verify these prerequisites before starting code implementation. If any prerequisite fails verification, implementation will be BLOCKED until the human completes the required action.

---

## Step by Step Tasks

IMPORTANT: Prerequisites section above MUST be completed first. These steps assume all infrastructure and environment is ready.

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create Stripe client utility

- Create `src/lib/stripe.ts`
- Export a singleton Stripe instance:
  ```typescript
  import Stripe from "stripe";
  export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-04-30.basil", // use the latest version required by stripe@18
  });
  ```
- This is server-only — no `'use client'` directive

### Step 2: Create Resend email utility

- Create `src/lib/resend.ts`
- Import `Resend` from `'resend'`
- Export a function `sendBookingConfirmationEmail(booking: {...})` that:
  - Creates Resend client with `RESEND_API_KEY`
  - Composes HTML email with all booking details and a link to `/booking/confirmation/[token]`
  - The confirmation link URL must be derived as an absolute URL (pass `origin` from the caller)
  - Sends via `resend.emails.send()`
- Email HTML should include:
  - Subject: "Booking Confirmed – Issebya Homes"
  - Greeting with room type
  - Check-in / check-out dates (formatted as "Monday, 10 July 2026")
  - Number of nights
  - Number of guests
  - Price breakdown: room price (€), tourist tax (€), total (€)
  - A link to view the booking: "View your reservation → [url]"

### Step 3: Create iCal generator utility

- Create `src/lib/ical-generator.ts`
- Export `generateICalFeed(bookings: BookingRecord[]): string` where `BookingRecord` is:
  ```typescript
  type BookingRecord = {
    access_token: string;
    check_in: string; // YYYY-MM-DD
    check_out: string; // YYYY-MM-DD
    created_at: string;
  };
  ```
- The generated `.ics` string follows standard iCal format:
  - `DTSTART;VALUE=DATE` and `DTEND;VALUE=DATE` for all-day events
  - `SUMMARY:Reserved`
  - `UID:[access_token]@issebya.homes`
  - `DTSTAMP` in UTC format
- Use `date-fns/format` for date formatting

### Step 4: Create unit test spec

- Create `specs/feature_52_adw_9bfb53c2_stripe_checkout_booking_persistence/unit_testing_spec.md`
- Read `app_docs/testing/unit_test_spec_format.md` for the format
- Include test specs for:
  - `src/lib/ical-generator.ts` — test generateICalFeed with 0, 1, and multiple bookings; verify VCALENDAR structure, VEVENT content, date formatting
  - `src/lib/resend.ts` — test email composition (mock Resend SDK); verify subject, key fields in body
  - `src/app/api/checkout/create/route.ts` — test request validation (missing fields, invalid dates, invalid roomType)
  - `src/app/api/webhook/stripe/route.ts` — test signature verification failure returns 400; test unhandled event type returns 200; test `checkout.session.completed` triggers correct database insert (mock Supabase)
  - `src/app/api/ical/[room]/route.ts` — test invalid room param returns 400; test valid room returns text/calendar content type

### Step 5: Create Stripe Checkout API route

- Create `src/app/api/checkout/create/route.ts`
- **POST handler** accepts JSON body:
  ```typescript
  {
    roomType: "room1" | "room2";
    checkIn: string; // YYYY-MM-DD
    checkOut: string; // YYYY-MM-DD
    personCount: number;
    email: string;
  }
  ```
- Validate with Zod schema (define in `src/schemas/booking.ts` as `checkoutSchema`)
- Calculate pricing using `calculateTotalPrice` from `src/lib/price-utils.ts`
- Get room image URL:
  - Room1: `/bed.webp`, Room2: `/bed_bedroom2.webp`
  - Only pass absolute URL if `NODE_ENV === 'production'` (Stripe can't reach localhost)
- Create Stripe Checkout session:
  ```typescript
  stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: `${roomLabel} – ${nights} night${nights > 1 ? "s" : ""}`,
            images: imageUrl ? [imageUrl] : [],
          },
          unit_amount: Math.round(basePrice * 100),
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: "eur",
          product_data: { name: "Tourist tax" },
          unit_amount: Math.round(touristTax * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      roomType,
      checkIn,
      checkOut,
      personCount: String(personCount),
      email,
      nights: String(nights),
      basePrice: String(basePrice),
      touristTax: String(touristTax),
      total: String(total),
    },
    customer_email: email,
    success_url: `${origin}/booking/confirmation/{CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/booking/${roomType}`,
    mode: "payment",
  });
  ```
- Return `{ url: session.url }` on success
- Derive `origin` using `new URL(request.url).origin`

### Step 6: Create Stripe webhook handler

- Create `src/app/api/webhook/stripe/route.ts`
- **POST handler**:
  1. Read raw body: `const rawBody = await request.text()`
  2. Get signature: `request.headers.get('stripe-signature')`
  3. Verify: `stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)`
  4. If verification fails, return 400
  5. Handle `checkout.session.completed`:
     a. Extract `metadata` from session
     b. Derive `origin` from `request.url`
     c. Insert into `bookings` table using `createAdminClient()`
     d. Get `access_token` from inserted row
     e. Call `sendBookingConfirmationEmail(booking, origin)`
  6. Return `NextResponse.json({ received: true })` for all event types (200)
- Add `export const config = { api: { bodyParser: false } }` — NOT needed in App Router (raw body is obtained via `request.text()`)
- **Critical**: Must export `export const runtime = 'nodejs'` if needed for raw body access (test in implementation)

### Step 7: Create internal iCal API route

- Create `src/app/api/ical/[room]/route.ts`
- **GET handler**:
  1. Validate `room` param — must be `'room1'` or `'room2'`
  2. Query `bookings` table (use `createAdminClient()` or `createClient()` — public data) for all confirmed bookings of that room type
  3. Call `generateICalFeed(bookings)`
  4. Return response with:
     ```typescript
     new Response(icalString, {
       headers: {
         "Content-Type": "text/calendar; charset=utf-8",
         "Cache-Control": "public, max-age=300",
         "Content-Disposition": `attachment; filename="${room}.ics"`,
       },
     });
     ```

### Step 8: Update BookingEngineExpanded to wire Stripe redirect

- Modify `src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx`
- Add `roomType: 'room1' | 'room2'` prop (pass down from `BookingEngine`)
- Add email input state (controlled, since it's needed before booking):
  ```
  const [email, setEmail] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  ```
- Add email `<input>` field above the action buttons with label "Email" (use existing input styling)
- Update `handleBook`:
  ```typescript
  const handleBook = useCallback(async () => {
    if (!checkInDate || !checkOutDate || !email) return;
    setIsBooking(true);
    setBookingError(null);
    try {
      const res = await fetch("/api/checkout/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomType,
          checkIn: format(checkInDate, "yyyy-MM-dd"),
          checkOut: format(checkOutDate, "yyyy-MM-dd"),
          personCount,
          email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create checkout session");
      window.location.href = data.url;
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsBooking(false);
    }
  }, [checkInDate, checkOutDate, personCount, email, roomType]);
  ```
- Disable "book" button if `!email || isBooking || !checkInDate || !checkOutDate`
- Show `bookingError` if set

### Step 9: Pass roomType prop through BookingEngine

- Modify `src/app/(main)/booking/[type]/ui/BookingEngine.tsx`
- Pass `roomType` prop to `BookingEngineExpanded`

### Step 10: Create booking confirmation page

- Create `src/app/(main)/booking/confirmation/[token]/page.tsx`
- Server component that:
  1. Extracts `token` from params
  2. Fetches `GET /api/bookings/direct?token=[token]` — **or** queries Supabase directly in the page using `createClient()` from `bookings_public` view
  3. If not found, calls `notFound()`
  4. Renders `<BookingConfirmationDetails booking={booking} />`
- **Note**: Query Supabase directly in the page (server component) rather than going through an API route, since this is a server-side render.
- Title metadata: "Booking Confirmed – Issebya Homes"

### Step 11: Create BookingConfirmationDetails component

- Create `src/app/(main)/booking/confirmation/[token]/ui/BookingConfirmationDetails.tsx`
- Server component (no `'use client'`)
- Props: `booking` (from `bookings_public` view)
- Layout mirrors `CustomBookingDetails.tsx` (left: details, right: room image):
  - Room image (left or top on mobile) using the room's first image from `roomImages` map
  - Confirmation heading: "Booking Confirmed!" with a subheading "Thank you for your reservation"
  - Check-in date (formatted)
  - Check-out date (formatted)
  - Number of nights
  - Number of guests
  - Room type (displayed as "Room 1" or "Room 2")
  - Price breakdown:
    - Room price: `€[basePrice]`
    - Tourist tax: `€[touristTax]` (with asterisk note)
    - Total: `€[totalAmount]` (bold, larger)
  - Confirmation note: "A confirmation email has been sent to [email]"
  - Tourist tax footnote: `*Tourist tax: 2€ per person, charged for first 3 nights`

### Step 12: Update availability route to include internal iCal

- Modify `src/app/api/availability/route.ts`
- Inside the `GET` handler, after determining the room, derive the internal iCal URL from `request.url`:
  ```typescript
  const origin = new URL(request.url).origin;
  const internalIcalUrl = `${origin}/api/ical/${room}`;
  ```
- Add `internalIcalUrl` to the feeds array when calling `mergeMultipleFeeds`
- The internal iCal feed will return an empty `.ics` initially (no bookings yet) and populate as bookings are made

### Step 13: Create E2E test spec

- Create `specs/feature_52_adw_9bfb53c2_stripe_checkout_booking_persistence/e2e_testing_spec.md`
- Read `app_docs/testing/e2e_example.md` and `app_docs/testing/e2e_runner.md` for format
- Test scenarios:
  1. **Happy path**: Navigate to `/booking/room1`, expand booking engine, select dates, enter email, click "book" → verify redirect to `checkout.stripe.com` (or test checkout URL)
  2. **Confirmation page**: Navigate to `/booking/confirmation/[known-test-token]` → verify booking details display correctly
  3. **iCal feed**: Navigate to `/api/ical/room1` → verify response contains `BEGIN:VCALENDAR` and correct `Content-Type` header
  4. **Invalid confirmation token**: Navigate to `/booking/confirmation/invalid-token-123` → verify 404 page
- Note: Full end-to-end Stripe payment test requires Stripe test mode and may use Stripe's test card numbers

### Step 14: Run validation

- Execute all validation commands to confirm zero regressions

---

## Testing Strategy

### Edge Cases

- **Tourist tax boundary**: Exactly 3 nights — tax charged for all 3. 4+ nights — still only 3 nights of tax. 1 night — tax for 1 night.
- **Tourist tax with 0 persons**: Should not happen (minimum 1 guest in booking engine), but `calculateTouristTax(nights, 0)` returns 0.
- **Stripe amounts in cents**: Floating-point prices (e.g., 12.50€) must be rounded to integer cents (1250 cents). Use `Math.round(price * 100)`.
- **Webhook replay / duplicate bookings**: The `stripe_session_id` column has a `UNIQUE` constraint — a duplicate insert will fail gracefully (Stripe retries webhooks on non-200 responses, so the webhook must handle this without returning 500).
- **Missing metadata in webhook**: If `session.metadata` is null or incomplete, log an error and return 200 (don't retry).
- **iCal feed with no bookings**: Should return a valid empty VCALENDAR (not an error).
- **Internal iCal URL in development**: When the availability API calls the internal iCal URL, it calls `localhost:PORT/api/ical/room1`. This is a server-to-server call — it works in development as long as the dev server is running.
- **Confirmation page with pending/cancelled status**: MVP — only show confirmed bookings; if not found show 404.
- **Room type mapping**: Stripe metadata uses `room1`/`room2` (enum values from `BookingType`). The database `bookings.room_type` should also store `room1`/`room2` (not "Room 1"/"Room 2" like `custom_bookings` uses). Keep consistent with the `BookingType` enum.

---

## Cleanup Checklist

Before final validation, verify:

- [ ] Unused functions/variables removed (not commented out)
- [ ] Dead imports removed
- [ ] `console.log` removed from `BookingEngineExpanded.handleBook` (was there as a placeholder)
- [ ] Components no longer used have been deleted
- [ ] Old hooks replaced by new patterns have been deleted
- [ ] No TODO comments left from implementation
- [ ] `export const runtime` declarations removed if not needed

---

## Acceptance Criteria

- [ ] User can select dates and click "book" in the booking engine for room1 or room2
- [ ] User must enter email before "book" button is enabled
- [ ] Clicking "book" redirects user to Stripe Checkout with correct price breakdown (room price + tourist tax as separate line items)
- [ ] Stripe Checkout page displays room image (in production), number of guests (in metadata description), check-in and check-out dates (in metadata), total price
- [ ] After successful Stripe payment, booking is stored in `bookings` table with all required fields
- [ ] After successful payment, confirmation email is sent to the guest's email via Resend
- [ ] After successful payment, user is redirected to `/booking/confirmation/[token]`
- [ ] Confirmation page displays: room type, check-in/check-out dates, nights, guests, price breakdown, total, and confirmation note
- [ ] `/api/ical/room1` and `/api/ical/room2` return valid `.ics` feeds with confirmed bookings as VEVENT entries
- [ ] The internal iCal feeds are included in the availability API so website bookings block off dates in the booking calendar
- [ ] Stripe webhook verifies signature before processing — invalid signatures return 400
- [ ] `yarn build` completes with no TypeScript or build errors

---

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

**E2E Tests**: Read `app_docs/testing/e2e_runner.md`, then read and execute `specs/feature_52_adw_9bfb53c2_stripe_checkout_booking_persistence/e2e_testing_spec.md` to validate end-to-end functionality.

```bash
# Build validation — must complete with zero errors
yarn build

# Lint check
yarn lint

# Verify iCal feed endpoint (once dev server is running)
# curl -I http://localhost:3000/api/ical/room1
# Expected: Content-Type: text/calendar

# Verify invalid room param returns 400
# curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/ical/invalid
# Expected: 400
```

---

## Notes

### Stripe API Version

The `stripe` npm package at v18.2.0 requires specifying an `apiVersion` in the Stripe constructor. Use the version compatible with v18 — check `node_modules/stripe/types/index.d.ts` for the `LatestApiVersion` type to get the correct string value.

### Resend Domain Verification

The `RESEND_FROM_EMAIL` must use a domain verified in the Resend dashboard. For testing, Resend allows sending from `onboarding@resend.dev` to the account owner's email without domain verification. Prefer using the verified domain email in production.

### Stripe Test Cards (for E2E testing)

- Success: `4242 4242 4242 4242`, any future expiry, any CVC
- Decline: `4000 0000 0000 0002`

### Internal iCal in Development

During local development, the availability endpoint will call `http://localhost:3000/api/ical/room1` as a server-to-server HTTP request. This requires the dev server to be running. If it causes issues, the internal iCal URL can be conditionally excluded from `ROOM_ICAL_FEEDS` when `NODE_ENV === 'development'` and the self-URL would fail.

### Booking Token vs Session ID for Confirmation Page

The Stripe `success_url` uses `{CHECKOUT_SESSION_ID}` as a template variable that Stripe replaces with the actual session ID. However, the `bookings` table uses `access_token` (a random hex string) as the public identifier.

Two options for the confirmation page URL:

1. **Option A** (simpler): Use the Stripe `session_id` in the success URL: `/booking/confirmation/session_[SESSION_ID]`, then on the confirmation page, look up the booking by `stripe_session_id`. This avoids needing to know the `access_token` before the webhook fires.
2. **Option B** (consistent with existing patterns): After webhook fires and `access_token` is known, the email contains the link `/booking/confirmation/[access_token]`. The success_url redirects to a loading page `/booking/payment-processing?session=[SESSION_ID]` that polls for the booking by session ID.

**Recommendation**: Use Option A — look up by `stripe_session_id` in the confirmation page. This is simpler and works immediately after redirect. The email confirmation link can also use the `access_token` for the same page (the page can accept either token type, or two separate lookup endpoints).

Simplest implementation:

- `success_url`: `/booking/confirmation?session={CHECKOUT_SESSION_ID}`
- Confirmation page looks up booking by `stripe_session_id`
- If not found yet (webhook hasn't fired), show "Processing your booking..." with a brief retry
- Email confirmation uses the same URL format or uses `access_token`

### no Radix UI needed

This feature does not add admin UI components — no additional Radix UI packages are required. The existing Radix packages installed (`@radix-ui/react-label`, `@radix-ui/react-select`, etc.) are sufficient.

### New packages to install (if not already present)

Run before implementing:

```bash
yarn add ical-generator
```

Actually — avoid `ical-generator` (new dependency). Implement the `.ics` generator manually using string templates with `date-fns/format` — the format is simple enough and `date-fns` is already installed.

Stripe (`stripe`) and Resend (`resend`) are already in `package.json` dependencies.
