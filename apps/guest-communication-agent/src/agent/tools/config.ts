// Per-turn identifiers (conversationId, phone, triggerMessageId) that the
// booking/escalation tools need. Every tool in this directory is a
// module-level, schema-only `tool()` declaration (no `execute`) — dispatch
// is manual, done by run-turn.ts's own runToolCall(), which passes a fresh
// ToolContext built from this turn's conversationId/phone/triggerMessageId
// straight through to the two run<ToolName> implementation functions that
// need it (runSendBookingLink, runEscalateToOwner), rather than closing it
// over a per-turn tool factory (the old approach) or threading it through
// LangChain's RunnableConfig.configurable (the one before that).
export interface ToolContext {
  conversationId: string;
  phone: string;
  // Optional: only the real webhook call path supplies it; other callers
  // (e.g. resumeConversationWithAnswer) leave it undefined rather than
  // fabricating one.
  triggerMessageId?: string;
}
