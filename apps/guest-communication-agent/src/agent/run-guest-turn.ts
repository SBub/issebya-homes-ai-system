import crypto from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { runAgentTurn } from "@/agent/run-turn";
import { recordMessage } from "@/lib/conversations";
import { touchGuestContact } from "@/lib/crm";
import { deriveStageHint } from "@/lib/funnel-stage";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

// The durable wrapper around runAgentTurn (@/agent/run-turn.ts). That file's
// contract (RunAgentTurnInput -> RunAgentTurnResult) stays focused purely on
// the reasoning loop, already well-tested on its own — guest-delivery side
// effects (recording the assistant's reply, the proactive Twilio send, the
// CRM touch) deliberately do NOT live inside it. This file is what
// POST /api/webhook/whatsapp's route used to do synchronously, right after
// awaiting runAgentTurn, before this change: now it happens here instead,
// inside a DBOS workflow, because by the time this logic runs (whether
// 200ms or, after a real missing_info suspend, hours later) the original
// inbound Twilio HTTP request that triggered the turn has already returned
// its empty TwiML ack — there is no live request left to reply to. Every
// guest-facing reply (not just missing_info ones) is delivered this way now;
// see the webhook route's own header comment for that tradeoff.
//
// Registered as a DBOS workflow (functional style, matching
// harness-engineering/harness/runtime.ts's runAgentWorkflow, not a
// class/decorator style) specifically so runAgentTurn's own call to
// runMissingInfo -> waitForMissingInfoReply (@/agent/tools/missing-info.ts)
// can genuinely suspend via DBOS.recv() mid-turn — DBOS.recv/DBOS.workflowID
// only work inside a running DBOS workflow's own call stack. The webhook
// route starts this workflow without awaiting it
// (DBOS.startWorkflow(runGuestTurnWorkflow)(input) — mirrors
// harness-engineering/server/index.ts's
// `await DBOS.startWorkflow(workflow)(message.input)`), so a suspended
// missing_info wait does not hold the HTTP request open.
export interface RunGuestTurnInput {
  conversationId: string;
  phone: string;
  incomingMessage: string;
  // The guest's inbound whatsapp_messages row id — threaded through to
  // runAgentTurn's own RunAgentTurnConfig, same as the webhook route always
  // did before this change (see @/agent/tools/escalation-shared.ts's
  // performEscalation for where it ends up: escalations.trigger_message_id).
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

  // Stored as whatsapp_messages.langsmith_run_id for eval-feedback
  // correlation, but is NOT a real LangSmith trace id — same known
  // regression the webhook route's own runId generation carried before this
  // change (nothing on LangSmith's side matches it, so a later feedback
  // submission against it will fail).
  const runId = crypto.randomUUID();
  await recordMessage(conversationId, "assistant", replyText, runId);

  // Fire-and-forget, same resilience shape as the webhook route always used
  // here: CRM owns the forward-only funnel_stage upgrade logic, this just
  // derives the hint and reports a failure without blocking delivery.
  const stageHint = deriveStageHint(result.messages);
  const touchResult = await touchGuestContact(phone, stageHint);
  if (!touchResult.ok) {
    console.warn(`[run-guest-turn] touchGuestContact failed for ${phone}: ${touchResult.error}`);
  }

  // The actual guest-facing delivery. Unlike the old TwiML-response path,
  // this is a genuinely proactive outbound call — there is no live inbound
  // Twilio request to reply to by the time this workflow reaches this line.
  const sendResult = await sendWhatsAppMessage(phone, replyText);
  if (!sendResult.ok) {
    console.error(`[run-guest-turn] sendWhatsAppMessage failed for ${phone}: ${sendResult.error}`);
  }
}

export const runGuestTurnWorkflow = DBOS.registerWorkflow(runGuestTurn, {
  name: "runGuestTurn",
});
