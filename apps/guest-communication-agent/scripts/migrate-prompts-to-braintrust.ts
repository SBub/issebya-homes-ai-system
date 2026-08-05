/**
 * One-off migration: pushes GCA's two LLM prompts into Braintrust, replacing
 * LangSmith as the prompt-management source of truth (see run-turn.ts and
 * memory.ts for the runtime-side swap to braintrust's loadPrompt()).
 *
 * Usage: yarn tsx --env-file=.env scripts/migrate-prompts-to-braintrust.ts
 *
 * Idempotent: uses Braintrust's PUT /v1/prompt (create-or-replace by
 * project_id + slug), so re-running after editing this script's SUMMARIZER
 * prompt text, or after LangSmith's live commit changes, just updates the
 * existing Braintrust prompt in place rather than duplicating it.
 *
 * No environment promotion: Braintrust requires a "production" environment
 * to be created once via its UI (Configuration > Environments) before any
 * prompt can be promoted to it, and issebya's org doesn't have one set up
 * yet — see the DataPlaneRedirectError/BadRequestError this hit the first
 * two times it ran. Rather than block this migration on that manual step,
 * the runtime side (run-turn.ts / memory.ts) pins the exact version id this
 * script prints below. That trades away LangSmith's "edit the live prompt in
 * the UI, no deploy needed" property — bumping the prod prompt now means:
 * edit here or in Braintrust's UI, run this script, copy the printed
 * version id into run-turn.ts / memory.ts's *_PROMPT_VERSION constant, ship.
 * Once a "production" environment exists, switch those two call sites to
 * loadPrompt({ environment: "production" }) and this version-pinning goes
 * away.
 *
 * Two prompts, two different content sources:
 *
 * 1. Summarizer (memory.ts's summarizeConversation) — content is already
 *    plain TS string literals in this repo, never lived in LangSmith. Copied
 *    here verbatim; memory.ts's own hardcoded copy is deleted once this
 *    migration has run and memory.ts is switched over to loadPrompt().
 *
 * 2. System prompt (run-turn.ts's SYSTEM_PROMPT_IDENTIFIER,
 *    "whatsapp-booking-agent:production") — content is NOT in this repo. It
 *    only exists live in LangSmith's Prompt Hub, edited there directly. This
 *    script pulls the raw (unrendered) template via the same
 *    langsmithClient.pullPromptCommit() call run-turn.ts used, extracts the
 *    system message's raw f-string template (before run-turn.ts would have
 *    called .invoke() to fill in {guest_memory_block}), converts it from
 *    f-string `{var}` to Braintrust's mustache `{{var}}` syntax, and pushes
 *    that as-is — so the migrated prompt is byte-for-byte the current
 *    production wording, not a rewrite.
 */
import { load } from "@langchain/core/load";
import * as prompts from "@langchain/core/prompts";
import { Client } from "langsmith";

const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY;
const BRAINTRUST_PROJECT_ID = process.env.BRAINTRUST_PROJECT_ID;
const LANGSMITH_SYSTEM_PROMPT_IDENTIFIER = "whatsapp-booking-agent:production";
// The issebya org is EU-data-plane (same gotcha LANGSMITH_ENDPOINT calls out
// for LangSmith) — api.braintrust.dev's default (US) data plane 421s with a
// DataPlaneRedirectError pointing here. BRAINTRUST_API_URL lets this be
// overridden without editing code if that ever changes.
const BRAINTRUST_API_BASE = process.env.BRAINTRUST_API_URL ?? "https://api-eu.braintrust.dev";
const BRAINTRUST_API_URL = `${BRAINTRUST_API_BASE}/v1/prompt`;

if (!BRAINTRUST_API_KEY || !BRAINTRUST_PROJECT_ID) {
  console.error("BRAINTRUST_API_KEY and BRAINTRUST_PROJECT_ID must both be set.");
  process.exit(1);
}

