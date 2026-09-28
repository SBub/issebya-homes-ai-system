# Feature: Booking-link nudge shows the guest's number, and Reject leaves a contact reminder

## Metadata

issue_number: `130`
adw_id: `b1f5487b`
issue_json: `{"number":130,"title":"telegram-router: booking-link nudge must show the guest's number, and a Reject must leave a reminder that the owner promised to contact them"}`

## Feature Description

The GCA prompt now tells a guest whose booking link was not approved: _"I can't send the booking link for those dates right now. Sveta will contact you directly about them."_ That sentence is a promise the owner has to keep by hand, but the Telegram `send_booking_link` nudge gives her nothing to keep it with: it carries no phone number, and after a Reject tap the message just says `❌ Rejected`.

This feature makes the booking-link nudge self-sufficient:

1. `POST /api/owner-nudges` adds a `Guest: <phone>` line to the `send_booking_link` message text (the phone is already in the request body).
2. When the owner taps a button, `POST /api/telegram/webhook` reads that phone back out of the echoed `callback_query.message.text` (the same in-band technique `MISSING_INFO_REF_REGEX` uses for `[ref:…]`) and edits the message to:
   - Approve: `{original}\n\n✅ Approved. Link sent to the guest.`
   - Reject: `{original}\n\n❌ Rejected. The guest was told: "Sveta will contact you directly about those dates." Please message them: <phone>`
   - Neither form found a phone line (older nudges still on screen): fall back to today's `✅ Approved` / `❌ Rejected` suffix.

The owner can act on every booking-link decision from Telegram alone.

## User Story

As the property owner handling booking-link approvals in Telegram
I want the nudge to show the guest's phone number, and a Reject to leave me a reminder of what the guest was just promised
So that I can keep the "Sveta will contact you directly" promise without opening the CRM or the WhatsApp history

## Problem Statement

The `send_booking_link` nudge (`apps/telegram-router/app/routers/owner_nudges.py`) is the only owner-nudge category that omits the guest's phone; `missing_info` and `wants_human` both include `Guest {phone}`. After a Reject, `_handle_booking_link_decision` (`app/routers/telegram_webhook.py`) edits the message to `{original}\n\n❌ Rejected` and nothing else, so the owner has neither the number nor a reminder that GCA just told the guest she would contact them. `callback_data` cannot carry the phone: `booking_reject:` + a 36-char UUID is already 51 of Telegram's 64 bytes.

## Solution Statement

Carry the phone in-band in the message text, not in `callback_data`:

- Compose the nudge with a fixed-format line `Guest: <phone>` directly after the `reason` line. The format is chosen to not collide with the other categories (`Guest {phone} asked:` / `Guest {phone} needs you:` have no colon after `Guest`).
- In `telegram_webhook.py`, add `BOOKING_LINK_GUEST_PHONE_REGEX = re.compile(r"^Guest: (\S+)$", re.MULTILINE)` and a `_extract_booking_link_guest_phone(text: str | None) -> str | None` helper mirroring `_extract_missing_info_correlation_id`. The captured value is opaque text, never validated as E.164.
- Add a small pure helper `_booking_link_outcome_suffix(approved: bool, phone: str | None) -> str` that returns the approved/rejected suffix, or the legacy plain label when `phone` is `None`. `_handle_booking_link_decision` uses it for the edited text. The toast passed to `answer_callback_query` stays `✅ Approved` / `❌ Rejected` (a short toast; the long reminder belongs in the message).
- Nothing else changes: `callback_data` prefixes, `OwnerNudgeRequest`, the `{"ok": False, "error"}` 500 shape, `send_with_retry`, and the always-200 webhook. No new Telegram or GCA call is introduced; the existing `edit_message_text` is already wrapped in `with_span`/`mark_span_failed` inside `app/telegram.py`, so the tracing rule is satisfied without new spans.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - Repo-wide rules, including the Python-workspace `--filter=./apps/<dir>` requirement.
- `docs/conditional-docs.md` - Indexes `apps/telegram-router/AGENTS.md` (always) and `apps/telegram-router/README.md` (when changing either route).
- `apps/telegram-router/AGENTS.md` - The two correlation mechanisms (booking-link correlation in buttons, no `[ref:…]` tag), the always-200 rule, the tracing rule. Needs a short addition describing the new `Guest:` line as a third in-band channel.
- `apps/telegram-router/README.md` - Routes section describes `POST /api/owner-nudges` and the webhook; update for the new nudge text and Reject reminder.
- `apps/telegram-router/app/routers/owner_nudges.py` - Composes the `send_booking_link` text; add the `Guest: {phone}` line and update the module comment.
- `apps/telegram-router/app/routers/telegram_webhook.py` - `_handle_booking_link_decision`; add the phone regex, extractor, suffix helper, and new edit text.
- `apps/telegram-router/app/models.py` - `TelegramCallbackMessage.text` (optional) is where the echoed text arrives; read-only reference, no change.
- `apps/telegram-router/app/telegram.py` - `edit_message_text` already traced; read-only reference, no change.
- `apps/telegram-router/tests/test_owner_nudges.py` - `TestSendBookingLink`; extend.
- `apps/telegram-router/tests/test_telegram_webhook.py` - `BOOKING_NUDGE_MESSAGE`, `TestBookingApproveReject`, `TestReplyToOwnerNudge`; extend.

