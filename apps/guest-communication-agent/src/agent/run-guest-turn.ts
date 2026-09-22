import type { Span } from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";
import type { GetStepTools } from "inngest";
import { foldMemory } from "@/agent/memory";
import { FALLBACK_REPLY_TEXT, runAgentTurn } from "@/agent/run-agent-turn";
import { recordMessage, updateMessageDeliveryStatus } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { markSpanFailed, steppedSpan, type TraceAnchor } from "@/lib/tracing";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

// Delivery orchestrator for one guest turn (runGuestTurn) plus its Inngest
// registration (runGuestTurnFunction below). Separate from
// run-agent-turn.ts's reasoning loop — see that file's own comment — so this
// file is purely "what happens once a reply exists": record it, send it,
// fold memory.

// The event that triggers a guest turn — sent (fire-and-forget) by the
// webhook route, consumed by runGuestTurnFunction below.
export const GUEST_TURN_REQUESTED_EVENT = "gca/guest-turn.requested";

interface GuestTurnRequestedEventData {
  conversationId: string;
  phone: string;
  incomingMessage: string;
  // Only set for real webhook calls.
  triggerMessageId?: string;
  // Set once in the webhook route, before request validation — lets
  // step.waitForEvent (missing-info.ts) find this suspended run when the
  // owner's reply arrives as a separate event. Not used for tracing.
  correlationId: string;
  // The webhook route's real trace root (startTraceRoot, tracing.ts),
  // captured before request validation, so the whole interaction lands as
  // one properly nested trace instead of spans sharing a synthetic parent.
  traceAnchor: TraceAnchor;
}

export interface RunGuestTurnParams extends GuestTurnRequestedEventData {
  step: GetStepTools<typeof inngest>;
}

// Delivery orchestrator: drives runAgentTurn, then records and sends the
// reply. By the time this reaches those side effects — 200ms or, after a
// missing_info suspend, hours later — the inbound webhook request has
// already returned its ack, so every reply is delivered proactively.
//
// Kept as a plain function — not the inngest.createFunction() call itself
// (see runGuestTurnFunction below) — so tests can drive it with a
// hand-rolled `step` mock instead of a real Inngest engine.
export async function runGuestTurn(params: RunGuestTurnParams): Promise<void> {
  const {
    conversationId,
    phone,
    incomingMessage,
    triggerMessageId,
    correlationId,
    traceAnchor,
    step,
  } = params;

  const result = await runAgentTurn(
    { conversationId, phone, incomingMessage },
    { triggerMessageId, correlationId, traceAnchor, step },
  );

  // Deliberately back at traceAnchor, not runAgentTurn's turnAnchor — this
  // and the following two spans are post-reasoning delivery/bookkeeping, so
  // they sit as siblings of "braintrust.guest_turn" rather than its children.
  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage?.role === "assistant" && typeof lastMessage.content === "string"
      ? lastMessage.content
      : FALLBACK_REPLY_TEXT;

  // A real, single-write span rather than an updateSpanIO patch on
  // "braintrust.guest_turn" — input/output are already known here, so a
  // patch's write-ordering race (see updateSpanIO's doc comment, tracing.ts)
  // doesn't apply. The online-scoring automation targets this span's name.
  // Deduped: a turn can call missing_info more than once across rounds, but
  // Braintrust's tags field is a set.
  const dedupedTags = [...new Set(result.firedTags)];
  await steppedSpan(
    step,
    "update-turn-trace-io",
    traceAnchor,
    "braintrust.guest_turn.result",
    {
      "braintrust.input": incomingMessage,
      "braintrust.output": replyText,
      ...(dedupedTags.length > 0 ? { "braintrust.tags": dedupedTags } : {}),
    },
    async () => {},
  );

  // traceAnchor.traceId is stored on the row so it doubles as a working
  // pointer into Braintrust/Axiom for this turn.
  const replyMessageId = await steppedSpan(
    step,
    "record-reply",
    traceAnchor,
    "record-reply",
    { "gca.conversation_id": conversationId },
    () => recordMessage(conversationId, "assistant", replyText, traceAnchor.traceId),
  );

  async function sendGuestWhatsAppReply(span: Span) {
    const sendResult = await sendWhatsAppMessage(phone, replyText);
    if (!sendResult.ok) {
      console.error(
        `[run-guest-turn] sendWhatsAppMessage failed for ${phone}: ${sendResult.error}`,
      );
      markSpanFailed(span, sendResult.error ?? "sendWhatsAppMessage failed with no error message");
    }
    return sendResult;
  }

  const sendResult = await steppedSpan(
    step,
    "send-whatsapp-reply",
    traceAnchor,
    "send-whatsapp-reply",
    { "gca.phone": phone },
    sendGuestWhatsAppReply,
  );

  // Distinct from record-reply above — persists whether the send actually
  // landed, so an admin recovery UI can find a reply that was generated but
  // never delivered.
  await step.run("update-message-delivery-status", () =>
    updateMessageDeliveryStatus(replyMessageId, sendResult.ok ? "sent" : "failed"),
  );

  // Folds whatever this turn dropped out of the trimmed history window into
  // guest_memory's rolling summary — moved here (out of loadMemory's inline
  // path) so its LLM round-trip doesn't sit on the guest's reply-latency
  // critical path. Passes this step's own span id (not traceAnchor) so
  // foldMemory's internal "gen_ai.chat" span nests under "fold-memory-summary".
  async function foldGuestMemory(span: Span): Promise<void> {
    try {
      await foldMemory({
        conversationId,
        phone,
        traceAnchor: { traceId: traceAnchor.traceId, spanId: span.spanContext().spanId },
      });
    } catch (err) {
      // The guest already has their reply by this point — a summarization
      // failure must never crash an otherwise-successful turn. A lost fold
      // is harmless (memory.ts's loadMemoryState watermark just sees a
      // bigger backlog next time).
      console.error(`[run-guest-turn] foldMemory failed for conversation ${conversationId}:`, err);
      markSpanFailed(span, err);
      Sentry.captureException(err);
    }
  }

  await steppedSpan(
    step,
    "fold-memory-summary",
    traceAnchor,
    "fold-memory-summary",
    { "gca.conversation_id": conversationId },
    foldGuestMemory,
  );
}

// Thin adapter registered with /api/inngest — pulls the typed payload off
// the triggering event and hands it to runGuestTurn above.
export const runGuestTurnFunction = inngest.createFunction(
  { id: "run-guest-turn", triggers: [{ event: GUEST_TURN_REQUESTED_EVENT }] },
  async ({ event, step }) => {
    const data = event.data as GuestTurnRequestedEventData;
    await runGuestTurn({ ...data, step });
  },
);
