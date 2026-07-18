# Notification Center — backlog

The Notification Center (`agent-architecture.mmd`) doesn't exist yet — out of scope for
v0.1.0 (see spec). This is the running list of reminder-type items it should own once
built: things that need to "keep telling the user until marked done" rather than a
one-shot report. Add to this list as new reminder-shaped needs come up, so they aren't
lost or built ad hoc into whichever component happens to notice them first.

## Pending items

- **RFI-21 form (annual, January)** — Airbnb re-issues the Portugal–Ireland double-tax
  treaty form every January. Host downloads it, fills in Section VI (Portuguese tax ID
  and name), resubmits to Airbnb. Booking.com's equivalent, if any, is still unknown.
  See `agent-architecture.mmd` `CRON_RFI`.

- **Airbnb split-fee pricing retirement (one-time, October 13, 2026)** — Airbnb retires
  the current split-fee pricing model for EU hosts on this date, moving to a flat
  15.5%+VAT host-only fee with no separate guest fee. Every formula in
  `docs/finance/modelo-30-filing.md` and `docs/finance/invoices-filing.md` derived from
  the current 3%-host/16.8%-guest split is built on the *current* model and needs
  revisiting once this lands — the host commission rate changes, the guest-paid
  derivation disappears entirely (guest_paid = listed price directly, no fee math
  needed). This is easy to lose track of once the finance domain is built and working;
  it needs an explicit reminder closer to the date, not a "remember to check this
  eventually." See `agent-architecture.mmd` `CRON_AIRBNB_PRICING`.
