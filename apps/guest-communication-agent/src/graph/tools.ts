import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { sendEscalationNudge } from "@/lib/telegram-router";
import { searchProperty } from "../tools/search-property";

// Ported from issebya-homes-website's apps/guest-communication-agent's own
// src/graph/tools.ts (import path updated: that repo's
// @issebya/shared/supabase -> this repo's @/lib/supabase). Originally
// ported there from apps/website/src/lib/whatsapp-agent/tools.ts. LangGraph
// tools are module-level (not created per-conversation like an AI-SDK
// version's createAgentTools(conversationId, phone) would be), so per-turn
// identifiers are threaded through the second `config: RunnableConfig`
// argument's `config.configurable`. LangGraph propagates whatever config the
// compiled graph is `.invoke()`d with to every node, including the prebuilt
// ToolNode that runs these — see nodes/agent.ts for how the agent node
// forwards that same config into its own model call.
interface ToolConfigurable {
  conversationId: string;
  phone: string;
  // The current turn's inbound whatsapp_messages.id (see
  // ../app/api/webhook/whatsapp/route.ts's own doc comment on why it's
  // captured before graph.invoke() is ever called). Optional here as a
  // defensive fallback only — every real caller of this graph (the webhook
  // route) always supplies it; this just avoids getConfigurable throwing for
  // some future/test caller that doesn't.
  triggerMessageId?: string;
}

// RunnableConfig.configurable is loosely typed (Record<string, unknown>), so
// the raw shape read off it allows a null triggerMessageId too (some
// upstream caller could plausibly write `null` rather than omitting the key)
// — normalized to `undefined` below so ToolConfigurable itself (and every
// caller destructuring getConfigurable's return) only ever has to deal with
// the single "optional string" shape @/graph/tools.ts's performEscalation
// param expects.
type RawToolConfigurable = Partial<Omit<ToolConfigurable, "triggerMessageId">> & {
  triggerMessageId?: string | null;
};

function getConfigurable(config: RunnableConfig): ToolConfigurable {
  const configurable = config.configurable as RawToolConfigurable | undefined;
  if (!configurable?.conversationId || !configurable?.phone) {
    throw new Error(
      "Missing conversationId/phone in RunnableConfig.configurable — the agent node must pass {configurable: {conversationId, phone}} at invoke time.",
    );
  }
  return {
    conversationId: configurable.conversationId,
    phone: configurable.phone,
    triggerMessageId: configurable.triggerMessageId ?? undefined,
  };
}

// Hardcoded until pricing is in DB. Flat rate, no seasonal distinction.
const NIGHTLY_PRICE_EUR = 75;

const getPricing = tool(
  async ({ room }: { room: "room1" | "room2" }) => {
    return {
      room,
      pricePerNight: NIGHTLY_PRICE_EUR,
      currency: "EUR",
      note: "Flat rate per night, does not include the tourist tax.",
    };
  },
  {
    name: "getPricing",
    description: "Get the nightly price for a room. Use when the guest asks about price or cost.",
    schema: z.object({
      room: z.enum(["room1", "room2"]).describe("Which room"),
    }),
  },
);

function datesOverlap(reqStart: Date, reqEnd: Date, bookedStart: Date, bookedEnd: Date): boolean {
  return reqStart < bookedEnd && reqEnd > bookedStart;
}

// Rather than duplicating apps/website's website-local iCal/availability
// parsing, this calls the live GET /api/availability?room= endpoint that
// route already exposes — it has its own 1-hour in-memory cache
// server-side. Name, description, and schema are kept identical to the
// original so model-facing behavior/tool-selection is unchanged.
const checkAvailability = tool(
  async ({
    room,
    checkIn,
    checkOut,
  }: {
    room: "room1" | "room2";
    checkIn: string;
    checkOut: string;
  }) => {
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
  },
  {
    name: "checkAvailability",
    description:
      "Check if a room is available for the requested dates. Use when the guest mentions specific check-in and check-out dates.",
    schema: z.object({
      room: z.enum(["room1", "room2"]).describe("Which room to check"),
      checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
      checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
    }),
  },
);

