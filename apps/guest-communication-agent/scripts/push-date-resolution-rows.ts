/**
 * Upserts the `date-resolution-*` rows into the live Braintrust dataset
 * "GCA — Golden Dataset" (the one evals/golden-dataset.eval.ts runs). The
 * dataset stays the source of truth for every other row; this file only
 * holds the rows it inserts, so they can be reviewed in a PR before they
 * land. Idempotent: Dataset.insert with an explicit `id` upserts, so
 * re-running overwrites these four rows and touches nothing else.
 *
 * All four reproduce the 2026-09-21 production incident: (a) "asap" got
 * "which exact dates?" twice because the model never used run_code to scan
 * forward, and (b) "October 11-13" was resolved to 2025, check_availability
 * reported the past as available, and a 2025 booking link went out.
 * Scenario reference date: today = 2026-09-21 (a Monday).
 *
 * Run with (needs BRAINTRUST_API_KEY; same org/project in every env):
 *   yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts
 */
import { initDataset } from "braintrust";
import type { EvalInput, ExpectedShape } from "../evals/types";

const PROJECT = "issebya-homes-ai-system";
const DATASET_NAME = "GCA — Golden Dataset";

interface GoldenRow {
  id: string;
  input: EvalInput;
  expected: ExpectedShape;
  metadata: { description: string };
}

const NO_CONTEXT = "No prior guest information available.";

const rows: GoldenRow[] = [
  {
    id: "date-resolution-vague-01",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [{ role: "user", content: "I'd like to book room 1 asap" }],
    },
    expected: {
      toolCall: { name: "run_code" },
      expectedAlternative: "get_current_date",
    },
    metadata: {
      description:
        "Vague, urgent booking request with no dates: 'asap' is a request to find the FIRST open dates, not a prompt to ask the guest for them. check_availability only accepts one exact range, so scanning forward needs run_code (with get_current_date as a legitimate first step, hence expectedAlternative). Reply expectations (not scored by toolCallMatch, for human review): the reply must propose concrete candidate dates for room 1 and must NOT ask the guest for check-in/check-out dates. Reproduces the 2026-09-21 production turn where the model replied 'which dates did you have in mind?' instead.",
    },
  },
  {
    id: "date-resolution-vague-02",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [
        { role: "user", content: "I'd like to book room 1 asap" },
        { role: "assistant", content: "Of course. Which dates did you have in mind for Room 1?" },
        { role: "user", content: "ASAP" },
      ],
    },
    expected: {
      toolCall: { name: "run_code" },
      expectedAlternative: "get_current_date",
    },
    metadata: {
      description:
        "Exact 2026-09-21 production transcript: the assistant already asked for dates once and the guest repeated 'ASAP'. The second ask is the bug this row exists to catch. Expects run_code to scan forward from today for the first open range (get_current_date accepted as the first step). Reply expectations (not scored by toolCallMatch, for human review): the reply must NOT ask for specific dates again; it should offer the earliest available dates for room 1.",
    },
  },
  {
    id: "date-resolution-year-01",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [{ role: "user", content: "October 11-13 room 1" }],
    },
    expected: {
      toolCall: { name: "get_current_date" },
      expectedAlternative: "run_code",
    },
    metadata: {
      description:
        "Room and dates given, but with no year. The model must resolve the year from get_current_date (or inside run_code, which can call it) before touching availability. Calling check_availability directly in this turn with a guessed year is the failure: on 2026-09-21 the model guessed 2025, check_availability found nothing booked in the past and said available, and a 2025 booking link was sent. Companion row date-resolution-year-02 covers the turn after get_current_date returns.",
    },
  },
  {
    id: "date-resolution-year-02",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [
        { role: "user", content: "October 11-13 room 1" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_gcd_1",
              toolName: "get_current_date",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_gcd_1",
              toolName: "get_current_date",
              output: {
                type: "json",
                value: {
                  date: "2026-09-21",
                  dayOfWeek: "Monday",
                  isoTimestamp: "2026-09-21T10:00:00.000Z",
                  timezone: "UTC",
                },
              },
            },
          ],
        },
      ],
    },
    expected: {
      toolCall: {
        name: "check_availability",
        args: { room: "room1", checkIn: "2026-10-11", checkOut: "2026-10-13" },
      },
      expectedAlternative: null,
    },
    metadata: {
      description:
        "Turn after get_current_date returned 2026-09-21: October 11-13 is still ahead this year, so the only correct next move is check_availability(room1, 2026-10-11, 2026-10-13). Args ARE scored for check_availability (evals/evaluators.ts's ARGS_SCORED_TOOLS), so a 2025 or 2027 year, or a wrong room, fails this row even though the tool name matches. No expectedAlternative: the date is already resolved, a second get_current_date or run_code here is a miss.",
    },
  },

  // Pre-existing rows whose expectations the date-resolution rule (system
  // prompt rule 3, 2026-09-21) and the now-scored check_availability args
  // invalidated. Same ids as in the live dataset, so these overwrite in place.
  {
    id: "check-availability-01-positive-single-message-room-and-dates",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [
        { role: "user", content: "Hi, is room 1 available from September 10 to September 14?" },
      ],
    },
    expected: {
      toolCall: { name: "get_current_date" },
      expectedAlternative: "run_code",
    },
    metadata: {
      description:
        "Room and both dates given in a single message, but with no year, so rule 3's date-resolution step applies first: call get_current_date (or run_code, which can call it) before check_availability. Originally expected check_availability(room1, 2026-09-10, 2026-09-14) directly; that became wrong twice over on 2026-09-21: the prompt now requires resolving the year first, and September 10-14 has already passed in 2026, so the next occurrence is 2027. The resolved-date turn is covered by date-resolution-year-02.",
    },
  },
  {
    id: "check-availability-02-positive-multi-turn-date-confirmation",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [
        { role: "user", content: "Hi, I'm interested in room 2 for a stay in October." },
        {
          role: "assistant",
          content: "Room 2 is lovely! Do you have specific check-in and check-out dates in mind?",
        },
        { role: "user", content: "Yes, October 5th to October 9th please." },
      ],
    },
    expected: {
      toolCall: {
        name: "check_availability",
        args: { room: "room2", checkIn: "2026-10-05", checkOut: "2026-10-09" },
      },
      expectedAlternative: "get_current_date",
    },
    metadata: {
      description:
        "Room named in the first message, exact dates only confirmed two turns later after a clarifying question: tests that room/date extraction spans messages. No year given, so get_current_date as the first call is accepted (expectedAlternative). If the model calls check_availability directly, its args ARE scored (evals/evaluators.ts's ARGS_SCORED_TOOLS): it must be room2, 2026-10-05 to 2026-10-09, the next future occurrence as of 2026-09-21.",
    },
  },
  {
    id: "property-question-08-negative-availability-belongs-to-different-tool",
    input: {
      contextBlock: NO_CONTEXT,
      messages: [{ role: "user", content: "Is room 1 free 10-14 September?" }],
    },
    expected: {
      toolCall: null,
      expectedAlternative: "get_current_date",
    },
    metadata: {
      description:
        "Same boundary as row 07, for availability: this is not an answer_property_question call. Availability has its own tool, and because the dates carry no year, rule 3 now makes get_current_date the required first step before check_availability, hence the alternative.",
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
