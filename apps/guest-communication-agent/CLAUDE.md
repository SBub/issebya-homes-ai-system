# GCA engineering conventions

## Tracing/durability plumbing

- Never hand-nest `step.run(id, () => withTurnSpan(...))`. Use `steppedSpan(step, id, traceAnchor, name, attrs, fn)` from `src/lib/tracing.ts` — collapses Inngest's step + this app's OTel span into one call.
- Most tool files (`src/agent/tools/*.ts`) must stay pure: no `step`/`span`/Inngest imports. All durability/tracing plumbing belongs in `run-turn.ts`'s dispatch loop, `run-tool.ts` (the tool registry + generic dispatcher `run-turn.ts` calls into), or `approval-gate.ts`'s shared gate. `booking.ts` and `run-code.ts` are the model for what "pure" looks like. Two kinds of deliberate exception exist:
  - A plain OTel span with zero Inngest/step coupling — `property-question.ts`'s DB-call span, `owner-nudge.ts`'s send span. Not durability plumbing, just tracing.
  - A tool whose own dispatch genuinely needs real Inngest step/waitForEvent semantics (HITL-style: sending an owner nudge, suspending, resuming) — that tool's own `run<ToolName>` owns it, per this app's `run<ToolName>` convention. `wants-human.ts`'s `runWantsHuman` and `missing-info.ts`'s `runMissingInfo` are the model for this. If you're adding either kind, ask whether it's genuinely the same case before treating it as precedent.
- Inside a `steppedSpan`/`withTurnSpan`/`withSpan` call, pass a named function for any real logic — not a trivial one-liner — declared just above the call, closing over the same locals. Keeps the wrapper call itself scannable as pure plumbing, separate from the logic.

## Comments

- Only comment genuine landmines: a non-obvious constraint that breaks something if the reader doesn't know it (Inngest's step-nesting rule, its required-bounded-timeout rule, Braintrust's attribute-to-UI mapping, Twilio's raw-body signature requirement). State each such fact once, at its canonical definition (e.g. `steppedSpan`'s doc comment, `SELF_STEPPED_TOOLS`'s comment) — reference it tersely from other call sites instead of re-explaining it each time.
- Don't write narrative/changelog-shaped comments ("as of DATE, X replaced Y because Z", "previously this did A, now it does B"). That belongs in the commit message. If a narrative comment contains a real fact worth keeping, state the fact plainly and drop the history wrapped around it.
