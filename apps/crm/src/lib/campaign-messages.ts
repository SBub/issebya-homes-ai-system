export type CampaignKind = "seasonal_nudge" | "stalled_link_nudge";

/**
 * Finalized copy (user-confirmed, verbatim) for the two automated
 * follow-up campaigns POST /api/cron/check-stalled-guests drafts. Do NOT
 * reword — including seasonal_nudge's literal
 * "[fill in what's happening locally this season]" placeholder: shipping
 * with an honest generic placeholder (to be hand-edited later with real
 * seasonal copy) was a deliberate choice over guessing at real seasonal
 * content now.
 */
export const CAMPAIGN_MESSAGES: Record<CampaignKind, string> = {
  seasonal_nudge:
    "Hi! Just checking in — no rush at all. [fill in what's happening locally this season]. Happy to help with availability or pricing whenever you're ready!",
  stalled_link_nudge:
    "Hi! Just following up on the booking link I sent over — still interested in those dates? Happy to answer any questions, or help if anything's changed.",
};