### New Files

None.

## Implementation Plan

### Phase 1: Foundation

Define the shared wire format once, as text: the nudge line is exactly `Guest: <phone>` on its own line. In `telegram_webhook.py` add the anchored multiline regex and the extractor helper next to the existing `MISSING_INFO_*` regexes, with a comment pointing back at `owner_nudges.py`'s composition (the same cross-reference style the missing-info regexes use).

### Phase 2: Core Implementation

- `owner_nudges.py`: change the `send_booking_link` branch to
  `f"🔗 Booking link\n{reason}\nGuest: {phone}\n\nApprove sending the booking link to the guest?"`.
- `telegram_webhook.py`: add the owner-reminder constants and `_booking_link_outcome_suffix`, then have `_handle_booking_link_decision` compute `phone = _extract_booking_link_guest_phone(message.text)` and edit to `f"{message.text or ''}\n\n{suffix}"`. Keep the toast labels and every failure branch unchanged.

### Phase 3: Integration

Update the module comment in `owner_nudges.py`, the comment above `_handle_booking_link_decision`, the README routes section, and `apps/telegram-router/AGENTS.md` so the third in-band channel (phone in text, read back on callback) is documented next to the two correlation mechanisms. Confirm no `[ref:` token is introduced and that the missing-info reply flow is untouched.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the phone line to the booking-link nudge

- In `apps/telegram-router/app/routers/owner_nudges.py`, `send_booking_link` branch, compose:
  ```
  🔗 Booking link
  {reason}
  Guest: {phone}

  Approve sending the booking link to the guest?
  ```
- Update the module comment's `send_booking_link` bullet: mention the `Guest: <phone>` line, that it is read back by the webhook on a button tap (the phone cannot fit in `callback_data`: 64-byte limit), and that it must stay in exactly this format.
- Do not touch the button construction, `send_with_retry`, or the 500 response.

### 2. Extend `tests/test_owner_nudges.py`

- In `TestSendBookingLink`, add `test_includes_guest_phone_line`: assert `"\nGuest: +351920742845\n" in text` (the phone from `BOOKING_BODY`), and that the `[(b.text, b.callback_data) ...]` list is still exactly `booking_approve:corr-abc-123` / `booking_reject:corr-abc-123`.
- Existing `test_does_not_append_ref_tag` stays and must still pass.

### 3. Parse the phone and build the outcome suffix in the webhook

- In `apps/telegram-router/app/routers/telegram_webhook.py`:
  - Add, next to the missing-info regexes:
    ```python
    # Matches the `Guest: <phone>` line in a send_booking_link nudge's body (see
    # owner_nudges.py). The phone can't ride in callback_data (64-byte limit),
    # so it travels in the message text, which Telegram echoes back on
    # callback_query.message.text. Opaque token, not validated as E.164.
    BOOKING_LINK_GUEST_PHONE_REGEX = re.compile(r"^Guest: (\S+)$", re.MULTILINE)
    ```
  - Add module constants for the owner-facing copy:
    - `BOOKING_APPROVED_SUFFIX = "✅ Approved. Link sent to the guest."`
    - `BOOKING_REJECTED_GUEST_TOLD = "Sveta will contact you directly about those dates."`
  - Add `_extract_booking_link_guest_phone(text: str | None) -> str | None`, same shape as `_extract_missing_info_correlation_id`.
  - Add `_booking_link_outcome_suffix(approved: bool, phone: str | None) -> str`:
    - `phone is None` → `"✅ Approved"` / `"❌ Rejected"` (legacy fallback for nudges sent before this change).
    - approved → `BOOKING_APPROVED_SUFFIX`.
    - rejected → `f'❌ Rejected. The guest was told: "{BOOKING_REJECTED_GUEST_TOLD}" Please message them: {phone}'`.
  - In `_handle_booking_link_decision`, keep `outcome_label` for `answer_callback_query`; for the edit, use `suffix = _booking_link_outcome_suffix(approved, _extract_booking_link_guest_phone(message.text))` and `edit_message_text(message.message_id, f"{message.text or ''}\n\n{suffix}")`.
  - Update the comment above `_handle_booking_link_decision` to describe the phone read-back and fallback.
