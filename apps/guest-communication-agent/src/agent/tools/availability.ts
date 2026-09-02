import { tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";

function datesOverlap(reqStart: Date, reqEnd: Date, bookedStart: Date, bookedEnd: Date): boolean {
  return reqStart < bookedEnd && reqEnd > bookedStart;
}

const checkAvailabilitySchema = z.object({
  room: z.enum(["room1", "room2"]).describe("Which room to check"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runCheckAvailability below by name.
export const checkAvailability = tool({
  description:
    "Check if a room is available for the requested dates. Use when the guest mentions specific check-in and check-out dates.",
  inputSchema: checkAvailabilitySchema,
});

// Calls the live GET /api/availability?room= endpoint (which has its own
// 1-hour in-memory cache server-side) rather than duplicating apps/website's
// iCal/availability parsing here. No tracing of its own — also called
// directly by run-code.ts's sandboxApi (an internal helper invocation, not a
// real dispatched tool call worth its own trace span).
export async function computeCheckAvailability(args: z.infer<typeof checkAvailabilitySchema>) {
  const { room, checkIn, checkOut } = args;
  const reqStart = new Date(checkIn);
  const reqEnd = new Date(checkOut);

  if (Number.isNaN(reqStart.getTime()) || Number.isNaN(reqEnd.getTime())) {
    return { available: false, error: "Invalid date format" };
  }

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

// The tool's real dispatch: this app's run<ToolName> convention (see
// wants-human.ts's runWantsHuman for the model this follows) — creates its
// own gen_ai.tool.check_availability execution span, called directly from
// run-tool.ts's runTool().
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
