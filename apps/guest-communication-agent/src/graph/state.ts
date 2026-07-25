import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/graph/state.ts. Extends the prebuilt
// MessagesAnnotation (which owns `messages` with the standard append
// reducer) with the per-turn identifiers the original runAgent()/tools
// needed. The graph is invoked fresh per turn with the full message history
// as input — Postgres (whatsapp_messages/whatsapp_conversations, via
// createAdminClient() in ../lib/db.ts) remains the system of record, not
// this graph's state.
export const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  conversationId: Annotation<string>,
  phone: Annotation<string>,
  // Raw text of the current turn's inbound guest message — NOT yet part of
  // `messages`. The caller invokes the graph with this set and `messages`
  // left empty; load_context is responsible for turning it into the final
  // ordered `messages` array (prior history + this message), because
  // MessagesAnnotation's reducer (add_messages) only ever *appends* whatever
  // a node returns to whatever's already in state.messages. If the caller
  // instead put the new message directly into `messages` at invoke time and
  // load_context returned older history as `{messages: [...history]}`, the
  // reducer would concatenate them as [newMessage, ...history] — backwards.
  // Routing the new message through this separate field and letting
  // load_context own the single ordered append (history first, new message
  // last) into an initially-empty `messages` sidesteps that entirely. See
  // nodes/load-context.ts for where this is consumed.
  incomingMessage: Annotation<string>,
  // Past-stay facts for this guest (from guest_contacts — last_room,
  // last_stay_checkin, total_stays), populated by the load_context node —
  // NOT the system prompt itself. Kept out of `messages` deliberately: same
  // append-only reducer problem described above for incomingMessage — a
  // SystemMessage returned from load_context would land *after* the turn's
  // history instead of before it. The agent node is responsible for
  // combining this with the persona/instructions into the final
  // SystemMessage it prepends to state.messages when invoking the LLM.
  // This field used to hold CRM campaign context (loadCrmContext); that
  // lookup was dropped once campaign sends started being logged into
  // whatsapp_messages like any other turn (so that context now shows up in
  // `messages` naturally instead of needing a synthetic block here). The
  // field name stayed the same since its role — "guest-specific facts the
  // agent node folds into the system prompt" — hasn't changed, just what
  // populates it.
  guestContext: Annotation<string | null>,
  // Counts reasoning rounds (agent-node executions), not tool calls — one
  // round can dispatch multiple parallel tool calls (see tool-nodes.ts's
  // fan-out). Defaults to 0 so callers that don't set it (e.g. Studio's
  // "New Thread") still work; the agent node increments it every time it
  // runs and enforces MAX_AGENT_STEPS, giving this LangGraph port the same
  // deterministic ceiling apps/website's AI-SDK agent gets for free from
  // `stopWhen: stepCountIs(5)` — LangGraph has no such helper, and its own
  // default safety net (`recursionLimit: 25`) counts every node visit
  // (including tool nodes) and throws an unhandled GraphRecursionError
  // instead of ending the turn gracefully.
  stepCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  // Set true for exactly one turn when this turn's escalation (whether the
  // model's own escalateToOwner tool call or one of agent.ts's two
  // deterministic safety nets) was categorized missing_info. Same "last
  // write wins" reducer shape as stepCount above — a plain boolean, not part
  // of `messages`, so it doesn't interact with MessagesAnnotation's
  // append-only reducer at all. Consumed by the webhook route
  // (../app/api/webhook/whatsapp/route.ts) to suppress that turn's
  // guest-facing reply: a missing_info escalation means the guest should
  // hear nothing until the owner answers and
  // ../lib/resume-conversation.ts's proactive re-invocation sends the real
  // answer, not this turn's interim "let me check with the owner" text.
  missingInfoEscalated: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
});

export type GraphStateType = typeof GraphState.State;
