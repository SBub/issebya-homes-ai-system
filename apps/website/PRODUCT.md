# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: individual travelers and couples booking one of the two private
rooms at the guest house for a stay. Secondary: guests booking the private
event space or the whole house for intimate gatherings (small events,
retreats) — a real but secondary use case, not the site's main job.

## Product Purpose

Guest-facing booking site for issebya.homes, a two-room guest house (plus a
private event space available as a whole-house booking) in Almoçageme,
inside the Sintra-Cascais Natural Park, Portugal. Lets guests check
real-time room availability (synced via iCal from Airbnb/VRBO/Booking.com)
and book directly through Stripe Checkout.

## Positioning

The place and the host experience is the core differentiator, not the
booking mechanism itself: the specific natural-park location and a
personal, host-run hospitality style (WhatsApp-only contact, handwritten-
font branding voice, no corporate contact form) is what a neighboring
Airbnb/guesthouse listing could not truthfully copy. Direct, fee-free
booking with real-time availability is a genuine functional benefit but is
table stakes alongside that, not the headline pitch.

## Operating Context

Guests browse room detail pages, check a live availability calendar, and
book via Stripe Checkout. After booking, guests reach the property through
static per-guest check-in pages (e.g. room1/hendrik, room2/didi,
room2/fernando — these are real past/current guest names, not placeholder
data). The host communicates with guests over WhatsApp; the `/contact` page
offers only a WhatsApp link, no email or phone form. Reviews live on
Airbnb's public listing and are linked out to, not reproduced on-site.

## Capabilities and Constraints

- Next.js 16 / React 19 / TypeScript / Tailwind 4, deployed on Vercel.
- Stripe Checkout for direct payment; Supabase for backend data; iCal sync
  pulls availability from Airbnb/VRBO/Booking.com.
- Routes: room booking flow (`/booking`, `/booking/[type]`,
  `/booking/confirmation`), `/contact`, `/guest-info`, legal pages
  (`/privacy-policy`, `/terms-and-conditions`), a `/blog`, and static
  per-guest `/checkin/[room]/[guest]` pages.
- Canonical production domain is **issebya.com**, even though the brand
  name displayed everywhere (site copy, branding guidelines, Instagram
  handle) is "issebya.homes". This is a confirmed, deliberate fact, not a
  bug — `src/lib/site.ts` carries a code comment questioning the mismatch;
  future work should not "fix" it by changing the domain.
- Brand name is written strictly lowercase: "issebya.homes".

## Brand Commitments

- Name always rendered lowercase: "issebya.homes" (per
  `app_docs/branding-guidelines.md`); no dedicated logo file exists, the
  wordmark is styled text.
- Typography pairing signals a personal/intimate voice, not a corporate
  hospitality brand: Work Sans for body text, Nothing You Could Do
  (handwritten style) for headers.
- Current palette: `#f0eeea` background (warm beige), `#000000` foreground.
- Instagram: instagram.com/issebya.homes.

## Evidence on Hand

- Real room copy: Room 1 (ground floor, own bathroom not en suite, shared
  living room/kitchen/terrace with distant Atlantic views) and Room 2
  (en suite bathroom) — both in the house in Almoçageme.
- Reviews: no testimonial content is hosted locally; the site links out to
  Airbnb's public review page. Do not fabricate testimonials or review
  content in future work.
- Contact: WhatsApp only, +351 920 742 845.

## Product Principles

1. The place and the host, not the booking engine, are the pitch — direct
   booking is a convenience, not the headline.
2. Personal, intimate voice over generic hospitality-brand polish
   (handwritten type, WhatsApp contact, no corporate forms).
3. Never fabricate reviews or testimonials; always defer to the real
   Airbnb review link.
4. Preserve the two-room-plus-event-space/whole-house inventory model as
   the core structure of the offering.