- No new Telegram/GCA calls; no new `with_span` needed. All branches still end with the webhook returning 200.

### 4. Extend `tests/test_telegram_webhook.py`

- Add `BOOKING_NUDGE_MESSAGE_WITH_PHONE` mirroring the new composition (`...2026-09-05.\nGuest: +351920742845\n\nApprove sending...`). Keep the existing `BOOKING_NUDGE_MESSAGE` (no phone line) as the legacy fixture.
- In `TestBookingApproveReject` add:
  - `test_reject_with_phone_edits_in_reminder_and_number`: callback `booking_reject:corr-abc-123` + phone message → `edit_message_text` text contains `+351920742845`, contains `The guest was told: "Sveta will contact you directly about those dates."`, contains `Please message them: +351920742845`, and still starts with the original message text. Toast is still `❌ Rejected`. Status 200.
  - `test_approve_with_phone_edits_in_approved_suffix`: `booking_approve:…` + phone message → edited text ends with `\n\n✅ Approved. Link sent to the guest.`.
  - `test_reject_without_phone_line_falls_back_to_plain_suffix`: legacy `BOOKING_NUDGE_MESSAGE` → edited text ends with `\n\n❌ Rejected` and does not contain `Please message them`.
  - `test_approve_without_phone_line_falls_back_to_plain_suffix`: legacy message → edited text ends with `\n\n✅ Approved`.
  - `test_callback_message_without_text_still_200`: message with `message_id` only (no `text`) → 200, edit called with the plain fallback suffix, no exception.
- In `TestReplyToOwnerNudge`, add `test_reply_to_booking_link_nudge_falls_through`: a reply whose `reply_to_message.text` is `BOOKING_NUDGE_MESSAGE_WITH_PHONE["text"]` → 200, `answer_owner_nudge` not called (proves the new line did not create a ref-tag-like match).
- Negative probe (not committed): temporarily change `BOOKING_LINK_GUEST_PHONE_REGEX` to `r"^Phone: (\S+)$"`, run `uv run --directory apps/telegram-router pytest tests/test_telegram_webhook.py -k reject_with_phone`, confirm it FAILS on the missing number, then revert and confirm it passes. Record the exact commands and outcome in the implementation report.

### 5. Update documentation

- `apps/telegram-router/README.md` routes section: `POST /api/owner-nudges` notes the booking-link nudge includes a `Guest: <phone>` line; `POST /api/telegram/webhook` notes that Approve/Reject edits the nudge in place, and Reject appends what the guest was told plus the number to message. Add to the "correlation is in-band" bullets that the guest phone rides in the booking-link text and is regex-read on the callback.
- `apps/telegram-router/AGENTS.md`, "No DB, correlation is entirely in-band": add a bullet that the `send_booking_link` text's `Guest: <phone>` line is a load-bearing format read by `BOOKING_LINK_GUEST_PHONE_REGEX`, must not become a `[ref:…]` tag, and old nudges without it must keep falling back to the plain suffix.
- No em-dashes in new copy (owner preference); use commas, periods, colons.

### 6. Run the Validation Commands

- Execute every command in `Validation Commands` and confirm all pass.

## Testing Strategy

### Unit Tests

All tests are pytest in `apps/telegram-router/tests/`, using the existing `client` fixture (ASGI transport) and the module-level `mocks` fixtures that monkeypatch `send_message`, `edit_message_text`, `answer_callback_query`, and `answer_booking_link_approval`. No network, no Telegram, no GCA.

### Test Coverage

This workspace is Python/pytest, not Vitest, so the `*.unit.test.ts` / `*.browser.test.tsx` / Playwright layers do not apply; the cheapest equivalent layer is the app's pytest route tests.

