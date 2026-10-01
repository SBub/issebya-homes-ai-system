import { isValidTraceId } from "@/lib/harness/span-exporter";
import { createTable, type Table, UniqueViolationError } from "@/lib/harness/store";

/**
 * The write behind the `idempotent-write-by-trace-key` demo, on the harness
 * table. A reply row carries the trace id of the turn that produced it, the
 * table holds a unique key on that column, and a retried write that hits the
 * key selects the existing row instead of failing or duplicating. The
 * all-zero trace id is rejected as a key: it means "no trace", every
 * untraced turn shares it, and storing it would make two different replies
 * collide.
 *
 * The wrong variants exist so the demo can show the failure:
 * - `conflict: "throw"`: the insert has no conflict handling, so a retry fails.
 * - `guard: "accept-zero"`: the sentinel is stored as a key, so a different
 *   conversation's reply comes back as the first one's row.
 */

export type MessageRow = {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  traceId: string | null;
};

export type MessagesTable = Table<MessageRow>;

export function createMessagesTable(): MessagesTable {
  return createTable<MessageRow>({ unique: ["traceId"] });
}

export type RecordOptions = {
  conflict?: "select" | "throw";
  guard?: "reject-zero" | "accept-zero";
};

export type RecordOutcome = {
  id: number;
  outcome: "inserted" | "existing";
  /** Set when the trace id was rejected and the row was stored without a key. */
  warning: string | null;
};

export function recordReply(
  table: MessagesTable,
  row: { conversationId: string; content: string; traceId: string },
  options: RecordOptions = {},
): RecordOutcome {
  const { conflict = "select", guard = "reject-zero" } = options;
  const { conversationId, content } = row;

  let traceId: string | null = row.traceId;
  let warning: string | null = null;
  if (guard === "reject-zero" && !isValidTraceId(row.traceId)) {
    // Not a key. Stored as null, which never conflicts, and reported.
    traceId = null;
    warning = `invalid trace id "${row.traceId}": stored null and reported`;
  }

  try {
    const inserted = table.insert({ conversationId, role: "assistant", content, traceId });
    return { id: inserted.id, outcome: "inserted", warning };
  } catch (error) {
    if (!(error instanceof UniqueViolationError) || conflict === "throw") throw error;
    // The earlier write landed. Select it, do not insert again.
    const [existing] = table.selectBy("traceId", traceId);
    if (existing === undefined) throw error;
    return { id: existing.id, outcome: "existing", warning };
  }
}
