import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { renderSeedContext } from "@/lib/social/seed-vocabulary";

// createOpenRouter() with no `apiKey` option reads OPENROUTER_API_KEY from the
// environment lazily.
const openrouter = createOpenRouter();

const socialPostSchema = z.object({
  altText: z.string(),
  caption: z.string(),
});
export type SocialPost = z.infer<typeof socialPostSchema>;

// Backward-engineered from a real approved example, trimmed to drop the
// event-space/amenities content (not confirmed seed vocabulary yet) — kept
// only as a style/structure reference, not content to copy.
const ALT_TEXT_EXAMPLE =
  "Looking for a place to rest near Lisbon? This guest house in Almoçageme, inside the " +
  "Sintra-Cascais Natural Park, is the quiet coastal retreat people search for when they ask " +
  "where to stay near Sintra or where to find a hidden gem on the Lisbon coast. Just 29 km " +
  "from Lisbon Airport, no car needed, it sits minutes from Praia da Adraga and within reach " +
  "of Praia Grande, Praia das Maçãs, and the remote Praia da Ursa — making it a natural " +
  "answer for anyone searching best beaches near Sintra or where to stay for a surf trip near " +
  "Lisbon. Hikers looking for the best hikes near Sintra will find Cabo da Roca an hour's walk " +
  "away, along with trails to Convento dos Capuchos, Pedra Amarela, and the Sanctuary of " +
  "Peninha, so this also answers where to stay near Cabo da Roca or Sintra Cascais Natural " +
  "Park accommodation. Whether the search is where to stay in Sintra, best hidden village near " +
  "Lisbon, or underrated Portugal destination, this guest house in Almoçageme is the answer.";

/**
 * Instructions backward-engineered from real approved output (see
 * ALT_TEXT_EXAMPLE) and direct feedback on a real generated caption that read
 * as a "trails/nature account" rather than bookable accommodation — the
 * accommodation-intent and hashtag-slot requirements below exist specifically
 * to prevent that drift.
 */
const INSTRUCTIONS =
  "You write alt text and captions for the issebya.homes social media account, given a " +
  "description of what was delivered in a specific post or reel, plus fixed brand/location " +
  "context that's provided in every prompt (see below).\n\n" +
  "Alt text: NOT a comma-separated keyword list — flowing prose, AEO-style, structured as " +
  'answers to real questions people search ("where to stay near Sintra", "best beaches near ' +
  'Sintra", "quiet guest house Portugal", etc.), similar length and density to this reference ' +
  `example:\n\n"${ALT_TEXT_EXAMPLE}"\n\n` +
  "Weave in whatever is specific to the given post/reel description alongside the fixed " +
  "location/brand facts — don't just repeat the reference example verbatim.\n\n" +
  "Caption: reads as a natural continuation of the post/reel's own idea — not generic " +
  "marketing copy bolted on. Must explicitly state accommodation intent (using one of the " +
  "given accommodation-intent terms) — never rely on scenery/activity description alone to " +
  "imply it, since that reads as a nature/trails account instead of a bookable stay. Must end " +
  "with exactly 5 hashtags: one branded, one explicit accommodation-category tag, one " +
  "location tag, one persona/activity tag specific to this post, one free tag.\n\n" +
  "Only use what's actually implied by the given post description plus the fixed context below " +
  "— never invent details, amenities, or claims that aren't there.";

function createSocialAgent() {
  return new Agent({
    id: "social-post-generator",
    name: "Social Media Post Generator",
    description:
      "Generates alt text (AEO/SEO prose) and a caption (accommodation-intent + 5 hashtags) for a social post.",
    instructions: INSTRUCTIONS,
    model: openrouter.chat("deepseek/deepseek-v4-pro"),
  });
}

const socialAgent = createSocialAgent();

/** Pure prompt-building, factored out so it's testable without an LLM call. */
export function buildPrompt(idea: string): string {
  return (
    `${renderSeedContext()}\n\n` +
    `Post/reel description:\n${idea}\n\n` +
    "Generate the alt text and caption per your instructions."
  );
}

export async function generateSocialPost(idea: string): Promise<SocialPost> {
  const result = await socialAgent.generate(buildPrompt(idea), {
    structuredOutput: { schema: socialPostSchema },
  });
  return result.object;
}
