// Prints exactly what the Telegram digest would look like right now, using
// real Availability data + the Finance stub — without calling the LLM or
// sending anything. Useful for checking copy/formatting changes without
// spamming the real Telegram chat. `summary` below stands in for the LLM's
// one-line framing sentence (see src/mastra/agents/reporter-agent.ts).
import { detectAnomalies, renderReport } from "../src/core/models.js";
import { checkHeartbeat } from "../src/health/checks.js";
import { fetchAvailability } from "../src/tools/availability.js";
import { fetchCampaignStats } from "../src/tools/campaigns.js";
import { fetchFinance } from "../src/tools/finance.js";

async function main() {
  const availability = await fetchAvailability();
  const finance = await fetchFinance();
  const campaigns = await fetchCampaignStats();
  const anomalies = detectAnomalies(availability, finance);
  const health = [checkHeartbeat(new Date(), 60)];
  const text = renderReport({
    summary: "(LLM-generated one-line summary would go here)",
    availability,
    finance,
    campaigns,
    anomalies,
    health,
  });
  console.log(text);
}

main();