// TODO(agent-migration): this trusts the model already called
// checkAvailability first and got a real "available" result — it does not
// independently verify availability itself before creating the link. An
// experiment run showed the model can answer an availability question
// confidently without actually calling checkAvailability at all, so the same
// gap could plausibly let it call sendBookingLink for a room that's actually
// unavailable. Add a defensive re-check here (call the same
// GET /api/availability?room= endpoint checkAvailability uses) as a
// guardrail independent of whether the model behaved correctly upstream.
// If it comes back unavailable, return a structured, agent-consumable error
// — e.g. { error: 'not_available', room, checkIn, checkOut } rather than a
// generic failure string — so the model can tell the guest it's not
// available and suggest alternative dates, instead of surfacing a raw/vague
// error or (worse) silently sending a link for a room that's actually taken.
const sendBookingLink = tool(
  async (
    {
      guestName,
      room,
      checkIn,
      checkOut,
    }: {
      guestName: string;
      room: "room1" | "room2";
      checkIn: string;
      checkOut: string;
    },
    config: RunnableConfig,
  ) => {
    const { conversationId, phone } = getConfigurable(config);
    const supabase = createAdminClient();
    await supabase.from("booking_link_requests").insert({
      conversation_id: conversationId,
      phone_number: phone,
      guest_name: guestName,
      room,
      check_in: checkIn,
      check_out: checkOut,
    });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
    const url = `${siteUrl}/booking?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`;
    return { url };
  },
  {
    name: "sendBookingLink",
    description:
      "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name first if not known.",
    schema: z.object({
      guestName: z.string().describe("Guest full name"),
      room: z.enum(["room1", "room2"]).describe("Room they want to book"),
      checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
      checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
    }),
  },
);

// Calls searchProperty from ../tools/search-property.ts — see that file's
// header comment for its own provenance and the two deliberate differences
// from its pre-extraction original. No RunnableConfig/conversationId needed
// here since that extraction dropped the chat_logs logging that used to
// consume it.
const answerPropertyQuestionSchema = z.object({
  query: z.string().describe("The search query based on what the guest is asking"),
});

const answerPropertyQuestion = tool(
  async (args: z.infer<typeof answerPropertyQuestionSchema>) => {
    return searchProperty(args.query);
  },
  {
    name: "answerPropertyQuestion",
    description:
      "Search the property knowledge base for information about rooms, pricing, check-in, location, house rules, local recommendations, and more.",
    schema: answerPropertyQuestionSchema,
  },
);

// Structured classification of *why* an escalation happened, alongside the
// existing free-text `reason` string — see
// supabase/migrations/20260725100000_add_reason_category_to_escalations.sql
// for the full rationale. Kept as its own named schema (rather than inlined
// into escalateToOwner's schema object below) so the same enum/type can be
// reused by nodes/agent.ts's own deterministic performEscalation call sites
// (the step-cap and empty-reply safety nets), which never go through this
// tool's schema validation at all.
const escalationReasonCategorySchema = z.enum(["wants_human", "complaint", "missing_info"]);
export type EscalationReasonCategory = z.infer<typeof escalationReasonCategorySchema>;

