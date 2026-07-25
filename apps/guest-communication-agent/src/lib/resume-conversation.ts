import crypto from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { graph } from "@/graph/graph";
import { recordMessage } from "@/lib/conversations";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

export interface ResumeConversationResult {
  ok: boolean;
  error?: string;
}

/**
 * Proactively re-invokes GCA's own LangGraph graph outside its normal
 * webhook trigger — the first time this graph is ever invoked from anywhere
 * other than POST /api/webhook/whatsapp's inbound Twilio call.
 *
 * Closes the loop on a missing_info escalation once the owner has answered
 * on Telegram: rather than relaying the owner's raw typed words straight to
 * the guest (a second, drifting voice with no system prompt/tools behind
 * it), the answer is embedded into the property knowledge base first (see
 * ../app/api/escalations/[id]/resolve/route.ts, this function's only
 * caller), and then the guest's own original question — not the model's
 * paraphrased escalations.reason — is replayed through the exact same
 * agent/system-prompt/tool pipeline a normal turn uses.
 * answerPropertyQuestion now finds the freshly-embedded content, so the real
 * agent composes and sends its own reply, in its own voice, exactly like any
 * other turn.
 *
 * Mirrors that webhook route's own graph.invoke() shape closely (fresh
 * runId via crypto.randomUUID(), same configurable fields, same
 * `result.messages.at(-1)` extraction), with two deliberate differences:
 *
 * - No TwiML reply to return — the reply is sent proactively via
 *   sendWhatsAppMessage (the same Twilio REST helper POST /api/send uses),
 *   not returned synchronously to an inbound webhook caller.
 * - No guest-facing fallback string on a bad/missing graph output. The
 *   webhook route's own fallback ("Sorry, I couldn't process that...") exists
 *   because that route MUST return some TwiML to the guest's inbound
 *   message no matter what. This is a background/proactive path with no
 *   inbound message to reply to — inventing and sending a vague fallback
 *   string here would just be a second unprompted, unhelpful message to the
 *   guest. Treating it as a failure (`{ ok: false, error }`) instead lets
 *   the resolve route report `sentToGuest: false` accurately, so the owner
 *   can be told to follow up directly.
 *
 * Note on repeated content: `triggerMessageContent` is the guest's exact
 * original message, already present once in the conversation history
 * load_context (@/graph/nodes/load-context.ts) loads. Passing it again as
 * this turn's `incomingMessage` means the guest's question effectively
 * appears twice in the messages the model sees. This is a deliberate,
 * discussed tradeoff, not a bug to engineer around here — see
 * load-context.ts's own doc comment on message ordering, and this feature's
 * design notes on why a repeated question reads as a natural follow-up
 * prompt (the model's own prior "let me check with the owner" reply sits in
 * between) rather than a duplicate non-sequitur.
 *
 * Never throws — every failure mode (empty/non-string graph output, a
 * non-AIMessage last message, a Twilio send failure) is returned as
 * `{ ok: false, error }` instead, since this runs inside an HTTP route
 * handler (the resolve route) that must report success/failure to its own
 * caller (telegram-router) rather than crash and lose the fact that the KB
 * write + resolution bookkeeping already succeeded.
 */
export async function resumeConversationWithAnswer(params: {
  conversationId: string;
  phone: string;
  triggerMessageContent: string;
}): Promise<ResumeConversationResult> {
  const { conversationId, phone, triggerMessageContent } = params;

  const runId = crypto.randomUUID();

  let result: Awaited<ReturnType<typeof graph.invoke>>;
  try {
    result = await graph.invoke(
      { conversationId, phone, incomingMessage: triggerMessageContent },
      { configurable: { conversationId, phone, thread_id: conversationId }, runId },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const lastMessage = result.messages.at(-1);
  if (!(lastMessage instanceof AIMessage) || typeof lastMessage.content !== "string") {
    return {
      ok: false,
      error: "Graph did not produce a final AIMessage with string content",
    };
  }
  const replyText = lastMessage.content;

  const sendResult = await sendWhatsAppMessage(phone, replyText);
  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }

  await recordMessage(conversationId, "assistant", replyText, runId);

  return { ok: true };
}
