// Per-turn identifiers passed to the tools that need them (runSendBookingLink,
// runWantsHuman, runComplaint, runMissingInfo), via run-turn.ts's
// runToolCall().
export interface ToolContext {
  conversationId: string;
  phone: string;
  // Only the real webhook call path supplies this; other callers (e.g.
  // resumeConversationWithAnswer) leave it undefined.
  triggerMessageId?: string;
}
