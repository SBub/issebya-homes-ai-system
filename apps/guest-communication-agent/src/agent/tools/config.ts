// Per-turn identifiers (conversationId, phone, triggerMessageId) that the
// booking/escalation tools need. AI SDK tools are built fresh per
// runAgentTurn() call via a factory function that closes over this context
// (see run-turn.ts's buildAgentTools), rather than LangChain's
// RunnableConfig.configurable threading mechanism this used to validate at
// tool-invoke time — tools used to be module-level singletons with context
// injected per-call; now each turn gets its own tool instances with context
// already bound in, so there is nothing left to validate at call time.
export interface ToolContext {
  conversationId: string;
  phone: string;
  // Optional: only the real webhook call path supplies it; other callers
  // (e.g. resumeConversationWithAnswer) leave it undefined rather than
  // fabricating one.
  triggerMessageId?: string;
}
