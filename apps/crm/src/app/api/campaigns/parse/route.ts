import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

// CRM's first LLM integration — deliberately NOT LangChain/any agent SDK
// (that machinery lives in apps/guest-communication-agent's
// src/agent/run-turn.ts because GCA needs a full multi-turn tool-calling
// agent loop with a live-pulled system prompt). This is a single one-shot
// "extract structured JSON from free text" call, so a plain fetch against OpenRouter's
// OpenAI-compatible /chat/completions endpoint is all it needs — same
// "plain fetch over SDK" convention as src/lib/telegram-router-client.ts and
// apps/guest-communication-agent's src/lib/twilio-send.ts. Same model as
// GCA's agent (deepseek/deepseek-v4-pro), for consistency across the repo,
// though this call is a single non-streaming completion, not a bound-tools
// conversational turn.
const MODEL = "deepseek/deepseek-v4-pro";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Mirrors lib/campaigns.ts's own Campaign interface doc comment — the
// authoritative description of what each field means — rather than
// reinventing the explanation here. Kept in sync by hand; if that doc
// comment changes, update this prompt to match.
const SYSTEM_PROMPT = `You are a campaign-drafting assistant for a short-term rental's guest CRM.

Given a free-text description of a marketing campaign idea, extract a single JSON object describing a "campaigns" row. Only include a field if the description actually gives a basis for it — do not invent targeting criteria or offer details the description doesn't support. name, kind, and message_template are the exception: always include them, since a campaign can't be created without them; if the description doesn't suggest a clear name or kind, invent a short, sensible one.

Fields you may extract:
- name (string, required): A short, human-readable name for the campaign.
- kind (string, required): A free-text descriptive label for grouping/display only — not a fixed enum. Invent a short snake_case-style label if the description doesn't suggest one (e.g. "win_back_discount").
- is_recurring (boolean, optional): true if this should run as an ongoing automation, re-evaluated on every scheduled run against whichever guests currently match (e.g. "whenever a guest goes quiet for 2 weeks"); false (or omit) for a one-off blast against guests who match right now (e.g. "guests who stayed before June").
- target_funnel_stage (string, optional): The guest's WhatsApp-conversation funnel stage to target — one of "new", "informed", "link_sent", "booked". Only include if the description clearly references this.
- min_idle_days (number, optional): Target guests who haven't interacted in at least this many days.
- target_stay_before (string, optional, "YYYY-MM-DD"): Target guests whose last stay checked out before this date. Only include if the description gives an actual date or a clearly resolvable one (e.g. "before June" in a description dated this year); never invent a date the description doesn't support.
- min_total_stays (number, optional): Target guests with at least this many completed stays (use 1 for "anyone who's ever stayed with us" / "past guests" style descriptions with no funnel-stage angle).
- discount_percent (number, optional): A percentage discount, if the description specifies one.
- offer_description (string, optional): Free-text description of the offer, for anything that isn't a plain percentage discount (e.g. a flat-price package). Do not duplicate discount_percent here.
- message_template (string, required): The WhatsApp message text to send. It may reference the guest's name, a promo code, the discount percentage, and the offer description using exactly these placeholder tokens: {{guest_name}}, {{promo_code}}, {{discount_percent}}, {{offer_description}}. For any other concrete detail the message should contain but the description does not actually specify (an exact price, a specific date, precise wording of an offer) — do NOT invent a plausible-sounding fake value. Instead insert an explicit hand-fill placeholder in square brackets, e.g. "[fill in exact price]" or "[fill in exact date]", the same convention this CRM's own seeded campaigns use for undecided details.

Respond with a JSON object containing only these fields (whichever apply) and nothing else — no explanation, no markdown, just the JSON object.`;

