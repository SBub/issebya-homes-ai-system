# Modelo 30 — filing reference

Portuguese monthly return declaring payments made to non-resident entities — in this
case, commissions paid to Airbnb Ireland UC and Booking.com B.V., neither of which is
Portuguese tax-resident.

## What must be declared, and how

**Per-platform, not combined.** Each non-resident entity gets its own declaration line —
Airbnb and Booking.com are separate legal entities, each requiring their own foreign tax
ID, country code, value paid, tax rate, and withholding amount. A single combined
monthly total across both platforms is not the correct shape.

**Value must exclude VAT** ("valor base, sem IVA" — the base value, without VAT).

**Deadline: end of the *second* month following the payment month** — e.g. commissions
from January are due by end of March, not end of February. Filing early within that
window (e.g. at the start of a month, once the prior-prior month's number is ready) is
fine — what matters is computing the *correct* month, not the most recent one.

Sources: [CRN Contabilidade](https://crncontabilidade.pt/blog/modelo-30-para-que-serve-prazo-e-instrucoes-de-preenchimento/) · [Lodgify](https://www.lodgify.com/pt/guias/modelo-30-alojamento-local/) · [Hostkit](https://hostkit.pt/artigos/como-fazer-modelo-30-alojamento-local/)

## Platform tax IDs (confirmed first-party, from real invoices)

| Platform | Entity | Tax ID | Country |
|---|---|---|---|
| Airbnb | Airbnb Ireland UC, 25 North Wall Quay, Dublin 1, D01 H104, Ireland | `IE9827384L` | IE |
| Booking.com | Booking.com B.V., Oosterdokskade 163, 1011 DL Amsterdam, Netherlands | `NL805734958B01` | NL |

Both confirmed directly from actual Airbnb/Booking.com invoices issued to this host —
not third-party lookups.

## Per-platform commission formula

### Airbnb

Current CSV export (`Confirmation code, Status, Guest name, Contact, # of adults, # of
children, # of infants, Start date, End date, # of nights, Booked, Listing, Earnings`)
gives only a single `Earnings` (net, post-fee) figure — no separate commission column.
The host service fee is a fixed, verified formula:

```
host_service_fee (incl. VAT) = room_fee × 0.03 × 1.23     (3% commission, 23% VAT on top)
room_fee                     = Earnings / 0.9631            (0.9631 = 1 − 0.03×1.23)
base_commission (excl. VAT)  = room_fee × 0.03              ← Modelo 30 value
```

Verified exactly (to the cent) against three real bookings:

| Room fee | Fee (incl. VAT) | Earnings | Base commission (derived) |
|---|---|---|---|
| €110.00 | €4.06 | €105.94 | €3.30 |
| €201.00 | €7.42 | €193.58 | €6.03 |
| €268.00 | €9.89 | €258.11 | €8.04 |

Also confirmed via an actual Airbnb VAT invoice: Base Fee €6.03, VAT €1.39, Total €7.42
— matches the derivation exactly.

**Date attribution**: Airbnb invoices the host service fee on the **`Booked` date**
(reservation-creation date), not check-in or check-out. Confirmed by matching an actual
invoice date (`2026-04-26`, for confirmation code `HMMS4P9AWF`) to that booking's
`Booked` column value — identical. A booking made in April but staying in July gets
attributed to April for Modelo 30 purposes, not July.

**⚠️ Time-limited**: this 3%-host / VAT-inclusive fee structure is the "split-fee"
pricing model. Airbnb is retiring it for EU hosts on **October 13, 2026**, moving to a
flat 15.5%+VAT host-only fee (and no separate guest fee at all — see
`invoices-filing.md`). This formula needs revisiting after that date.

### Booking.com

CSV export (`"Reservation number","Invoice number","Booked on","Arrival","Departure","Booker
name","Guest name","Rooms","Persons","Room nights","Commission %","Original
amount","Final amount","Commission amount","Payment fee","Status","Guest
request","Currency","Hotel id","Property name","City","Country"`) already has a direct
`Commission amount` column — no derivation needed.

**VAT treatment is the opposite of Airbnb's**: Booking.com's invoices state explicitly
*"VAT is subject to 'reverse charge' regulation."* This means `Commission amount` is
**already the VAT-exclusive base value** — use it directly, do not divide by anything.

Confirmed via two real invoices, both showing a clean, consistent **15% commission
rate**:

| Room Sales | Commission | Rate |
|---|---|---|
| €272.00 | €40.80 | 15.00% |
| €45.36 | €6.80 | 14.99% |

**Date attribution**: Booking.com's invoices state explicitly — *"PLEASE BE AWARE THAT
OUR INVOICES ARE BASED ON DEPARTURE DATE AND NOT ON ARRIVAL DATE."* So Booking.com
commissions attribute to a month by **`checkout_date`** (called `Departure` in the CSV).

## Worked example: what a monthly Modelo 30 report should show

```
July 2026
  Airbnb (Ireland UC, IE9827384L):      €<sum of base_commission for bookings with booked_date in July>
  Booking.com (B.V., NL805734958B01):   €<sum of Commission amount for bookings with checkout_date in July>
```

Two numbers, not one combined total, each traceable to a specific platform's tax ID —
this is the shape the actual Modelo 30 form needs.
