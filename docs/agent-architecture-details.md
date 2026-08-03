# Agent Architecture — Details

Companion document to `docs/agent-architecture.mmd`. The `.mmd` file's node labels are intentionally kept short (structural map only, scannable at a glance); this file is where the "why" — build history, endpoints, caveats, and live-verification notes — for every node, and the verification narrative for every tested edge, actually lives.

## Tools

### AVAIL — Availability Tool
`GET issebya.com/api/availability?room=room1|room2`

### FIN — Finance Tool
No additional description beyond the node name.

### CRM (apps/crm, port 3006)
Extracted out of `apps/guest-communication-agent` into its own app on 2026-07-21: owns the `guest_contacts` table (finance-sync, phone normalization). Auto-populated from `apps/finance`'s `finance_bookings` via `POST /api/guest-contacts/sync` (apps/finance calls this after every CSV upload). Since 2026-07-23 (e1aab5c, "Remove Notion sync entirely — Postgres is the single source of truth") this endpoint no longer does a pull-refresh-push round trip against Notion — it now only calls `syncGuestContactsFromFinance()`, re-deriving `guest_contacts` (name/room/dates/total_stays) straight from `finance_bookings`, no Notion involvement at all; phone numbers, previously enriched via a human-maintained "Guest Contacts" Notion database, are now added by a human directly editing the `guest_contacts` table via Supabase Studio's own Table Editor (already running locally, free — no replacement app was built, nothing new syncs anywhere).

