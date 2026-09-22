import { tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";
import { computeCurrentDate } from "./current-date";
import { type StayRangeProblem, validateStayRange } from "./stay-range";

function datesOverlap(reqStart: Date, reqEnd: Date, bookedStart: Date, bookedEnd: Date): boolean {
  return reqStart < bookedEnd && reqEnd > bookedStart;
}

const checkAvailabilitySchema = z.object({
  room: z.enum(["room1", "room2"]).describe("Which room to check"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

// Schema-only — run-tool.ts dispatches to runCheckAvailability below by name.
export const checkAvailability = tool({
  description:
    "Check if a room is available for the requested dates. Use when the guest mentions specific check-in and check-out dates.",
  inputSchema: checkAvailabilitySchema,
});

// Two shapes, spelled out rather than inferred so callers (booking.ts's
// re-verification) can narrow on the guard's `reason` instead of guessing.
type AvailabilityResult =
  | {
      available: false;
      reason: StayRangeProblem;
      room: z.infer<typeof checkAvailabilitySchema>["room"];
      checkIn: string;
      checkOut: string;
      today: string;
    }
  | {
      available: boolean;
      room: z.infer<typeof checkAvailabilitySchema>["room"];
      checkIn: string;
      checkOut: string;
    };

// Calls the live GET /api/availability?room= endpoint (its own 1h in-memory
// cache) rather than duplicating apps/website's iCal parsing here. Owns the
// date guard: an unusable range is refused here, never fetched. Also called
// directly by run-code.ts's sandboxApi as an internal helper.
export async function computeCheckAvailability(
  args: z.infer<typeof checkAvailabilitySchema>,
): Promise<AvailabilityResult> {
  const { room, checkIn, checkOut } = args;

  // Nothing is ever booked in the past, so without this a past range would
  // come back available. `today` rides along in the result so the model can
  // re-resolve the date without a second tool round trip.
  const today = computeCurrentDate().date;
  const problem = validateStayRange(checkIn, checkOut, today);
  if (problem) {
    return { available: false, reason: problem, room, checkIn, checkOut, today };
  }

  const reqStart = new Date(checkIn);
  const reqEnd = new Date(checkOut);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
  const res = await fetch(`${siteUrl}/api/availability?room=${room}`);
  if (!res.ok) {
    throw new Error(`GET /api/availability?room=${room} failed with status ${res.status}`);
  }
  const { bookings } = (await res.json()) as {
    bookings: { start: string; end: string }[];
  };

  const conflict = bookings.find((b) =>
    datesOverlap(reqStart, reqEnd, new Date(b.start), new Date(b.end)),
  );

  return { available: !conflict, room, checkIn, checkOut };
}

export async function runCheckAvailability(
  args: z.infer<typeof checkAvailabilitySchema>,
  context: ToolContext,
) {
  return steppedSpan(
    context.step,
    "tool-check_availability",
    context.traceAnchor,
    "gen_ai.tool.check_availability",
    { "gen_ai.tool.name": "check_availability", "gen_ai.operation.name": "execute_tool" },
    (span) => dispatchToolExecution(span, args, () => computeCheckAvailability(args)),
  );
}
