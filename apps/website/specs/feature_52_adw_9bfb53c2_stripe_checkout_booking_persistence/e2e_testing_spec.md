# E2E Test: Stripe Checkout Booking Flow

Test the complete booking flow: date selection → Stripe Checkout redirect → booking confirmation.

## User Story

As a guest
I want to select dates, enter my email, and pay via Stripe Checkout
So that my booking is confirmed and I receive a confirmation

## Prerequisites

- Dev server running at http://localhost:3000
- Stripe test mode configured (`STRIPE_SECRET_KEY=sk_test_...`)
- `STRIPE_WEBHOOK_SECRET` configured with `stripe listen` CLI running

## Test Steps

### Scenario 1: Happy path — redirect to Stripe Checkout

1. Navigate to `http://localhost:3000/booking/room1`
2. Take a screenshot of the initial booking page
3. **Verify** the booking engine is visible (collapsed state)
4. Click the "book" button to expand the booking engine
5. **Verify** the expanded booking engine is visible with the calendar
6. Click a future check-in date on the calendar
7. Click a check-out date at least 1 night after check-in
8. **Verify** the price breakdown is shown (nights, total, tourist tax)
9. Enter email `test@example.com` in the email input field
10. **Verify** the "book" button is now enabled
11. Take a screenshot of the booking engine with dates and email filled in
12. Click the "book" button
13. **Verify** the page redirects to `checkout.stripe.com` (URL starts with `https://checkout.stripe.com`)
14. Take a screenshot of the Stripe Checkout page

### Scenario 2: iCal feed returns valid response

1. Navigate to `http://localhost:3000/api/ical/room1`
2. **Verify** response status is 200
3. **Verify** response `Content-Type` header contains `text/calendar`
4. **Verify** response body contains `BEGIN:VCALENDAR`
5. **Verify** response body contains `END:VCALENDAR`

### Scenario 3: Invalid iCal room parameter returns 400

1. Navigate to `http://localhost:3000/api/ical/invalid`
2. **Verify** response status is 400

### Scenario 4: Booking confirmation page with invalid session

1. Navigate to `http://localhost:3000/booking/confirmation?session=invalid_session_id`
2. **Verify** the page shows a 404 error (not found)

### Scenario 5: Book button disabled without email

1. Navigate to `http://localhost:3000/booking/room1`
2. Click the "book" button to expand the booking engine
3. Select check-in and check-out dates
4. **Verify** the "book" button is disabled (email field is empty)
5. Take a screenshot showing the disabled state

## Success Criteria

- Booking engine expands and shows the email input field
- "book" button is disabled until email is entered AND dates are selected
- Clicking "book" with valid email and dates redirects to Stripe Checkout
- `/api/ical/room1` returns `text/calendar` content with valid iCal structure
- `/api/ical/invalid` returns 400
- `/booking/confirmation?session=invalid_session_id` returns 404
- 4+ screenshots are taken across all scenarios

## Notes

- For a full end-to-end payment test, use Stripe test card: `4242 4242 4242 4242` with any future expiry and any CVC
- After successful payment in Stripe test mode, the webhook must be forwarded using `stripe listen --forward-to localhost:3000/api/webhook/stripe`
- The confirmation page lookup requires the webhook to fire before the page shows booking details