New `GET /api/guest-contacts/lookup?phone=` returns raw past-stay facts (`last_room`, `last_stay_checkin`, `total_stays`) for a normalized phone, no interpretation — called by `apps/guest-communication-agent` on every conversational turn via a new `src/lib/crm.ts` client, deliberately resilient (returns null on any failure, never throws) since it sits in GCA's live request path; this lookup endpoint (auth, validation, phone normalization) plus GCA's real `CRM_API_URL`/`CRM_API_KEY` env wiring to it were both live-verified this session. Communication history (GCA's own `whatsapp_conversations`/`whatsapp_messages`) is untouched by this extraction and still lives in GCA.

Since 2026-07-21 also owns campaign-conversion-tracking (Phase 1 + Phase 2, both complete): `guest_contacts` gained `funnel_stage` (new -> informed -> link_sent -> booked, forward-only) plus `last_interaction_at`/`link_sent_at`/`stage_updated_at`, bumped every turn via new `POST /api/guest-contacts/touch` (called by GCA's webhook after every reply with a `stageHint` derived from that turn's tool calls; CRM owns the forward-only upgrade rule centrally so GCA never needs to know the guest's current stage, and the call never blocks the guest-facing response on failure).

New `campaigns`/`promo_codes` tables back a promo-code lifecycle: `GET /api/promo-codes/:id` (drafted `message_text` + `guest_phone`), `POST .../mark-sent` and `.../mark-rejected` (both 409 outside status `'issued'`, never silently overwriting a decision that already happened). New `POST /api/cron/check-stalled-guests` (`src/lib/campaigns.ts`) finds funnel-stalled guests (`funnel_stage='new'` idle >3d, `'link_sent'` idle >5d), drafts one of two fixed message templates per candidate — `stalled_link_nudge` is finished copy, `seasonal_nudge` still ships an intentional placeholder, "[fill in what's happening locally this season]", real seasonal copy is the user's to add later — and best-effort pushes each draft to `apps/telegram-router`'s new `POST /api/campaign-drafts` for owner approve/reject. Like check-reminders/check-digest/check-health elsewhere in this diagram, no real external scheduler triggers this cron yet — this session's run was a manual curl, not a live cadence. Live-verified this session end-to-end, not just via mocks: a seeded stalled guest produced a real draft, a second run correctly skipped the already-nudged guest, and the full Telegram approve/reject round trip through telegram-router and GCA (see those nodes/edges) was exercised for real. Still does not fully measure instrument effectiveness — issued -> sent/rejected and a guest's funnel stage since are tracked, but there is no real redemption/conversion-to-paid-booking tracking yet (see STRUCTURAL GAPS #4, now partially addressed).

Since 2026-07-21 also exposes `GET /api/campaigns/stats`: a PII-free aggregate view of `promo_codes` counts per (campaign kind, status) — kind plus five integer counts (issued/sent/rejected/expired/redeemed), never `guest_contact_id`/phone/name/code. Always reports both known kinds (`seasonal_nudge`, `stalled_link_nudge`) even at zero activity, so the shape is stable from day one. `redeemed` is documented as always 0 for now — no writer sets it yet, since real booking-redemption tracking still needs the separate, still-paused website checkout change. Live-verified this session: hit directly (401 without a key, correct all-zero shape for both kinds), then exercised via Orch-A's preview-digest script against the live crm server, confirming both the zero-state and, after seeding one real "sent" promo code, the correctly-aggregated non-zero count reached the actual rendered digest.

## Agents

### CAMP — Campaign Agent
Promotes right product to the right audience: product launch, brand awareness, promotional or seasonal, social media, email marketing.

### ADS — Ads Agent
Stub, empty.

### PR — PR Agent
Stub, empty.

### DESIGN — Designer Agent
Owns design system; creates digital + print assets.

## Shared Teams

### SWE — Software Engineering Team
Webpage updates, custom solutions; shared across projects.

## Human Work (not yet delegated)

### HUMAN_CONTENT — Create Content
Filming/making videos.

### HUMAN_LAUNDRY, HUMAN_CHECKIN, HUMAN_PLATFORM_REPLY, HUMAN_PLATFORM_MGMT
No additional description beyond the node names (Laundry; Guest Check-ins; Answering Guests on Booking Platforms; Managing Booking Platforms).

## Finance System

### UPLOAD — Upload Page (apps/finance /upload)
Human uploads Airbnb + Booking.com CSVs.

### CRON_M30 — Modelo30 Ready
Event-driven — triggered right after upload, not a separate schedule; sends Modelo30 report.

### CRON_INV — File Invoices
Event-driven — triggered right after upload; guest name + amount paid per reservation, as a CSV attachment.

### CRON_TAX — Tourist Tax
Event-driven — triggered when the uploaded month closes a quarter; CSV attachment.

### FIN_GAPS — Not yet built (Finance Gaps)
- IRS report (year-end)
- expense tracking
- P&L
- income forecast

## Notification Center

### NOTIF — Notification Center (apps/notifications)
Plain logic API, no Telegram awareness — `GET /api/reminders/due`, `POST .../ack`, `POST .../sent`. A reminder is due when unacknowledged, past `due_at`, and `renotify_every` has elapsed since last sent (or never sent at all). Recurrence isn't auto-regenerated — a documented gap, not an oversight.

### CRON_RFI — Cron: Annual (January)
RFI-21 re-issued by Airbnb; download, fill Section VI, resubmit. Booking.com equivalent: unknown. Out of scope for v0.1.0.

### CRON_AIRBNB_PRICING — One-time: Oct 13 2026
Airbnb retires split-fee pricing for EU hosts — Modelo30/invoice fee formulas need updating (see `docs/finance/modelo-30-filing.md`, `invoices-filing.md`). Out of scope for v0.1.0.

### CRON_EOM — Cron: 2nd of Every Month
Nudge to upload last month's Airbnb + Booking.com CSVs via apps/finance's /upload page, per platform. Out of scope for v0.1.0.

## Property Mgmt System

### CRON_PROJ — Cron: 7 Days Before Month-End
Send cleaning lady projected cleaning dates.

### CRON_CONFIRM — Cron: 48h Before Checkout
Draft checkout confirmation for cleaning lady.

### PMA — Webhook Listener
Not an LLM agent — receives cleaning lady messages via webhook, drafts a reply, sends to Telegram Gateway. Standalone, not delegated by Orch-A.

## System Health

### HEALTH — System Health Monitor
Runs via `apps/telegram-router`'s `POST /api/cron/check-health` (no real external scheduler wired yet, same open question as check-reminders/check-digest) or the on-demand `/heartbeat` command (same underlying check; always additionally replies with current status). Checks liveness of notifications, finance, and social-media via each app's own `GET /api/health` (deep: real Postgres `SELECT 1` for notifications/finance, since both silently stop working if their DB dies while the process stays up; shallow process-check for social-media) plus orch-a's `GET /health-check` (shallow; NOT `/health` — Mastra's deployer ships a built-in unauthenticated `/health` that silently shadows any custom route there). State persisted per-service in Postgres table `health_check_state` (`is_healthy`, `last_checked_at`, `last_status_change_at`, `last_error`, `consecutive_failures`). Alert-on-transition only: red alert sent the moment a service goes healthy->unhealthy, silent while it stays down, green recovery message with downtime duration on unhealthy->healthy, silent while healthy. A different concern from Orch-A's own data-freshness checks (`checkHeartbeat` etc., already reported inside the digest) — this answers "is the process up," not "is the data stale." Does not check `apps/telegram-router` itself (self-check would be trivially always-healthy; real self-monitoring needs external uptime monitoring, out of scope).

## Social Media System

### SOC_GEN — Social Media Post Generator
Single LLM call, not an autonomous agent — receives a post idea via an HTTP call from the Telegram Router (`POST /api/generate`), generates alt text (~100 SEO/AEO keywords) + a caption that continues the post's idea and ends in 5 hashtags, and returns the result. No Telegram awareness at all. Standalone, not delegated by Orch-A (same shape as PMA).

## Telegram Router

### ROUTER — Telegram Router
Owns all Telegram I/O (webhook + sending); dispatches commands to plain logic APIs in other apps — `/social` -> social-media, `/digest` -> pulls Orch-A's `GET /digest` and sends it, `/heartbeat` -> runs the same liveness check as check-health across notifications/finance/social-media/orch-a and always replies with current status, `/cron list` -> renders the seeded reminder cron jobs, a reminder's "Done" button and the periodic due-check -> apps/notifications.

Since 2026-07-21 also its first-ever callee, not just caller: new `POST /api/campaign-drafts` (guarded by `X-API-Key` against `TELEGRAM_ROUTER_API_KEY`, this app's first inbound API-key-guarded route — every other route here has instead guarded inbound Telegram/cron callers via `verifyWebhookSecret`/`verifyCronSecret`) receives a drafted campaign nudge from CRM's check-stalled-guests cron and sends it to TG as a message with two inline buttons (Approve / Reject, callback data `nudge_approve:<id>`/`nudge_reject:<id>`). The existing webhook's callback-query handling now branches on those prefixes: approve calls CRM's `GET /api/promo-codes/:id` first (guards against a double-tap or retry acting twice), then GCA's new `POST /api/send`, then — only after a successful send — CRM's mark-sent; reject calls CRM's mark-rejected directly, no GCA involvement. Live-verified this session end-to-end via direct authenticated webhook calls simulating both button presses: confirmed reject sets the promo code to `'rejected'` and a double-tap gracefully no-ops, confirmed approve's full send-then-mark-sent chain fired for real, including a real call to Twilio's live API (one of Twilio's own documented magic/test numbers, so nothing reached a real device).

For now still mostly a simple calling system — designed to grow into an actual orchestrator once the systems it dispatches to become full agents, same analyze -> decide -> dispatch -> report shape as Orch-A, just reactive instead of scheduled.

## Orchestrator (Orch-A)
Analyze -> decide -> dispatch -> report loop; the report step just renders the digest and returns it via `GET /digest` — `apps/telegram-router` is the one that actually sends it. No Telegram awareness at all. Since 2026-07-21 the Analyze step also pulls CRM's aggregate campaign stats (new `src/tools/campaigns.ts`'s `fetchCampaignStats`) alongside Availability and Finance, passed through Decide unchanged and rendered as a new "Campaigns" section in the digest, right after Finance — no new anomaly-detection heuristic added, just the raw per-kind counts.

## Guest-Comms Agent (GCA)
Ported into `apps/guest-communication-agent` here (2026-07-20) from `issebya-homes-website`, faithfully — originally as a LangGraph.js graph (`load_context` -> agent <-> 5 tools -> END), same DB schema (`whatsapp_conversations`/`messages`/`escalations` — the hand-reconstructed `guest_contacts` table that briefly lived here too, no committed migration for it existed anywhere in the source repo, was extracted out to its own app, `apps/crm`, on 2026-07-21; GCA now calls CRM's `GET /api/guest-contacts/lookup` via a new `src/lib/crm.ts` client instead of querying that table directly, resiliently returning null on any failure since it sits in the live conversational request path). `POST /api/webhook/whatsapp` validates a real `X-Twilio-Signature` and runs the agent turn for real. LIVE end-to-end on real WhatsApp traffic via Twilio's free WhatsApp Sandbox + ngrok: real guest messages answered in-character by the real LangSmith Prompt Hub prompt (`whatsapp-booking-agent:production`), and a real out-of-coverage question correctly escalated. Escalation alerts originally sent Telegram directly (own bot token), bypassing `apps/telegram-router` like every other app here already did — a known inconsistency, ported as-is; the alert's old dead "View conversation" dashboard link (`apps/crm-dashboard` doesn't exist here) had been removed, just including the conversation ID instead. As of 2026-07-25 this inconsistency is resolved: all escalation categories now go through the same path — `performEscalation` always inserts the `escalations` row and calls `apps/telegram-router`'s `POST /api/escalation-nudges` (now taking `reasonCategory`/`conversationId` too, composing a plain one-way alert for the non-`missing_info` categories and the existing reply-inviting message for `missing_info`) and stores the returned `telegram_message_id` on the row for every category. As of 2026-07-26 there are three categories — `wants_human`/`complaint`/`missing_info` — down from the original four: `unhappy_guest` was removed as a deliberate product decision, not a bug fix, since general guest unhappiness is now handled by the agent's own conversational judgment (a system-prompt concern, in LangSmith's Prompt Hub) rather than a recorded escalation; a genuine complaint still is one. GCA's own raw-fetch `src/lib/telegram.ts` (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) is deleted; GCA no longer talks to Telegram directly at all. Because every category now gets a `telegram_message_id`, the webhook's `handleEscalationReply` (ROUTER) gained an explicit `reason_category === "missing_info"` guard — a reply to a non-missing_info nudge gets a plain acknowledgment instead of being relayed to the guest or sent to GCA's resolve endpoint, which previously was only safe by omission (nothing but missing_info ever had a `telegram_message_id` to correlate against).

As of 2026-08-03, GCA's LangGraph.js `StateGraph` (`src/graph/` — one node per tool, explicit conditional-edge routing, a debug-only `MemorySaver` checkpointer) was replaced with a single plain async tool-calling loop: `src/agent/run-turn.ts`'s `runAgentTurn(input, config)`. Rationale: GCA is, and per the repo's own planning notes is staying, a single agent with a single sequential tool-calling loop — no multi-agent routing, supervision, or fan-out — so the graph/node/edge machinery was ceremony that didn't improve answer quality and worked against the repo's stated preference for simple architecture and no duplicate abstractions. This was a structural simplification only, not a behavior change: `runAgentTurn` builds `[...historyMessages, new HumanMessage(incomingMessage)]` directly (no more routing the new message through a side-channel `incomingMessage` state field to dodge LangGraph's append-only `messages` reducer), loops `{ call model -> execute any tool_calls -> feed results back }` until a final text reply, the `MAX_AGENT_STEPS` (8) cap, or the empty-reply safety net, and preserves the exact same control-flow quirk the graph had: after ANY tool fires (including `escalateToOwner`, regardless of `reason_category`), the loop goes back for another model round rather than returning immediately, and `missingInfoEscalated` is sticky (set `true` once a `missing_info` escalation fires, never reset back to `false` by a later round's normal return) — so a `missing_info` escalation still lets the model compose one more round of real text that the webhook route then discards, exactly as before. The 5 tools moved from `src/graph/tools/*.ts` to `src/agent/tools/*.ts` unchanged; `src/graph/tools.ts`'s barrel file was not recreated at the new location (this repo deliberately avoids barrel/index re-export files — `run-turn.ts` imports each tool directly from its own file). The `@langchain/langgraph` dependency was removed from `package.json` entirely.

Also as of 2026-08-03, immediately following the LangGraph removal above, GCA's actual model-calling layer moved from `@langchain/openai`'s `ChatOpenAI` (`.bindTools().invoke()`) to Vercel AI SDK's `generateText` (the `ai` package) + `@ai-sdk/openai`'s `createOpenAI`, the same OpenRouter-as-OpenAI-compatible-endpoint convention `src/tools/search-property.ts` and the escalation-resolve route already used for embeddings (`createOpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" })`; the chat model uses `.chat(MODEL)` specifically, matching OpenRouter's actual Chat Completions-shaped wire format rather than `createOpenAI`'s default Responses-API-targeting call form). `runAgentTurn`'s own `while (true)` loop still drives round-by-round control flow itself — each `invokeModel()` call passes `stopWhen: stepCountIs(1)` so `generateText` performs exactly one model call (plus that round's own tool executions) before returning, never AI SDK's own multi-step auto-looping — so the step-cap (`MAX_AGENT_STEPS`)/empty-reply-retry/sticky-`missingInfoEscalated` semantics documented above are unchanged, just running on AI SDK's message/result shapes (`ModelMessage[]`, `GenerateTextResult`) instead of LangChain's (`BaseMessage[]`, `AIMessage`). The 5 tools moved from LangChain's `tool()` (`@langchain/core/tools`, a `schema` + `(args, config: RunnableConfig)` implementation) to AI SDK's `tool()` (`"ai"`, an `inputSchema` + `execute` function) — `getPricing`/`checkAvailability`/`answerPropertyQuestion` need no per-turn context and stay single module-level instances; `sendBookingLink`/`escalateToOwner` need this turn's `conversationId`/`phone`/`triggerMessageId` and became factory functions (`createSendBookingLinkTool`/`createEscalateToOwnerTool` in their own files) that `run-turn.ts`'s `buildAgentTools` calls fresh every `runAgentTurn()` invocation, closing over that turn's context — the AI-SDK-native replacement for LangChain's `RunnableConfig.configurable` threading mechanism, since AI SDK tool `execute` functions only ever receive `{ toolCallId, messages, abortSignal, experimental_context }`, no arbitrary per-call config bag. Tool dispatch itself (running each round's tool calls and feeding results back) is now handled automatically by `generateText` via each tool's own `execute`, replacing `run-turn.ts`'s old manual `invokeTool()`/`Promise.all` fan-out — `result.response.messages` (assistant message + correlated tool-result message) is appended straight into the running `messages` array each round. One deliberately narrow LangChain usage remains: `@langchain/core/load`'s `load()` + `@langchain/core/prompts`'s `ChatPromptTemplate` type, used only to deserialize a LangSmith Prompt Hub commit's manifest into a `ChatPromptTemplate` so it can be `.invoke()`d with `guest_memory_block` — LangSmith's own `langsmith` package (checked at v0.7.17) exposes no lighter helper that returns a prompt commit as plain text (`pullPromptCommit()`'s `manifest` is just a raw serialized object graph; the only other candidate, `_pullPrompt`, is explicitly documented as "should not be used directly, use `import { pull } from 'langchain/hub'` instead" and returns the same JSON, not plain text), so this remains the only real way to turn a Prompt Hub commit into usable text. The result is flattened to a plain string (`promptValue.toChatMessages()[0].content as string`) immediately after being invoked with that turn's `guest_memory_block`, so nothing past that line — including every message/tool primitive in the rest of the loop — ever touches a LangChain object. `@langchain/openai` was removed from `package.json` entirely; `@langchain/core` stays, scoped to exactly this one usage.

**Known gap from this migration, not fixed here (a product decision, not an oversight):** LangChain has automatic LangSmith tracing built in — the webhook route used to generate a `runId` (`crypto.randomUUID()`) and pass it into `ChatOpenAI.invoke()`'s `RunnableConfig.runId`, which LangChain's tracer used as the root run id for a real LangSmith trace, and that same id is stored as `whatsapp_messages.langsmith_run_id` for later use by `POST /api/messages/[messageId]/feedback`'s `langsmithClient.createFeedback(langsmithRunId, ...)` call. Vercel AI SDK has no automatic LangSmith integration — only its own OpenTelemetry-based `experimental_telemetry`, which is not wired up to LangSmith as part of this migration (doing so cleanly would mean standing up a real OTEL exporter pointed at LangSmith's OTEL ingestion endpoint plus mapping a client-supplied UUID into a valid 128-bit OTEL trace id sharing that exact value, a nontrivial new integration with new dependencies, not a "swap the model call" change). The webhook route and `resume-conversation.ts` still generate and store a `runId`/`langsmith_run_id` (unchanged, since neither `conversations.ts` nor the feedback route's own DB-column semantics were in scope for this migration), but that id no longer corresponds to any real LangSmith run — a "flag after" feedback submission against a message from a post-migration turn will fail against LangSmith's API. Needs a product decision (build the OTEL bridge, switch to a different feedback-correlation id, or accept the eval-feedback feature is broken for now) before that feature can work again.

Since 2026-07-21 the webhook route also derives a `stageHint` per turn (new `src/lib/funnel-stage.ts`'s `deriveStageHint`) and calls CRM's `POST /api/guest-contacts/touch` with it, after the reply is already recorded, never blocking the guest-facing TwiML response on failure.

Since 2026-07-21 also has its first-ever proactive outbound-send capability, a real distinction from previously only ever replying synchronously as TwiML inside an inbound webhook call: new `POST /api/send` (guarded by `X-API-Key` against `GUEST_COMMUNICATION_AGENT_API_KEY`, reintroduced under the same env var name this app used before the CRM extraction removed the route it used to guard) takes phone/message in the request body, reuses the same conversation-continuity helper as the inbound path so a proactive send lands in the guest's existing conversation, and calls new `src/lib/twilio-send.ts`'s `sendWhatsAppMessage` — Twilio's Messages REST API called directly (Account SID + Auth Token), not just replying inside an already-open inbound call. Records the outbound message in `whatsapp_messages` only on a successful send; a real Twilio failure returns `ok:false`/502 without recording it. Its only caller so far is `apps/telegram-router`'s nudge-approve flow (see ROUTER); live-verified this session as part of that flow's real end-to-end test, including a real send accepted by Twilio's live API via one of its own documented test numbers.

## Edge Verification History

Index numbers below refer to the 0-indexed flowchart edge declarations in `docs/agent-architecture.mmd` (fan-out targets like `A --> B & C` count as separate consecutive edges); see that file's own short index-to-edge comments for the current mapping. This section preserves the narrative for *why* each tested edge is green, or why a specific grey edge is grey despite appearances.

### Green (tested) edges

**AVAIL -.-> ORCH (Orch-A's Analyze step fetches real Availability data)** — informs edge; live.

**UPLOAD -.-> CRON_TAX (quarter-closing months only)** — the conditional-trigger edge.

**CRON_RFI / CRON_AIRBNB_PRICING / CRON_EOM -- seeded as reminder in --> NOTIF** — each is a real seeded DB row, verified by direct query.

**ROUTER -- "sends reminder, Done button" --> TG** — the exact mechanism proven live: demo reminder created, due-check triggered, real Telegram message with Done button sent.

**CRM -.-> ORCH (campaign stats)** — flipped green 2026-07-21, the final piece of campaign-conversion-tracking: this "informs" edge predated campaigns entirely and used to carry no campaign/funnel data at all — now Orch-A's Analyze step actually calls CRM's new `GET /api/campaigns/stats`. Live-verified in two steps: first hit CRM's new endpoint directly (401 without a key, correct all-zero shape for both kinds before any campaign activity existed), then ran Orch-A's own preview-digest script against the real running CRM server and confirmed the actual rendered digest text — both the all-zero state and, after seeding one real "sent" promo code, the correctly-aggregated non-zero count reaching the real rendered output, not just a mocked one.

**HEALTH -.-> NOTIF / UPLOAD / SOC_GEN / ORCH** — UPLOAD stands in for apps/finance as a judgment call: no single node in this diagram represents "apps/finance the process," only its UPLOAD/CRON_* pieces, and UPLOAD is the one most directly tied to that process. All four live-verified via `/heartbeat`: ran it with all 4 services up -> `ok:true` for all 4, confirmed 4 rows written to `health_check_state`; killed apps/social-media's process, ran `/heartbeat` again -> `ok:false` for social-media confirmed written with a real transition timestamp; ran it again while still down -> confirmed `last_status_change_at` held steady and `consecutive_failures` incremented from 1 to 2, proving "stay silent while still down" rather than alert-on-every-failure; restarted social-media, ran `/heartbeat` again -> confirmed `is_healthy` flipped back true, `consecutive_failures` reset to 0, `last_status_change_at` updated to the new transition.

**HEALTH -- alerts --> TG** — the alert-on-transition send fired for real during the kill/restart test above, via the same `sendMessage`/`sendWithRetry` path already proven elsewhere.

**ROUTER -- sends digest --> TG** — daily digest; live-tested: `POST /api/cron/check-digest` called Orch-A's `GET /digest` and delivered a real digest message to the real Telegram chat, with `parse_mode: "HTML"` preserved since Orch-A's digest is pre-rendered with `<b>`/`<i>` tags.

**TG -- "/heartbeat" --> ROUTER** — the on-demand command trigger itself, exercised for real in the same `/heartbeat` test as HEALTH's checks above — contrast with `TG -- "/digest" --> ROUTER`, which has NOT been exercised as a real typed command; only `/digest`'s downstream send and its cron trigger have been proven.

**ROUTER -- sends health summary --> TG** — the direct status reply `/heartbeat` always sends regardless of any transition, exercised in the same live test as the `/heartbeat` trigger above.

**TG -- "Done button press" --> ROUTER** — button was pressed for real in the end-to-end test.

**ROUTER -- calls /api/reminders/* --> NOTIF** — exercised live via the due-check + ack calls in the same test.

**ROUTER -- calls /digest --> ORCH** — live-verified: `GET /digest` hit directly — confirmed 401 on a bad key, 404 on the old `/api/digest` path, and a correct real response with live Availability data on a valid call — and exercised end-to-end via `POST /api/cron/check-digest`.

**GCA -- calls /api/guest-contacts/lookup --> CRM** — brand new edge, added 2026-07-21 as part of the CRM extraction: GCA's `loadGuestInfo()` no longer queries `guest_contacts` directly — it now calls this new CRM endpoint via a new `src/lib/crm.ts` client. Live-verified: GCA's actual `CRM_API_URL`/`CRM_API_KEY` env wiring was exercised directly against the live lookup endpoint and got back a real response; the endpoint's own auth, validation, and phone normalization (Twilio's `whatsapp:` prefix) were also verified.

**CRM -- calls /api/campaign-drafts --> ROUTER** — brand new edge, added 2026-07-21: CRM's check-stalled-guests cron's `draftForCandidates` best-effort pushes each newly-issued promo code here via `src/lib/telegram-router-client.ts`'s `postCampaignDraft`. Live-verified: a seeded stalled guest produced a real draft that was actually posted and landed as a real Telegram message with Approve/Reject buttons.

**ROUTER -- calls /api/promo-codes/* (check + mark-sent/rejected) --> CRM** — brand new edge, added 2026-07-21: the webhook's `nudge_approve` branch calls CRM's `GET /api/promo-codes/:id` then, after a successful send, `POST .../mark-sent`; `nudge_reject` calls `POST .../mark-rejected` directly. Live-verified via direct authenticated webhook calls simulating both button presses — confirmed reject sets `status='rejected'` with a graceful double-tap no-op, and confirmed the approve path's status check + eventual mark-sent both fired for real.

**ROUTER -- calls /api/send --> GCA** — brand new edge, added 2026-07-21: the webhook's `nudge_approve` branch calls GCA's new proactive-send endpoint once it has confirmed (via the promo-codes check above) that the promo code is still `'issued'`. Live-verified as part of the same simulated-approve test — GCA's `/api/send` was called for real and in turn called Twilio's live API (accepted, via one of Twilio's own documented magic/test numbers, so nothing reached a real device). Design-intent note: the schema's fourth `campaigns.kind`, `'manual'` (owner-initiated, one-off, zero code today), has no distinct originating system the way `social_code_word` will — once built it would not need a new edge at all, it would just enter this same already-live approve-then-send path and go out through this exact edge, same as an approved automated nudge does today.

### Grey (untested / design-intent) edges worth noting

**TG <-> ROUTER ("/social <idea>" and its reply)** — router split just landed; no genuine end-to-end Telegram round trip through the `/social` code path has been tested yet, even though the underlying bot mechanism is unchanged.

**ROUTER -- calls /api/generate --> SOC_GEN** — brand new edge, never exercised via a real Telegram-triggered request.

**TG <-> ROUTER ("/cron list" and its reply)** — new command this round, never exercised.

**TG -- "/digest" --> ROUTER** — the on-demand command trigger itself hasn't been exercised as a real typed command (see the `/heartbeat` note above for contrast).

**SITE -- "WhatsApp link" --> GCA** — stays grey even though GCA itself is now live (green node): confirmed against `issebya-homes-website`'s `apps/website/src/app/ui/WhatsAppLink.tsx` — still a plain `wa.me/351920742845` deep link (the real production number), no webhook or code path connects it to GCA anywhere. GCA's live testing so far has all been via Twilio's WhatsApp Sandbox (its own Twilio-assigned test number), not this production number — this specific edge needs the production number registered with Twilio and pointed at GCA's webhook before it can go green.

**UPLOAD -- calls /api/guest-contacts/sync --> CRM** — retargeted 2026-07-21 (was GCA, now CRM) and downgraded from green to grey: this session's sync-endpoint test hit CRM's `POST /api/guest-contacts/sync` directly against a locally running crm server, not through an actual CSV upload via the apps/finance /upload page — so the real trigger path (apps/finance's import route calling CRM with its `X-API-Key`-guarded fetch) hasn't itself been re-exercised since the target changed, even though the endpoint it calls has been proven to work (now just `syncGuestContactsFromFinance()` — see the CRM section above; the Notion pull-refresh-push round trip this comment used to point to for proof was removed entirely on 2026-07-23, e1aab5c). Needs a real upload-triggered call against the new CRM target before it can go green again.

**CRM -.-> GCA (design intent, NOT built)** — added 2026-07-21: today check-stalled-guests' cron drafts a fixed template itself (see "CRM -- calls /api/campaign-drafts --> ROUTER" above) and pushes that fixed draft straight to ROUTER for approval — CRM never talks to GCA in that flow at all. This edge instead captures where the flow should evolve: the cron notifying GCA so GCA — not CRM — crafts a personalized message per guest, presumably drawing on its own conversational/LLM capabilities and the guest's real history. Distinct from `ROUTER -- calls /api/send --> GCA`, which is the unrelated, already-live, post-human-approval send step; this edge is about drafting/personalizing before any draft exists, not sending after approval. Zero code behind this edge today.

**SOC_GEN -.-> CRM (design intent, NOT built)** — added 2026-07-21: `social_code_word` is one of four `campaigns.kind` values the CRM schema's check constraint allows, but has zero implementation — no cron, no draft generator, nothing. Unlike the other three kinds, a code-word campaign is meant to originate from a social media post or comment (e.g. a caption inviting guests to message a code word) rather than from any GCA guest conversation or funnel-stall cron, so this edge represents that origin conceptually from the Social Media System (its only node, SOC_GEN) toward CRM. Schema-only today, nothing wired.
