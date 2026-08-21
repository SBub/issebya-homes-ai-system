# WhatsApp campaign templates — the 24-hour window, drafted templates, and what's still blocking a real launch

This doc is written for someone without a CRM/WhatsApp-messaging background. It explains
the one WhatsApp platform rule that governs everything about how campaign messages get
sent (`docs/whatsapp-campaign-templates.md` §1), the reason nothing can be sent to a real
guest today regardless of that rule (§2), two drafted templates for our two newest
campaigns (§3), how to actually get a template approved and verify it (§4), and a single
consolidated list of what's blocking a real launch (§5).

## 1. The 24-hour window, explained simply

WhatsApp (via Meta, the platform behind it) only lets a business send **free-form text**
to a customer within a **24-hour window that opens when the customer messages first**.
Concretely:

- **What opens the window**: any inbound message from the guest to us — a WhatsApp text,
  tapping a button, anything guest-initiated.
- **What the window allows**: for 24 hours after that inbound message, we can send
  whatever free-form text we want back — exactly what `apps/guest-communication-agent`
  (GCA) does today for every reply in an active conversation, and exactly what
  `sendWhatsAppMessage` (`apps/guest-communication-agent/src/lib/twilio-send.ts`) does when
  `POST /api/send` is called.
- **What happens outside the window**: if we want to message a guest and _we're_ the one
  initiating — no recent inbound message from them — free-form text is not allowed at
  all. We're required to use a **pre-approved Message Template**: fixed text, submitted to
  and approved by Meta ahead of time, with only designated numbered variable slots
  (`{{1}}`, `{{2}}`, ...) that we fill in at send time. This is a Meta/WhatsApp platform
  rule, not a Twilio limitation — Twilio's **Content API** (`ContentSid` +
  `ContentVariables` instead of a free-text `Body`) is simply Twilio's mechanism for
  sending these Meta-approved templates.

**This is the important part the campaign design hadn't fully accounted for**: it applies
to **all four** of our campaign kinds, not just the two new ones.

| Campaign kind              | Who it messages                                               | Inside or outside the 24h window? |
| -------------------------- | ------------------------------------------------------------- | --------------------------------- |
| `seasonal_nudge`           | guests idle 3+ days (no inbound message from them in 3+ days) | **outside** — needs a template    |
| `stalled_link_nudge`       | guests idle 5+ days                                           | **outside** — needs a template    |
| `returning_guest_discount` | past guests, many of whom have never messaged GCA at all      | **outside** — needs a template    |
| `winter_lockin_program`    | anyone with `total_stays >= 1`, same story                    | **outside** — needs a template    |

In other words: **every single campaign dispatch in this system today is, by
definition, outside the 24-hour window** — "idle 3+/5+ days" and "a past guest who may
have never messaged us" are both exactly the scenario a template exists for. There is no
campaign-sending path that can ever use free-form `Body` text; a template is required for
the cold-open message of every campaign kind we have or plan.

The good news: once a guest **replies** to a template — even a plain "no thanks" — a
fresh 24-hour window opens immediately, and GCA's existing conversational AI can reply
freely from that point on, exactly as it does for any normal inbound message today. No
template is needed for that follow-up conversation. The template's only job is to get the
guest to send _something_ back.

## 2. Current blocker: we're on Twilio's Sandbox, not a real WhatsApp Business number

`apps/guest-communication-agent/.env.example` currently sets:

