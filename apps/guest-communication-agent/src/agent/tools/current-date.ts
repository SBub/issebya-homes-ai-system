import { tool } from "ai";
import { z } from "zod";

const getCurrentDateSchema = z.object({});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runGetCurrentDate below by name. No arguments needed, so the input schema
// is an empty object (AI SDK/zod handle a no-arg tool fine this way).
export const getCurrentDate = tool({
  description:
    "Get today's actual real-world date. Call this BEFORE resolving any relative date or day reference the guest mentions (e.g. 'tomorrow', 'next weekend', 'this Friday', 'in two weeks') or before checking availability for a relative date — do not guess or infer today's date from training data, always call this tool first and do the date arithmetic from its result.",
  inputSchema: getCurrentDateSchema,
});

export async function runGetCurrentDate() {
  // NOTE: there is no property/host timezone concept anywhere in this
  // codebase (confirmed via grep) — this deliberately uses UTC rather than
  // guessing one (e.g. assuming Portugal/Lisbon just because some test
  // fixtures use +351 phone numbers). This is a real limitation: near
  // midnight, UTC's "today" can differ from the property's local "today" by
  // a day. Revisit if/when a real property timezone is introduced.
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  return {
    date: isoDate,
    dayOfWeek,
    isoTimestamp: now.toISOString(),
    timezone: "UTC",
  };
}