interface OpenRouterChatResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Calls OpenRouter's chat completions endpoint with the campaign-extraction
 * system prompt above, requesting a JSON-only response (response_format:
 * json_object — supported by OpenRouter/this model, same as any other
 * OpenAI-compatible provider). Returns the raw parsed JSON object the model
 * produced, un-validated — callers must validate/type-check every field
 * themselves before trusting it (see validateCampaignDraft below), same as
 * any other untrusted external input.
 *
 * Never throws on an OpenRouter API failure or a malformed/non-JSON
 * response — returns `{ ok: false, error }` instead, so the route handler
 * can respond with a clean 502 rather than an unhandled exception (mirrors
 * twilio-send.ts's sendWhatsAppMessage contract exactly).
 */
async function parseCampaignFromDescription(
  description: string,
  apiKey: string,
): Promise<{ ok: true; draft: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: description },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `OpenRouter request failed (${res.status}): ${text}` };
    }

    const body = (await res.json()) as OpenRouterChatResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      return { ok: false, error: "OpenRouter returned an empty response" };
    }

    let draft: unknown;
    try {
      draft = JSON.parse(content);
    } catch {
      return { ok: false, error: "OpenRouter returned a non-JSON response" };
    }

    return { ok: true, draft };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Validates + type-checks the model's raw draft object against exactly the
 * same rules POST /api/campaigns itself enforces (see that route's own doc
 * comment), so whatever this returns is guaranteed to be accepted by
 * POST /api/campaigns unchanged. Two differences from that route's own
 * validation, both deliberate given the input is LLM output rather than a
 * deliberate caller:
 *   - A missing/empty required field (name/kind/message_template) fails the
 *     whole draft (returns null) rather than 400ing on just that field —
 *     the route handler turns that into a single clear 502.
 *   - A wrong-typed OPTIONAL field is silently dropped, not treated as an
 *     error — one bad optional field (e.g. the model returning
 *     min_idle_days as a string) shouldn't sink an otherwise-usable draft.
 */
function validateCampaignDraft(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const body = raw as Record<string, unknown>;

  const name = body.name;
  if (typeof name !== "string" || name.trim() === "") {
    return null;
  }

  const kind = body.kind;
  if (typeof kind !== "string" || kind.trim() === "") {
    return null;
  }

  const messageTemplate = body.message_template;
  if (typeof messageTemplate !== "string" || messageTemplate.trim() === "") {
    return null;
  }

  const draft: Record<string, unknown> = { name, kind, message_template: messageTemplate };

  for (const field of ["target_funnel_stage", "offer_description"] as const) {
    const value = body[field];
    if (typeof value === "string") {
      draft[field] = value;
    }
  }

  for (const field of ["min_idle_days", "min_total_stays", "discount_percent"] as const) {
    const value = body[field];
    if (typeof value === "number" && !Number.isNaN(value)) {
      draft[field] = value;
    }
  }

  if (typeof body.target_stay_before === "string") {
    draft.target_stay_before = body.target_stay_before;
  }

  if (typeof body.is_recurring === "boolean") {
    draft.is_recurring = body.is_recurring;
  }

  return draft;
}

/**
 * NLP-assisted campaign drafting — takes a free-text description (e.g.
 * "Invite past guests who stayed before June, offer them 10% off to come
 * back") and returns a draft campaign object shaped exactly like
 * POST /api/campaigns' own accepted body, for apps/crm/src/app/page.tsx's
 * "+ New Campaign" dialog to prefill its form with. This never itself
 * creates a campaign — the returned draft is only a prefill; the user still
 * reviews/edits the form and clicks the existing "Create" button themselves
 * (same human-in-the-loop principle as the Telegram campaign-draft
 * approval flow), so there is no destructive side effect from calling this
 * endpoint.
 *
 * Request body: `{ description: string }` — 400 if missing or an empty
 * string.
 *
 * 502 (`{ error: "OpenRouter is not configured" }`) if OPENROUTER_API_KEY
 * isn't set, matching the existing "not configured" pattern used elsewhere
 * in this app for missing cross-service config (see
 * GET /api/guest-contacts/[id]/conversations's GUEST_COMMUNICATION_AGENT_
 * API_URL/_API_KEY check). 502 with the underlying error if the OpenRouter
 * call itself fails.
 *
 * 502 (`{ error: "Could not generate a usable campaign from that
 * description — try adding more detail." }`) if the model's response
 * doesn't satisfy POST /api/campaigns' own required-field rules (non-empty
 * name/kind/message_template) — this endpoint never passes through a draft
 * that POST /api/campaigns would itself reject.
 *
 * On success: 200 with the validated draft object (same field names/types
 * POST /api/campaigns accepts).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);

  const description = body?.description;
  if (typeof description !== "string" || description.trim() === "") {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[crm] OPENROUTER_API_KEY is not set");
    return NextResponse.json({ error: "OpenRouter is not configured" }, { status: 502 });
  }

  const result = await parseCampaignFromDescription(description, apiKey);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const draft = validateCampaignDraft(result.draft);
  if (!draft) {
    return NextResponse.json(
      {
        error:
          "Could not generate a usable campaign from that description — try adding more detail.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(draft, { status: 200 });
}