```
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

That's Twilio's shared **WhatsApp Sandbox** number — not a real, Meta-approved WhatsApp
Business Account (WABA) number. The Sandbox can only exchange messages with phone numbers
that have manually opted in by texting a join code (e.g. "join some-word") to that shared
number from their own phone.

Concretely: **none of the real guests in `guest_contacts` have done this**, so no
campaign message — regardless of copy, regardless of template approval, regardless of
anything in this codebase — can reach a single real guest today. This is a prerequisite
independent of all the template/copy work below. Getting a real WABA provisioned is a
human/business step (registering a WhatsApp Business Account through Meta Business
Manager, verifying the business, connecting it to Twilio) outside this codebase, and nothing
here builds or automates it.

## 3. Two drafted WhatsApp Marketing templates

Both templates below are drafts, ready to paste into Twilio's Content Template Builder or
Meta Business Manager for submission (§4) — no Content SID exists for either yet, so
nothing in the code (§ "GCA code scaffolding" below) hardcodes one.

### A real mismatch to keep in mind

`apps/crm/src/lib/campaign-messages.ts`'s `renderCampaignMessage` fills **named**
placeholders — `{{guest_name}}`, `{{promo_code}}`, `{{discount_percent}}`,
`{{offer_description}}` — into `campaigns.message_template`, and that rendered text is
what a human sees and approves in the Telegram draft-approval flow. That is a completely
separate system from Meta/Twilio's own template variables, which are **positional and
numbered only** — `{{1}}`, `{{2}}`, etc. — with no support for named placeholders at all.

Practically: the Telegram-preview template text (`campaigns.message_template`) and the
Meta-approved template body drafted below are **two different pieces of copy that happen
to say similar things**, not the same string reused in two systems. `{{guest_name}}` in
the CRM's copy and `{{1}}` in the template body below both end up holding the guest's
name, but nothing here auto-converts one into the other today — that mapping (which
campaign field fills which numbered slot) is exactly what the "config-driven mapping"
piece of the code scaffolding (below) exists to make explicit once real Content SIDs
exist.

### Template 1 — `returning_guest_winback_v1` (for `returning_guest_discount`)

- **Name**: `returning_guest_winback_v1`
- **Category**: Marketing
- **Body**:

  > Hi {{1}}! We loved hosting you and would love to welcome you back. As one of our
  > valued past guests, we'd like to offer you 10% off your next stay with us. Want us to
  > send you the discount code?
  - `{{1}}` = guest's name.

- **Buttons** (Quick Reply):
  - "Yes, send it" (affirmative)
  - "No thanks" (graceful decline)

**Why buttons, not an open-ended question**: a Quick Reply button gives the guest a
single, unambiguous, one-tap action instead of asking them to compose a reply. That
removes typing friction entirely and takes any ambiguity out of interpreting the reply
(no need to figure out if "yeah maybe" counts as a yes) — both of which measurably raise
reply rates over an open text question, and both replies (yes or no) equally open the
24-hour window described in §1.

**Copywriting principles applied**: a warm, personal opening ("We loved hosting you");
explicit "you're one of our valued past guests" framing rather than generic-sounding
marketing copy; a single, low-commitment ask (just tap a button to get the code, not
"book now"); no fake urgency or scarcity ("today only," "limited spots"); no manipulative
language pressuring a yes.

### Template 2 — `winter_lockin_program_v1` (for `winter_lockin_program`)

This offer isn't a discount code — it's a flat-price 2-week package — so the ask is "send
me details," not "send me a code."

- **Name**: `winter_lockin_program_v1`
- **Category**: Marketing
- **Body**:

  > Hi {{1}}! This winter we're launching something new — a 2-week "Lock-In & Focus"
  > retreat, a dedicated stretch of time to unplug and get deep work done. Since you've
  > stayed with us before, we wanted you to be among the first to hear about it. Want us
  > to send you the details?
  - `{{1}}` = guest's name.

- **Buttons** (Quick Reply):
  - "Yes, tell me more" (affirmative — deliberately "tell me more," not "yes, send it,"
    since there's no code being sent here, only information)
  - "No thanks" (graceful decline)

**Same copywriting principles as Template 1**: warm opening, "you've stayed with us
before" framing, single low-commitment CTA (just asking to hear more, not asking them to
commit to booking), no urgency/scarcity language, no manipulation — genuinely persuasive
because the offer itself is attractive and clearly described, not because of any dark
pattern in the ask.

### Opt-out requirement — a real gap, not just a footnote

Meta requires (or, at minimum, strongly expects) that Marketing-category templates offer
guests a "Stop promotions"-style opt-out, since Marketing templates are subject to
stricter policy scrutiny than Utility/Authentication templates and unwanted marketing
messages are a common cause of guest complaints and template/account restrictions.

**`guest_contacts` has no consent/opt-out column today** — confirmed by reading
`supabase/migrations/20260720150002_create_guest_contacts_reconstructed.sql`, the
migration that defines the table (`phone`, `guest_name`, `last_room`,
`last_stay_checkin`, `last_stay_checkout`, `total_stays`, `created_at`, `updated_at` —
nothing consent-related). That migration's own doc comment even flags this: an
opt-out/consent flag was "implied ... for campaign use but never named precisely enough
to reconstruct."

This is a real gap to close — not a formality — before actually sending either of these
templates to real guests: at minimum, a column to record that a guest opted out (from
tapping a "Stop promotions" button, or from any other channel) and campaign-drafting logic
that checks it before drafting a message for that guest. This doc does not build that
column or that check — it's flagged here as a prerequisite for launch (see §5), separate
from the template-drafting and code-scaffolding work this pass covers.

## 4. How to actually submit and verify these templates

1. **Create the template.** Two equivalent ways:
   - **Twilio Console** → Messaging → Content Editor → "Create new" → choose the
     `twilio/quick-reply` content type → set category to **Marketing** → paste in the body
     text with its `{{1}}` variable → add the two Quick Reply buttons with their exact
     copy from §3.
   - **Meta Business Manager** → WhatsApp Manager → Message Templates → "Create Template"
     → category **Marketing** → same body + button setup. (If created here instead of
     Twilio, it still needs to be linked into Twilio's Content API as an approved
     template before anything can send it via `ContentSid`.)
2. **Submit for review.** Meta reviews the template's wording against its policies.
   Realistic timelines: often just minutes, but can take up to 48 hours, and it can be
   **rejected** — most commonly for wording that reads as spammy, for missing an opt-out
   in a Marketing-category template (see §3's gap above), or for vague/ambiguous claims.
   If rejected, Meta gives a reason; the fix is almost always a small copy edit and
   resubmission, not a structural rework.
3. **Test once approved.** Two ways to try it before wiring anything into the live
   pipeline:
   - Twilio Console's Content Editor has a "Try it" / test-send tool — send the approved
     template to your own verified WhatsApp number directly from the console.
   - Or call Twilio's Messages API directly with `ContentSid` + `ContentVariables`
     targeting your own number (the same shape a future send helper would use — see
     `apps/guest-communication-agent/src/lib/twilio-send.ts`'s `sendWhatsAppMessage` for
     the free-text counterpart; a template-sending equivalent was scaffolded and then
     removed as dead code since this feature isn't wired up yet).
4. **Confirm the inbound webhook sees the button tap distinctly from free text.** This
   matters because eventually we'll want to detect a "yes" tap programmatically (e.g. to
   auto-advance a guest's funnel stage) rather than relying on GCA's conversational AI to
   re-interpret "Yes, send it" as if it were freely typed.

   Checked directly against
   `apps/guest-communication-agent/src/app/api/webhook/whatsapp/route.ts`: **Twilio does
   send a distinguishable payload for a Quick Reply tap** — per Twilio's own docs, a
   button tap arrives with the button's label in both `Body` and a `ButtonText` field,
   plus a `ButtonPayload` field carrying the button's configured ID (the value you set
   when creating the button in the Content Template Builder), separate from a normal
   free-text message which has none of these.

   **However, today's handler does not read or act on this.** The route only destructures
   `params.From` and `params.Body` (lines 52–53) — `ButtonPayload`/`ButtonText` are present
   in the full `params` object (`Object.fromEntries(new URLSearchParams(rawBody))`) but
   are never referenced anywhere in this file. A button tap today is invisible as a button
   tap: it flows through as an ordinary inbound message whose `Body` happens to be "Yes,
   send it" or "No thanks," handled by the same `runAgentTurn(...)` call as any other
   message. **This route will need updating** — to read `ButtonPayload` and branch on it —
   before anything can programmatically detect a template-button "yes" rather than
   relying on the conversational AI to notice the guest said yes. That update is not part
   of this pass; it's listed as follow-up work in §5.

## 5. What's still blocking a real launch

1. **A real WABA.** Needs a Meta-approved WhatsApp Business Account connected to Twilio,
   replacing the Sandbox (§2). External, human, business-side work — not part of this
   codebase.
2. **Both drafted templates submitted to and approved by Meta.** Neither
   `returning_guest_winback_v1` nor `winter_lockin_program_v1` (§3) has been created or
   submitted anywhere yet — this doc only drafts the copy.
3. **An opt-out/consent column added to `guest_contacts`**, plus campaign-drafting logic
   that respects it. Doesn't exist today (§3).
4. **Templates for the two existing recurring automations too.** `seasonal_nudge` and
   `stalled_link_nudge` message guests outside the 24-hour window exactly like the two new
   campaigns (§1's table) — they will also need their own approved templates before they
   can actually send anything once off the Sandbox. Out of scope for this pass (the user
   asked specifically about the two new campaigns); flagged here so it isn't lost.
5. **(Follow-up, not blocking template creation itself)** `apps/guest-communication-agent`'s
   inbound webhook doesn't yet distinguish a Quick Reply button tap from free text (§4) —
   needed before a "yes" tap can be detected programmatically rather than left to the
   conversational AI to infer.
