import { z } from "zod";
import type { Message } from "@/lib/harness/fake-model";

/**
 * The shapes shared by the dataset, the executor, the scorers and the gate
 * behind the `eval-gate-independent-thresholds` demo. A case's `input` is
 * the conversation so far, the newest user message last; `expected` is
 * oracle data only, no prose; `metadata` carries what a judge scorer needs.
 */

const expectedSchema = z.object({
  toolCall: z
    .object({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() })
    .nullable(),
  /** `"text-only"` keeps the no-tool-call check; another name means "that tool is also right". */
  expectedAlternative: z.string().nullable(),
  aiDisclosure: z.enum(["present", "absent"]).optional(),
});

const messageSchema = z.union([
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string() }),
]);

export const evalCaseSchema = z.object({
  id: z.string(),
  input: z.object({ messages: messageSchema.array().min(1) }),
  expected: expectedSchema,
  metadata: z.object({ securityInvariant: z.string().optional() }).optional(),
});

type ExpectedShape = z.infer<typeof expectedSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalInput = { messages: Message[] };

type ToolCallInfo = { toolName: string; args: Record<string, unknown> };

/** What one executor call returns: every tool call the model asked for in its one round, and its text. */
export type SingleTurnResult = { toolCalls: ToolCallInfo[]; toolNames: string[]; text: string };

/** The executor, called once per case per trial. */
export type Executor = (input: EvalInput, context: { trial: number }) => Promise<SingleTurnResult>;

type Score = { name: string; score: number; metadata?: Record<string, unknown> };

export type ScorerArgs = {
  input: EvalInput;
  output: SingleTurnResult;
  expected: ExpectedShape;
  metadata: EvalCase["metadata"];
};

/** A scorer returns a score, or bare `null` to skip the row: not applicable, not zero. */
export type Scorer = (args: ScorerArgs) => Score | null | Promise<Score | null>;
