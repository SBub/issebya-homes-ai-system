import type { Message } from "@/lib/harness/fake-model";
import type { Table } from "@/lib/harness/store";
import {
  buildHistory,
  estimateTokens,
  finalizeTurn,
  type MessageRow,
  trimToBudget,
} from "@/lib/history/history";
import { type Fold, groupByTurn, type Memory, type MemoryMessage } from "@/lib/memory-fold/fold";

/**
 * The composite behind the `agent-memory-window` demo: what the model sees
 * on a turn and what happens after the reply is sent, on the harness table.
 * It is the shape of GCA's memory.ts over context.ts:
 *
 * - On the turn: the watermark drops what is already folded, the unfolded
 *   rows are grouped by turn with the last few replayed verbatim
 *   (turn-replay-history), whole turns are trimmed to the token budget, and
 *   the memory message goes ahead of the history.
 * - After the send: the rows the trim dropped are what folds, the watermark
 *   moves to the last of them, and old folds distil into the preferences
 *   (fold-and-distill-memory).
 */

export type WindowOptions = {
  verbatimTurns: number;
  budget: { max: number; keep: number };
};

export type LoadedMemory = {
  memoryMessage: MemoryMessage | null;
  /** The kept turns, one list per turn. */
  groups: Message[][];
  /** The memory message, when there is one, then the kept turns flattened: what the model is called with. */
  messages: Message[];
  droppedRows: MessageRow[];
  tokens: { before: number; after: number };
};

/** The fast path, every turn: no model call, no write. Watermark first, then tiers, then the trim. */
export function loadMemory(
  rows: MessageRow[],
  memory: Memory,
  options: WindowOptions,
): LoadedMemory {
  const unfolded = memory.unfolded(rows);
  const groups = buildHistory(unfolded, { verbatimTurns: options.verbatimTurns });
  const { kept, dropped } = trimToBudget(groups, options.budget);
  // The trim only peels whole groups off the front, so the dropped rows are the first groups' rows.
  const droppedRows = groupByTurn(unfolded).slice(0, dropped).flat();
  const memoryMessage = memory.buildMemoryMessage();
  const history = kept.flat();
  return {
    memoryMessage,
    groups: kept,
    messages: memoryMessage === null ? history : [memoryMessage, ...history],
    droppedRows,
    tokens: { before: estimateTokens(groups.flat()), after: estimateTokens(history) },
  };
}

/** The fold path, after the send: re-reads the rows so this turn's own reply counts, and folds what the trim drops. */
export function foldMemory(
  rows: MessageRow[],
  memory: Memory,
  options: WindowOptions,
): Promise<Fold | null> {
  return memory.recordFold(loadMemory(rows, memory, options).droppedRows);
}

export type ScriptedTurn = {
  question: string;
  tool: { name: string; input: Record<string, unknown>; output: unknown };
  reply: string;
};

export type RowsTable = Table<Omit<MessageRow, "id">>;

/** One turn on the table: store the question, load, store the reply with its turn messages, then fold. */
export async function runTurn(
  table: RowsTable,
  memory: Memory,
  turn: ScriptedTurn,
  options: WindowOptions,
): Promise<{ saw: LoadedMemory; fold: Fold | null }> {
  table.insert({ role: "user", content: turn.question, turnMessages: null });
  const saw = loadMemory(table.rows(), memory, options);

  const callId = `call_${table.rows().length}`;
  const tail: Message[] = [
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: callId, toolName: turn.tool.name, input: turn.tool.input },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: callId,
          toolName: turn.tool.name,
          output: turn.tool.output,
        },
      ],
    },
    { role: "assistant", content: turn.reply },
  ];
  table.insert({
    role: "assistant",
    content: turn.reply,
    turnMessages: finalizeTurn(tail, turn.reply),
  });

  // The reply is sent here. The fold runs after it, off the reply path.
  const fold = await foldMemory(table.rows(), memory, options);
  return { saw, fold };
}
