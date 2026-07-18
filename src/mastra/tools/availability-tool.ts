import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { availabilitySnapshotSchema, fetchAvailability } from "../../tools/availability.js";

export function createAvailabilityTool() {
  return createTool({
    id: "get-availability",
    description:
      "Fetch current Availability state (per-property occupancy and open nights) directly from Supabase.",
    inputSchema: z.object({}),
    outputSchema: z.array(availabilitySnapshotSchema),
    execute: async () => fetchAvailability(),
  });
}
