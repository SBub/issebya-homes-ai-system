# GCA engineering conventions

## Tracing/durability plumbing

- Never hand-nest `step.run(id, () => withTurnSpan(...))`. Use `steppedSpan(step, id, traceAnchor, name, attrs, fn)` from `src/lib/tracing.ts` — collapses Inngest's step + this app's OTel span into one call.
- Every tool owns its own `gen_ai.tool.<name>` execution span and any `step`/`waitForEvent` usage it needs, inside its own `run<ToolName>` (`wants-human.ts`'s `runWantsHuman` is the model). `run-agent-turn.ts`'s dispatch loop calls `run-tool.ts`'s `runTool` uniformly and does no span-wrapping of its own. Two tiers, by how much step/span machinery a tool needs:
  - No side effect worth protecting across a crash: wrap the whole thing in one `steppedSpan` call (`tool-execution.ts`'s `dispatchToolExecution` — `pricing.ts`'s `runGetPricing` is the model). Business logic stays a separate pure `compute<ToolName>` function the traced `run<ToolName>` wraps.
  - A side effect that must not double-fire on retry, or a genuine suspend/wait — needs finer-grained `step.run` calls (`wants-human.ts`, `missing-info.ts`'s `requestMissingInfoApproval`, `booking.ts`'s `requestSendBookingLinkApproval`). `missing_info`/`send_booking_link` additionally split approval (`request<ToolName>Approval`, creates its own `hitl.<name>` GATE span, patches only that on reject/timeout) from execution (`run<ToolName>`, creates a fresh `gen_ai.tool.<name>` span only once approved) — two different spans, because the wait can suspend for up to a year and nesting it under a span literally named "the tool call" would misrepresent the sequence. `run-agent-turn.ts`'s `NEEDS_APPROVAL` set and inline switch drive this.
  - `property-question.ts`'s `db.matchDocuments` span and `owner-nudge.ts`'s send span are a narrower exception — a plain OTel span nested inside the tool's own span, zero step/Inngest coupling.
  - Adding a new tool: ask which tier it's in before writing its dispatch.
- Inside a `steppedSpan`/`withTurnSpan`/`withSpan` call, pass a named function for any real logic — not a trivial one-liner — declared just above the call, closing over the same locals. Keeps the wrapper call itself scannable as pure plumbing, separate from the logic.

## Comments

- Only comment genuine landmines: a non-obvious constraint that breaks something if the reader doesn't know it (Inngest's step-nesting rule, its required-bounded-timeout rule, Braintrust's attribute-to-UI mapping, Twilio's raw-body signature requirement). State each such fact once, at its canonical definition (e.g. `steppedSpan`'s doc comment, the "RULE" comment near the top of `run-agent-turn.ts`) — reference it tersely from other call sites instead of re-explaining it each time.
- Don't write narrative/changelog-shaped comments ("as of DATE, X replaced Y because Z", "previously this did A, now it does B"). That belongs in the commit message. If a narrative comment contains a real fact worth keeping, state the fact plainly and drop the history wrapped around it.