// The escalations DB insert and the owner notification are now unified
// across all three categories — all three insert the row, select its id
// back, and push a nudge through apps/telegram-router's
// POST /api/escalation-nudges (see ../lib/telegram-router.ts's
// sendEscalationNudge). This replaces the prior two-branch shape where only
// missing_info went through telegram-router and the other categories
// bypassed it entirely with a raw fetch straight to the Telegram Bot API
// (../lib/telegram.ts's sendTelegramNotification, now deleted) — a
// long-flagged inconsistency with the rest of this repo's "one app owns all
// Telegram I/O" pattern. (A fourth category, unhappy_guest, existed at the
// time this was unified but was removed 2026-07-26 — general guest
// unhappiness is now handled by the agent's own conversational judgment via
// the system prompt, not a recorded escalation.)
//
// missing_info is still the one category with a human-in-the-loop
// resolution path: the owner can reply to the nudge with the actual answer,
// which then (a) reaches the guest over GCA/Twilio and (b) gets embedded
// into the property knowledge base — see
// POST /api/escalations/by-telegram-message-id/[id] and
// POST /api/escalations/[id]/resolve, plus apps/telegram-router's
// POST /api/escalation-nudges and its webhook's reply-to-nudge branch. That
// round trip needs a real correlation id (Telegram's own
// reply_to_message.message_id), which only exists once the nudge has
// actually been sent — hence `.select("id").single()` and storing
// telegram_message_id below for every category now, not just missing_info
// (the webhook's handleEscalationReply guards on reason_category itself so
// a reply to a non-missing_info nudge can't be mistakenly treated as an
// answer to relay/resolve — see that function's own doc comment).
//
// wants_human/complaint, by contrast, are auto-resolved the moment they're
// created (resolved_at set below, at insert time) — there is no further
// owner action to wait for. The system prompt now already handles the
// guest-facing side of both categories on its own (acknowledge the specific
// issue, don't promise a remedy, tell the guest it's flagged for the
// owner), so this no longer needs the "owner replies on Telegram to
// manually close it out" flow that was originally planned. The nudge is
// still sent — the owner still needs to know — but nothing downstream is
// waiting on a reply to it. `answer` stays null for these rows: there's no
// owner-contributed text to store, only `resolved_at`.
//
// Exported (rather than kept private inside the `tool()` closure below) so
// the agent node's own step-cap/empty-reply safety nets (see nodes/agent.ts's
// MAX_AGENT_STEPS) can trigger the exact same real escalation — including
// the nudge round trip — without duplicating this logic inline. The model
// never sees this function directly; only the `escalateToOwner` tool below
// is exposed to it.
export async function performEscalation(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: EscalationReasonCategory;
  // The guest's real original message id (whatsapp_messages.id) that
  // triggered this escalation — distinct from `reason`, which is the
  // model's own paraphrase of the question, not the guest's literal words.
  // Optional: only ever supplied by the real webhook-driven call path (see
  // getConfigurable above); some future/test caller may omit it, in which
  // case trigger_message_id is left null on the escalations row rather than
  // forcing a fabricated reference.
  triggerMessageId?: string;
}): Promise<void> {
  const { conversationId, phone, reason, reasonCategory, triggerMessageId } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("escalations")
    .insert({
      conversation_id: conversationId,
      phone_number: phone,
      reason,
      reason_category: reasonCategory,
      ...(triggerMessageId ? { trigger_message_id: triggerMessageId } : {}),
      ...(reasonCategory !== "missing_info" ? { resolved_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[escalations] insert failed, skipping owner nudge:", error?.message);
    return;
  }

  const nudgeResult = await sendEscalationNudge({
    escalationId: data.id,
    phone,
    reason,
    reasonCategory,
    conversationId,
  });
  if (!nudgeResult.ok) {
    console.error("[escalations] telegram-router nudge failed:", nudgeResult.error);
    return;
  }

  // telegramMessageId can be missing even on a nominally-ok result (e.g.
  // telegram-router itself isn't configured — see sendMessage's own
  // token/chatId no-op in apps/telegram-router/src/lib/telegram/telegram.ts)
  // — nothing to correlate a reply against in that case, so leave
  // telegram_message_id null rather than writing a meaningless value.
  if (nudgeResult.telegramMessageId != null) {
    await supabase
      .from("escalations")
      .update({ telegram_message_id: nudgeResult.telegramMessageId })
      .eq("id", data.id);
  }
}

const escalateToOwner = tool(
  async (
    { reason, reason_category }: { reason: string; reason_category: EscalationReasonCategory },
    config: RunnableConfig,
  ) => {
    const { conversationId, phone, triggerMessageId } = getConfigurable(config);
    await performEscalation({
      conversationId,
      phone,
      reason,
      reasonCategory: reason_category,
      triggerMessageId,
    });
    return {
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    };
  },
  {
    name: "escalateToOwner",
    description:
      "Alert the owner and hand off the conversation. Use when the guest asks for a human, has a complaint, or asks something you cannot answer. Always classify which of those three this is via reason_category.",
    schema: z.object({
      reason: z.string().describe("Brief description of why escalation is needed"),
      reason_category: escalationReasonCategorySchema.describe(
        "Which kind of escalation this is — missing_info specifically means you couldn't find an answer to the guest's question in the property knowledge base (answerPropertyQuestion came back empty/insufficient); use wants_human/complaint for everything else.",
      ),
    }),
  },
);

export const agentTools = [
  checkAvailability,
  getPricing,
  sendBookingLink,
  answerPropertyQuestion,
  escalateToOwner,
];
