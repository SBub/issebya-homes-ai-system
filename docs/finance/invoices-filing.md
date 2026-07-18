# Invoices — filing reference

For every reservation, an invoice must be created manually in Portal das Finanças (the
Portuguese tax authority's online portal). This isn't automatable — no public API for
invoice creation there — so the deliverable is a per-reservation data list, which the
host then manually re-enters into the portal.

## What's needed per reservation

`{ guest_name, guest_paid }` — critically, **the amount the guest paid, not what the
host received**. Host earnings (`net_received` / `gross_room_income` as currently
computed in `finance_bookings`) are *not* the right number here if the platform charges
the guest a separate service fee on top of the room price — the invoice needs to reflect
what the guest was actually billed for the stay.

## Airbnb — guest paid is higher than the room fee, derivable from `Earnings` alone

Airbnb's current pricing model (see caveat below) charges the guest a separate service
fee on top of the room price. Verified against two real bookings where both the "You
earn" and "Guest paid" figures were available:

| Room fee | Guest service fee | Guest paid | Fee % |
|---|---|---|---|
| €201.00 | €33.77 | €234.77 | 16.8010% |
| €431.48 | €72.49 | €503.97 | 16.8003% |

Consistent to four significant figures across two independent bookings — treated as a
fixed rate for this specific host account, **16.8%**, not the general "14.1–16.5%" range
often cited for Airbnb hosts generally (that range is generic guidance; this account's
actual rate is what matters and is more precise than that range suggests).

Combined with the host-fee derivation from `modelo-30-filing.md` (`room_fee = Earnings /
0.9631`), the full chain from just the CSV's `Earnings` column:

```
room_fee   = Earnings / 0.9631
guest_paid = room_fee × 1.168
```

Verified end-to-end against real data: Earnings €193.58 → derived €234.76 (actual
€234.77, 1-cent rounding) · Earnings €415.56 → derived €503.97 (exact match).

**⚠️ Time-limited, same caveat as Modelo 30**: this split-fee model (3% host + 16.8%
guest) is being retired for EU hosts on **October 13, 2026**. After that date, Airbnb
moves to a host-only fee with **no separate guest fee at all** — meaning after the
transition, `guest_paid` simply equals the listed room price (`gross_room_income`
directly), no derivation needed. The formula above only applies to bookings under the
current pricing model; recheck before relying on it past that date.

**Recommended validation before fully trusting this at scale**: spot-check a third
booking's actual "Guest paid" toggle value against the formula, or use the "VAT invoice"
button in the Airbnb earnings modal per booking if it ever shows the guest-paid total
directly.

## Booking.com — likely already in the CSV directly, needs one verification

Booking.com's own invoice shows `Room Sales` as the gross pre-commission amount (e.g.
€272.00), and — unlike Airbnb — Booking.com's guest-facing pricing generally doesn't add
a separate guest-side service fee on top (the listed price is what the guest pays). So
`guest_paid` for Booking.com bookings is most likely just `Original amount` or `Final
amount` directly from the CSV — **not yet confirmed against a real CSV row**, since only
the invoice PDF (not a raw CSV export) has been checked so far. Needs one real Booking.com
CSV row cross-referenced against a known invoice to confirm which of the two "amount"
columns is correct (a booking modified after creation could make `Original` ≠ `Final`).

## Worked example: what a monthly invoices report should show

```
July 2026
  MARION TREMINTIN    (Airbnb, room1, 19–23 Jul)      €258.11   ← guest paid, not €—.— host earned
  Philine Jalowy      (Airbnb, room2, 13–16 Jul)      €234.77
  <Booking.com guest>  (Booking.com, ..., ...)         €<Original or Final amount>
```

One list per month, covering every reservation across both platforms (checkin-date or
checkout-date scoped — cadence not yet pinned to a specific date field for this report;
using whichever the corresponding Modelo 30 attribution uses per platform is a reasonable
default, since these run on the same monthly cadence).