interface ChatMessageData {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PromptDefinition {
  slug: string;
  name: string;
  description: string;
  model: string;
  messages: ChatMessageData[];
}

// Verbatim copy of the two hardcoded messages currently in memory.ts's
// summarizeConversation — see that file's own comment for why they read the
// way they do. Deleted from memory.ts once this has run successfully.
const SUMMARIZER_PROMPT: PromptDefinition = {
  slug: "conversation-summarizer",
  name: "Conversation Summarizer",
  description:
    "Compresses an older stretch of a WhatsApp guest conversation into memory.ts's rolling guest_memory summary.",
  model: "deepseek/deepseek-v4-pro",
  messages: [
    {
      role: "system",
      content:
        "You compress an older stretch of a WhatsApp guest conversation with a " +
        "vacation-rental booking agent into a short running summary. Preserve concrete " +
        "facts: the guest's name (if mentioned), rooms/dates discussed or booked, prices " +
        'quoted, promises or commitments made (e.g. "I\'ll check with the owner"), any ' +
        "prior owner nudges, and guest-stated preferences or facts. Be terse.",
    },
    {
      role: "user",
      content:
        "Prior summary:\n{{prior_summary}}\n\nFold in this older part of the conversation:\n{{transcript}}\n\nReturn the updated summary.",
    },
  ],
};

// f-string {var} -> mustache {{var}}. Only ever expected to match
// guest_memory_block — throws below if the pulled template contains any
// other single-brace variable, so a silent partial conversion never ships.
function fstringToMustache(template: string, expectedVars: string[]): string {
  const found = [...template.matchAll(/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g)].map(
    (m) => m[1],
  );
  const unexpected = found.filter((v) => !expectedVars.includes(v));
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected template variable(s) in pulled LangSmith prompt: ${unexpected.join(", ")}. ` +
        `Expected only: ${expectedVars.join(", ")}. Refusing to guess a conversion.`,
    );
  }
  let result = template;
  for (const v of expectedVars) {
    result = result.replaceAll(`{${v}}`, `{{${v}}}`);
  }
  return result;
}

// The manifest's class id is namespaced under "langchain" rather than
// "langchain_core", so "prompts" must be supplied explicitly via importMap
// or load() throws "Invalid namespace" — same gotcha as run-turn.ts's own
// (now-deleted) pullSystemPromptTemplate.
async function pullSystemPromptDefinition(): Promise<PromptDefinition> {
  const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });
  const commit = await langsmithClient.pullPromptCommit(LANGSMITH_SYSTEM_PROMPT_IDENTIFIER);
  const template = await load<prompts.ChatPromptTemplate>(JSON.stringify(commit.manifest), {
    importMap: { prompts },
  });

  const systemMessageTemplate = template.promptMessages[0];
  if (!("prompt" in systemMessageTemplate)) {
    throw new Error(
      "Pulled LangSmith prompt's first message isn't a template (got a literal BaseMessage) — " +
        "can't extract raw template text from it.",
    );
  }
  // biome-ignore lint/suspicious/noExplicitAny: .prompt.template/.templateFormat aren't in BaseMessagePromptTemplate's public type, only on its concrete PromptTemplate-backed subclasses (SystemMessagePromptTemplate etc.)
  const innerPrompt = (systemMessageTemplate as any).prompt;
  const rawTemplate: string = innerPrompt.template;
  const templateFormat: string = innerPrompt.templateFormat;
  if (templateFormat !== "f-string") {
    throw new Error(
      `Pulled LangSmith prompt uses templateFormat "${templateFormat}", not "f-string" — ` +
        `the {var} -> {{var}} conversion below assumes f-string.`,
    );
  }

  return {
    slug: "gca-system",
    name: "GCA System Prompt",
    description:
      "GCA's system prompt, migrated from LangSmith Prompt Hub's whatsapp-booking-agent:production commit.",
    model: "deepseek/deepseek-v4-pro",
    messages: [{ role: "system", content: fstringToMustache(rawTemplate, ["guest_memory_block"]) }],
  };
}

interface PushedPrompt {
  id: string;
  version: string;
}

async function pushPrompt(def: PromptDefinition): Promise<PushedPrompt> {
  const response = await fetch(BRAINTRUST_API_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${BRAINTRUST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project_id: BRAINTRUST_PROJECT_ID,
      name: def.name,
      slug: def.slug,
      description: def.description,
      prompt_data: {
        prompt: { type: "chat", messages: def.messages },
        options: { model: def.model },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Braintrust PUT /v1/prompt failed for slug "${def.slug}": ${response.status} ${await response.text()}`,
    );
  }
  const created = (await response.json()) as { id: string; _xact_id: string };
  return { id: created.id, version: created._xact_id };
}

async function main() {
  console.log(`Pushing "${SUMMARIZER_PROMPT.slug}"...`);
  const summarizer = await pushPrompt(SUMMARIZER_PROMPT);

  console.log(`Pulling system prompt from LangSmith (${LANGSMITH_SYSTEM_PROMPT_IDENTIFIER})...`);
  const systemPromptDef = await pullSystemPromptDefinition();
  console.log(`Pushing "${systemPromptDef.slug}"...`);
  const systemPrompt = await pushPrompt(systemPromptDef);

  console.log("\nDone. Paste these into run-turn.ts / memory.ts's version constants:\n");
  console.log(`  ${SUMMARIZER_PROMPT.slug}: id=${summarizer.id} version=${summarizer.version}`);
  console.log(`  ${systemPromptDef.slug}: id=${systemPrompt.id} version=${systemPrompt.version}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
