import crypto from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { runAgentTurn } from "@/agent/run-turn";
import { recordMessage } from "@/lib/conversations";
import { touchGuestContact } from "@/lib/crm";
import { deriveStageHint } from "@/lib/funnel-stage";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

// Durable wrapper around runAgentTurn: keeps the reasoning loop itself free
// of guest-delivery side effects (recording the reply, the proactive Twilio
// send, the CRM touch). By the time this workflow reaches those side
// effects — whether 200ms or, after a real missing_info suspend, hours
// later — the original inbound Twilio HTTP request has already returned its
// empty TwiML ack, so every guest-facing reply is delivered proactively now.
//
// Registered as a DBOS workflow (functional style) so runMissingInfo's
// DBOS.recv()/DBOS.workflowID calls work — those only work inside a running
// workflow's own call stack. The webhook route starts this without
// awaiting it, so a suspended missing_info wait doesn't hold the HTTP request open.
export interface RunGuestTurnInput {
  conversationId: string;
  phone: string;
  incomingMessage: string;
  // The guest's inbound whatsapp_messages row id; ends up as
  // escalations.trigger_message_id via performEscalation.
  triggerMessageId?: string;
}

async function runGuestTurn(input: RunGuestTurnInput): Promise<void> {
  const { conversationId, phone, incomingMessage, triggerMessageId } = input;

  const result = await runAgentTurn(
    { conversationId, phone, incomingMessage },
    { triggerMessageId },
  );

  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage?.role === "assistant" && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Sorry, I couldn't process that — please try again shortly.";

  // NOT a real LangSmith trace id — nothing on LangSmith's side matches it,
  // so a later feedback submission against it will fail.
  const runId = crypto.randomUUID();
  await recordMessage(conversationId, "assistant", replyText, runId);

  // Fire-and-forget: CRM owns the forward-only funnel_stage upgrade logic,
  // this just derives the hint and reports a failure without blocking delivery.
  const stageHint = deriveStageHint(result.messages);
  const touchResult = await touchGuestContact(phone, stageHint);
  if (!touchResult.ok) {
    console.warn(`[run-guest-turn] touchGuestContact failed for ${phone}: ${touchResult.error}`);
  }

  const sendResult = await sendWhatsAppMessage(phone, replyText);
  if (!sendResult.ok) {
    console.error(`[run-guest-turn] sendWhatsAppMessage failed for ${phone}: ${sendResult.error}`);
  }
}

export const runGuestTurnWorkflow = DBOS.registerWorkflow(runGuestTurn, {
  name: "runGuestTurn",
});
