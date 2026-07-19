import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

// createOpenRouter() with no `apiKey` option reads OPENROUTER_API_KEY from the
// environment lazily, same convention as apps/orch-a/src/mastra/agents/reporter-agent.ts.
const openrouter = createOpenRouter();

const socialPostSchema = z.object({
  altText: z.string(),
  caption: z.string(),
});
export type SocialPost = z.infer<typeof socialPostSchema>;

/**
 * Placeholder instructions: a reasonable starting point, not a tuned final
 * version — prompt wording and model choice are expected to be backward-
 * engineered from real output later, per how this was scoped.
 */
const INSTRUCTIONS =
  "You write alt text and captions for the issebya.homes social media account, " +
  "given a description of what was delivered in a specific post or reel.\n\n" +
  "Alt text: around 100 keywords (comma-separated), optimized for social search " +
  "and answer-engine discovery (AEO/SEO) — not a plain accessibility description. " +
  "Mix specific terms from the given post description with recurring brand/location " +
  "terms (property name, location, room names, key amenities, guest personas) so " +
  "core terms appear across posts, not just what's unique to this one.\n\n" +
  "Caption: reads as a natural continuation of the post/reel's own idea — not " +
  "generic marketing copy bolted on. Must end with exactly 5 hashtags, each its " +
  "own token starting with #, relevant to the specific post content.\n\n" +
  "Only use what's actually implied by the given post description — never invent " +
  "details, amenities, or claims that aren't there.";

function createSocialAgent() {
  return new Agent({
    id: "social-post-generator",
    name: "Social Media Post Generator",
    description:
      "Generates alt text (SEO/AEO keywords) and a caption (ending in 5 hashtags) for a social post.",
    instructions: INSTRUCTIONS,
    model: openrouter.chat("deepseek/deepseek-v4-pro"),
  });
}

const socialAgent = createSocialAgent();

/** Pure prompt-building, factored out so it's testable without an LLM call. */
export function buildPrompt(idea: string): string {
  return `Post/reel description:\n${idea}\n\nGenerate the alt text and caption per your instructions.`;
}

export async function generateSocialPost(idea: string): Promise<SocialPost> {
  const result = await socialAgent.generate(buildPrompt(idea), {
    structuredOutput: { schema: socialPostSchema },
  });
  return result.object;
}
