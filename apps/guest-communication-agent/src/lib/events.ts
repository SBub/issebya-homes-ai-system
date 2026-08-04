import crypto from "node:crypto";

// STUB observability layer. GCA runs on DBOS (@dbos-inc/dbos-sdk) durable
// workflows but has no real event sink yet — no dashboard, no event table.
// Every call site wraps emit() in DBOS.runStep() so the emit itself is
// checkpointed exactly-once alongside the workflow step it documents, the
// same pattern the harness-engineering course example uses (see
// shared/events.ts + harness/runtime.ts there). For now emit() only logs a
// structured line; nothing durable happens.
//
// TODO: replace the console.debug body with a real sink (a Postgres event
// log table, or an event bus) once one exists. Until then this is honestly
// just structured logging, not an observability pipeline.

export enum EventType {
  WorkflowStarted = "workflow.started",
  WorkflowCompleted = "workflow.completed",
  WorkflowFailed = "workflow.failed",
  ModelCompleted = "model.completed",
  ToolRequested = "tool.requested",
  ToolCompleted = "tool.completed",
  ToolFailed = "tool.failed",
  ApprovalRequested = "approval.requested",
  ApprovalResolved = "approval.resolved",
  OwnerNudgeRequested = "owner_nudge.requested",
  OwnerNudgeAnswered = "owner_nudge.answered",
  OwnerNudgeTimedOut = "owner_nudge.timed_out",
}

export type EventInput =
  | {
      type: EventType.WorkflowStarted;
      workflowId: string;
      conversationId: string;
      phone: string;
      incomingMessage: string;
    }
  | { type: EventType.WorkflowCompleted; workflowId: string; output: string }
  | { type: EventType.WorkflowFailed; workflowId: string; error: string }
  | {
      type: EventType.ModelCompleted;
      workflowId: string;
      stepCount: number;
      text: string;
      toolCallCount: number;
    }
  | {
      type: EventType.ToolRequested;
      workflowId: string;
      toolCallId: string;
      name: string;
      args: unknown;
    }
  | { type: EventType.ToolCompleted; workflowId: string; toolCallId: string; result: unknown }
  | { type: EventType.ToolFailed; workflowId: string; toolCallId: string; error: string }
  | {
      type: EventType.ApprovalRequested;
      workflowId: string;
      toolCallId: string;
      action: string;
      args: unknown;
    }
  | { type: EventType.ApprovalResolved; workflowId: string; toolCallId: string; approved: boolean }
  | {
      type: EventType.OwnerNudgeRequested;
      workflowId: string;
      reason: string;
      reasonCategory: "wants_human" | "missing_info";
    }
  | { type: EventType.OwnerNudgeAnswered; workflowId: string; answer: string }
  | { type: EventType.OwnerNudgeTimedOut; workflowId: string };

// What every emitted event looks like once stamped.
type AppEvent = EventInput & { id: string; ts: number };

// What call sites call. STUB — see the module comment above. Always wrap
// this in DBOS.runStep() at the call site so it's checkpointed exactly-once
// alongside the workflow step it documents.
export async function emit(event: EventInput): Promise<void> {
  const stamped: AppEvent = { ...event, id: crypto.randomUUID(), ts: Date.now() };
  // TODO: replace with a real sink (Postgres event log table, or an event
  // bus) — this is a stub, not a real observability pipeline.
  console.debug(JSON.stringify(stamped));
}