- `tests/test_owner_nudges.py::TestSendBookingLink::test_includes_guest_phone_line` catches the nudge being sent without the `Guest: <phone>` line (fails today) or with changed `callback_data`.
- `tests/test_telegram_webhook.py::TestBookingApproveReject::test_reject_with_phone_edits_in_reminder_and_number` catches a Reject that does not surface the number and the promise (fails today: edit text is just `❌ Rejected`).
- `tests/test_telegram_webhook.py::TestBookingApproveReject::test_approve_with_phone_edits_in_approved_suffix` catches the approved suffix missing (fails today).
- `tests/test_telegram_webhook.py::TestBookingApproveReject::test_*_without_phone_line_falls_back_to_plain_suffix` and `test_callback_message_without_text_still_200` catch a regression for nudges already on screen.
- `tests/test_telegram_webhook.py::TestReplyToOwnerNudge::test_reply_to_booking_link_nudge_falls_through` guards the missing-info reply flow.

No browser coverage (Playwright spec or `e2e/*.md` journey): this change is confined to `apps/telegram-router`, a webhook service with no browser surface. Only `apps/website` has one.

### Edge Cases

- Callback on a nudge sent before this deploy (no `Guest:` line) → plain `✅ Approved` / `❌ Rejected` suffix.
- `callback_query.message.text` is `None` → plain suffix, still 200.
- `callback_query.message` is `None` → no edit, toast only, still 200 (existing behavior).
- Phone not in E.164 shape (e.g. `whatsapp:+351…` or a local number) → echoed verbatim; not validated.
- `reason` text itself containing `Guest` (e.g. a guest named "Guest") → no match, since the regex requires line start plus `Guest: ` with a colon and a single non-whitespace token to end of line.
- GCA relay fails or raises → unchanged: `Failed — try again` toast, no edit.
- Owner replies (not taps) to a booking-link nudge → falls through to noop; no `[ref:` added.

## Acceptance Criteria

- The `send_booking_link` nudge text contains a `Guest: <phone>` line directly after the reason line, and both buttons keep `callback_data` exactly `booking_approve:<correlationId>` / `booking_reject:<correlationId>`.
- The booking-link nudge text contains no `[ref:` token.
- Reject on a nudge with a phone line edits the message to `{original}\n\n❌ Rejected. The guest was told: "Sveta will contact you directly about those dates." Please message them: <phone>`.
- Approve on a nudge with a phone line edits the message to `{original}\n\n✅ Approved. Link sent to the guest.`.
- Nudges without a phone line (or with no text) fall back to `✅ Approved` / `❌ Rejected`.
- `OwnerNudgeRequest`, the 500 `{"ok": False, "error"}` shape, `send_with_retry`, and the always-200 webhook behaviour are unchanged.
- Negative probe with a broken phone regex makes the reject test fail; reverted before commit.
- README and `apps/telegram-router/AGENTS.md` describe the new line and read-back.
- All Validation Commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `uv run --directory apps/telegram-router pytest` - Full telegram-router pytest suite, including the new tests
- `uv run --directory apps/telegram-router ruff check .` - Ruff lint
- `uv run --directory apps/telegram-router ruff format --check .` - Ruff formatting
- `uv run --directory apps/telegram-router mypy app` - mypy strict (strict is set in `pyproject.toml`)
- `yarn prettier --check .` - Formatting matches the repo config (covers the edited Markdown), so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/telegram-router` - Lint passes for the workspace (turbo-synthesized ruff task)
- `yarn turbo run typecheck --filter=./apps/telegram-router` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/telegram-router` - Unit tests pass, proving the feature works with zero regressions
- `yarn turbo run build --filter=./apps/telegram-router` - Production build task (the app has no build script; expected to report no build task and exit 0)

## Notes

- No new dependencies.
- Never start a dev server for telegram-router (port 3003 is owned by the webhook gateway). Verification is by pytest only in the pipeline.
- Post-deploy manual check (issue's Verification, owner-performed, not part of the ADW run): trigger a booking link from WhatsApp, tap Reject; the Telegram message shows the guest's number and the reminder, and the guest receives the "Sveta will contact you directly" reply. Screenshot both. After deploy, hit `/api/health`.
- The owner name "Sveta" is hardcoded in the reminder to mirror the GCA prompt's wording (Braintrust `gca-system`, rule 5). If that prompt changes, update `BOOKING_REJECTED_GUEST_TOLD` to match; it is a module constant for that reason.
- Out of scope: GCA prompt changes, distinguishing reject from timeout on the GCA side (`requestApprovalGate`), persistent to-do list or reminder scheduling.
