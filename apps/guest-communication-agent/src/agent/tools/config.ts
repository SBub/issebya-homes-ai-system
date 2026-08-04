// Per-turn identifiers passed to the tools that need them (runSendBookingLink,
// runWantsHuman, runMissingInfo), via run-turn.ts's
// runToolCall().
export interface ToolContext {
  conversationId: string;
  phone: string;
  // Only the real webhook call path (via @/agent/run-guest-turn.ts's
  // runGuestTurn) supplies this; other callers leave it undefined.
  triggerMessageId?: string;
}
