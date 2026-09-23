/**
 * Upserts the `ai-disclosure-*` rows into the live Braintrust dataset
 * "GCA — Golden Dataset" (the one evals/golden-dataset.eval.ts runs). Same
 * shape as scripts/push-date-resolution-rows.ts: this file only holds the
 * rows it inserts, so they can be reviewed in a PR before they land.
 * Idempotent: Dataset.insert with an explicit `id` upserts.
 *
 * The rows reproduce the 2026-09-23 production incident: a brand-new
 * conversation's first reply ("Both rooms are free October 6-8. Here's a
 * quick comparison: ...") opened without the AI disclosure. Scored by
 * evals/evaluators.ts's aiDisclosure. Scenario reference date: today =
 * 2026-09-23.
 *
 * ai-disclosure-cold-start-01 supplies the first turn up to its final reply
 * round (the single-round harness only sees one model round, and a cold
 * availability question usually yields tool calls with empty text), so it
 * sets `firstTurn: true`: the in-turn tool calls are assistant messages, yet
 * this is still the guest's first turn. Run with
 * GCA_EVAL_DISABLE_FIRST_TURN_LINE=1 to see it fail without the line.
 *
 * ai-disclosure-second-turn-01 replays a stored first turn whose reply
 * already introduced itself, so detection must yield "not first" and the
 * reply must not introduce itself again.
 *
 * Run with (needs BRAINTRUST_API_KEY; same org/project in every env):
 *   yarn tsx --env-file=.env.development scripts/push-ai-disclosure-rows.ts
 */
import type { ModelMessage } from "ai";
import { initDataset } from "braintrust";
import type { EvalInput, ExpectedShape } from "../evals/types";
import type { MessageRow } from "../src/lib/db";

const PROJECT = "issebya-homes-ai-system";
const DATASET_NAME = "GCA — Golden Dataset";

interface GoldenRow {
  id: string;
  input: EvalInput;
  expected: ExpectedShape;
  metadata: { description: string };
}

const NO_CONTEXT = "No prior guest information available.";
const TODAY = "2026-09-23";
const FIRST_MESSAGE = "Hi, do you have a room free 6-8 October?";

function storedRow(
  id: string,
  role: MessageRow["role"],
  content: string,
  createdAt: string,
  turnMessages: NonNullable<MessageRow["turn_messages"]>["messages"] | null = null,
): MessageRow {
  return {
    id,
    role,
    content,
    created_at: createdAt,
    turn_messages: turnMessages ? { schema_version: 1, messages: turnMessages } : null,
  };
}

const availabilityCalls: ModelMessage[] = [
  {
    role: "assistant",
    content: (["room1", "room2"] as const).map((room) => ({
      type: "tool-call" as const,
      toolCallId: `call_avail_${room}`,
      toolName: "check_availability",
      input: { room, checkIn: "2026-10-06", checkOut: "2026-10-08" },
    })),
  },
  {
    role: "tool",
    content: (["room1", "room2"] as const).map((room) => ({
      type: "tool-result" as const,
      toolCallId: `call_avail_${room}`,
      toolName: "check_availability",
      output: {
        type: "json" as const,
        value: { available: true, room, checkIn: "2026-10-06", checkOut: "2026-10-08" },
      },
    })),
  },
];

const pricingCalls: ModelMessage[] = [
  {
    role: "assistant",
    content: (["room1", "room2"] as const).map((room) => ({
      type: "tool-call" as const,
      toolCallId: `call_price_${room}`,
      toolName: "get_pricing",
      input: { room },
    })),
  },
  {
    role: "tool",
    content: (["room1", "room2"] as const).map((room) => ({
      type: "tool-result" as const,
      toolCallId: `call_price_${room}`,
      toolName: "get_pricing",
      output: {
        type: "json" as const,
        value: {
          room,
          pricePerNight: 75,
          currency: "EUR",
          note: "Flat rate per night, does not include the tourist tax.",
        },
      },
    })),
  },
];

const FIRST_REPLY =
  "Hi! I'm the AI concierge for Issebya Homes. Good news: both rooms are free October 6-8. Would you like details on either one?";

const secondTurnRows: MessageRow[] = [
  storedRow("second-turn-1", "user", FIRST_MESSAGE, "2026-09-23T20:00:40Z"),
  storedRow("second-turn-2", "assistant", FIRST_REPLY, "2026-09-23T20:00:48Z", [
    ...availabilityCalls,
    ...pricingCalls,
    { role: "assistant", content: FIRST_REPLY },
  ]),
  storedRow("second-turn-3", "user", "How much is it?", "2026-09-23T20:01:30Z"),
];

const rows: GoldenRow[] = [
  {
    id: "ai-disclosure-cold-start-01",
    input: {
      contextBlock: NO_CONTEXT,
      today: TODAY,
      firstTurn: true,
      messages: [{ role: "user", content: FIRST_MESSAGE }, ...availabilityCalls],
    },
    expected: {
      toolCall: null,
      expectedAlternative: "text-only",
      aiDisclosure: "present",
    },
    metadata: {
      description:
        "First turn of a brand-new conversation, at its final reply round: check_availability already reported both rooms free 2026-10-06 to 2026-10-08. The reply must open with the AI disclosure (aiDisclosure: present). Reproduces the 2026-09-23 production reply that opened 'Both rooms are free October 6-8' with no introduction. firstTurn: true because the in-turn tool calls are assistant messages.",
    },
  },
  {
    id: "ai-disclosure-second-turn-01",
    input: {
      contextBlock: NO_CONTEXT,
      today: TODAY,
      rows: secondTurnRows,
    },
    expected: {
      toolCall: null,
      expectedAlternative: "text-only",
      aiDisclosure: "absent",
    },
    metadata: {
      description:
        "Second turn: the stored first reply already introduced the AI concierge, and its replayed turn_messages carry the availability and pricing results, so 'How much is it?' can be answered in text. The reply must not repeat the AI introduction anywhere (aiDisclosure: absent). No firstTurn override: detection from the replayed assistant row must yield 'not first'.",
    },
  },
];

async function main() {
  const dataset = initDataset({ project: PROJECT, dataset: DATASET_NAME });
  for (const row of rows) {
    dataset.insert(row);
    console.log(`upserted ${row.id}`);
  }
  await dataset.flush();
  console.log(`done: ${rows.length} rows in "${DATASET_NAME}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
