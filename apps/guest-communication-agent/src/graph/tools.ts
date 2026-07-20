import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { sendTelegramNotification } from "@/lib/telegram";
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
}

function getConfigurable(config: RunnableConfig): ToolConfigurable {
  const configurable = config.configurable as Partial<ToolConfigurable> | undefined;
  if (!configurable?.conversationId || !configurable?.phone) {
    throw new Error(
      "Missing conversationId/phone in RunnableConfig.configurable — the agent node must pass {configurable: {conversationId, phone}} at invoke time.",
    );
  }
  return {
    conversationId: configurable.conversationId,
    phone: configurable.phone,
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

// The escalations DB insert is portable (createAdminClient). The Telegram
// notification is a scoped duplicate of the source's own
// apps/website/src/lib/telegram.ts — see ../lib/telegram.ts.
//
// Exported (rather than kept private inside the `tool()` closure below) so
// the agent node's own step-cap safety net (see nodes/agent.ts's
// MAX_AGENT_STEPS) can trigger the exact same real escalation — DB insert +
// Telegram notification — without duplicating this logic inline. The model
// never sees this function directly; only the `escalateToOwner` tool below
// is exposed to it.
export async function performEscalation(params: {
  conversationId: string;
  phone: string;
  reason: string;
}): Promise<void> {
  const { conversationId, phone, reason } = params;
  const supabase = createAdminClient();
  await supabase.from("escalations").insert({
    conversation_id: conversationId,
    phone_number: phone,
    reason,
  });
  const dashboardOrigin = process.env.CRM_DASHBOARD_ORIGIN ?? "http://localhost:3002";
  const dashboardUrl = `${dashboardOrigin}/?phone=${encodeURIComponent(phone)}`;
  await sendTelegramNotification(
    `Guest ${phone} needs you: ${reason}\n\nConversation: ${conversationId}\nView conversation: ${dashboardUrl}`,
  );
}

const escalateToOwner = tool(
  async ({ reason }: { reason: string }, config: RunnableConfig) => {
    const { conversationId, phone } = getConfigurable(config);
    await performEscalation({ conversationId, phone, reason });
    return {
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    };
  },
  {
    name: "escalateToOwner",
    description:
      "Alert the owner and hand off the conversation. Use when the guest is upset, asks for a human, has a complaint, or asks something you cannot answer.",
    schema: z.object({
      reason: z.string().describe("Brief description of why escalation is needed"),
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
