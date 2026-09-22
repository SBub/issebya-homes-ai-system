import { createAdminClient } from "./supabase";

// Read/write access to pending_owner_decisions (see its own migration,
// 20260821090000_create_pending_owner_decisions.sql, for the full schema
// rationale). Two distinct postures live in this one file, matching the two
// distinct kinds of caller:
//
// - insertPendingOwnerDecision/resolvePendingOwnerDecisionByCorrelationId/
//   markPendingOwnerDecisionRelayed are called from the guest-turn-critical
//   dispatch path (approval-gate.ts's requestApprovalGate, missing-info.ts's
//   requestMissingInfoApproval) and the owner-nudges answer/approve routes. Same
//   best-effort posture as tracing.ts's recordMissingInfoTraceAnchor: never
//   throw, only log — a failed write here must never break the real nudge-
//   send/KB-embed/event-wake-up flow it's attached to, only degrade what an
//   admin recovery UI can later see.
// - Everything else (lookups/updates keyed by the row's own `id`, used by
//   the admin API routes) throws on error, same as every other real DB
//   accessor in this app (missing-info.ts's documents insert, db.ts) — for
//   those routes, the DB call IS the point of the request, not incidental
//   bookkeeping, so a failure should surface as a real error response.

export type PendingOwnerDecisionToolName = "missing_info" | "send_booking_link";
export type PendingOwnerDecisionResolution =
  "answered" | "approved" | "rejected" | "timeout" | "manually_resolved";

export interface PendingOwnerDecisionRow {
  id: string;
  correlationId: string;
  toolName: PendingOwnerDecisionToolName;
  conversationId: string | null;
  phone: string;
  reason: string | null;
  context: Record<string, unknown> | null;
  sentAt: string;
  relayedAt: string | null;
  resolvedAt: string | null;
  resolution: PendingOwnerDecisionResolution | null;
}

function toRow(data: Record<string, unknown>): PendingOwnerDecisionRow {
  return {
    id: data.id as string,
    correlationId: data.correlation_id as string,
    toolName: data.tool_name as PendingOwnerDecisionToolName,
    conversationId: (data.conversation_id as string | null) ?? null,
    phone: data.phone as string,
    reason: (data.reason as string | null) ?? null,
    context: (data.context as Record<string, unknown> | null) ?? null,
    sentAt: data.sent_at as string,
    relayedAt: (data.relayed_at as string | null) ?? null,
    resolvedAt: (data.resolved_at as string | null) ?? null,
    resolution: (data.resolution as PendingOwnerDecisionResolution | null) ?? null,
  };
}

// --- Best-effort writes (never throw) --------------------------------------

// Inserted right after a gated tool's/missing_info's nudge is confirmed
// sent — see approval-gate.ts's requestApprovalGate and missing-info.ts's
// requestMissingInfoApproval for the two call sites. `context` is only ever supplied by
// the send_booking_link gate (the tool call's real args, so the manual
// resolve action can rebuild the booking URL later); missing_info has
// nothing structured to capture yet at insert time.
export async function insertPendingOwnerDecision(params: {
  correlationId: string;
  toolName: PendingOwnerDecisionToolName;
  conversationId: string;
  phone: string;
  reason: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("pending_owner_decisions").insert({
      correlation_id: params.correlationId,
      tool_name: params.toolName,
      conversation_id: params.conversationId,
      phone: params.phone,
      reason: params.reason,
      ...(params.context ? { context: params.context } : {}),
    });
    if (error) {
      console.error(
        `[pending-owner-decisions] insert failed for correlationId "${params.correlationId}": ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[pending-owner-decisions] insert threw for correlationId "${params.correlationId}":`,
      err,
    );
  }
}

// Marks the real decision/answer outcome once a live run reaches it on its
// own (approved/rejected/answered) or gives up waiting (timeout) — called
// from the same two call sites as insertPendingOwnerDecision above, keyed by
// correlationId since that's what's in scope at every one of those sites.
export async function resolvePendingOwnerDecisionByCorrelationId(
  correlationId: string,
  resolution: PendingOwnerDecisionResolution,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("pending_owner_decisions")
      .update({ resolved_at: new Date().toISOString(), resolution })
      .eq("correlation_id", correlationId);
    if (error) {
      console.error(
        `[pending-owner-decisions] resolve failed for correlationId "${correlationId}": ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[pending-owner-decisions] resolve threw for correlationId "${correlationId}":`,
      err,
    );
  }
}

// Called by the owner-nudges answer/approve routes once the owner's real
// decision/answer has actually been relayed into the (possibly-dead)
// suspended run via its wake event — see the migration's own comment for why
// this is distinct from resolved_at. `context` carries the owner's actual
// answer text for missing_info (merged in, not replacing any existing
// context) — send_booking_link's approve route has nothing new to capture
// here, since its context was already written at insert time.
export async function markPendingOwnerDecisionRelayed(
  correlationId: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("pending_owner_decisions")
      .update({ relayed_at: new Date().toISOString(), ...(context ? { context } : {}) })
      .eq("correlation_id", correlationId);
    if (error) {
      console.error(
        `[pending-owner-decisions] mark-relayed failed for correlationId "${correlationId}": ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[pending-owner-decisions] mark-relayed threw for correlationId "${correlationId}":`,
      err,
    );
  }
}

// --- Admin-route reads/writes (throw on error) ------------------------------

export async function getPendingOwnerDecisionById(
  id: string,
): Promise<PendingOwnerDecisionRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pending_owner_decisions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up pending_owner_decisions row ${id}: ${error.message}`);
  }
  return data ? toRow(data) : null;
}

// The manual-resolve action's own write — distinct function from
// resolvePendingOwnerDecisionByCorrelationId above (keyed by the row's own
// id, not correlationId; throws instead of swallowing, since this IS the
// point of the request that called it) even though both ultimately set the
// same two columns.
export async function markPendingOwnerDecisionResolvedById(
  id: string,
  resolution: PendingOwnerDecisionResolution,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("pending_owner_decisions")
    .update({ resolved_at: new Date().toISOString(), resolution })
    .eq("id", id);
  if (error) {
    throw new Error(`Failed to resolve pending_owner_decisions row ${id}: ${error.message}`);
  }
}
