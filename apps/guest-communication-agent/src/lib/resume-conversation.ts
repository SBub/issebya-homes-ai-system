import crypto from "node:crypto";
import { runAgentTurn } from "@/agent/run-turn";
import { recordMessage } from "@/lib/conversations";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

export interface ResumeConversationResult {
  ok: boolean;
  error?: string;
}

/**
 * Proactively re-runs GCA's agent turn to close the loop on a missing_info
 * escalation once the owner has answered on Telegram. Rather than relaying
 * the owner's raw words directly, the answer is embedded into the property
 * knowledge base first (by this function's only caller,
 * ../app/api/escalations/[id]/resolve/route.ts), and the guest's own
 * original question is replayed through the normal agent pipeline so
 * answerPropertyQuestion finds it and the agent composes its own reply.
 *
 * Differs from the webhook route: sends the reply proactively via
 * sendWhatsAppMessage instead of returning TwiML, and has no guest-facing
 * fallback string — a background failure here is reported as
 * `{ ok: false, error }` (so the resolve route can tell the owner to follow
 * up directly) rather than sending a second, vague, unprompted message.
 *
 * Note: `triggerMessageContent` (the guest's original question) already
 * appears once in the history loadContext loads, and is passed again as
 * `incomingMessage` here — so it appears twice in what the model sees. This
 * is deliberate: with the agent's own "let me check with the owner" reply
 * sitting between the two, it reads as a natural follow-up, not a
 * duplicate.
 *
 * Never throws — every failure mode is returned as `{ ok: false, error }`
 * so the caller (the resolve route) doesn't lose the fact that the KB
 * write + resolution bookkeeping already succeeded.
 */
export async function resumeConversationWithAnswer(params: {
  conversationId: string;
  phone: string;
  triggerMessageContent: string;
}): Promise<ResumeConversationResult> {
  const { conversationId, phone, triggerMessageContent } = params;

  const runId = crypto.randomUUID();

  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({ conversationId, phone, incomingMessage: triggerMessageContent });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Rare: the re-invoked turn escalates again as missing_info (the model
  // still can't answer even with the freshly-embedded content). Treated as
  // a failure rather than sending a still-unhelpful reply.
  if (result.missingInfoEscalated) {
    return {
      ok: false,
      error: "Graph escalated again during re-invocation instead of producing a real answer",
    };
  }

  const lastMessage = result.messages.at(-1);
  if (lastMessage?.role !== "assistant" || typeof lastMessage.content !== "string") {
    return {
      ok: false,
      error: "Graph did not produce a final assistant message with string content",
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
