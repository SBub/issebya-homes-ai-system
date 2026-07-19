/**
 * Static seed vocabulary fed into every generation prompt alongside the
 * post-specific idea (see generate.ts) — keeps core discoverability terms
 * (location, accommodation category, personas) consistent across every post
 * instead of leaving them to per-call LLM invention/drift, while the model
 * still generates whatever long-tail keywords are specific to the given idea.
 *
 * Deliberately excludes amenities and event-space positioning for now — not
 * confirmed/wanted yet (see README or ask before adding).
 */
const SEED_VOCABULARY = {
  brand: {
    // Same handle on Instagram and TikTok, but self-mention (@issebya.homes)
    // only works on Instagram — TikTok doesn't support meaningfully
    // self-mentioning your own account in your own post.
    handle: "issebya.homes",
  },
  // At least one of these must appear explicitly in every caption — without
  // it, copy reads as a trails/nature account rather than bookable
  // accommodation, which is the actual discoverability risk this guards against.
  accommodationTerms: ["guest house", "rest space", "private rooms"],
  location: {
    village: "Almoçageme",
    regions: ["Sintra-Cascais Natural Park", "Sintra", "Lisbon coast"],
    distanceFacts: ["29 km from Lisbon Airport, no car needed"],
  },
  nearbyPOIs: {
    beaches: ["Praia da Adraga", "Praia Grande", "Praia das Maçãs", "Praia da Ursa"],
    trailsAndLandmarks: [
      "Cabo da Roca",
      "Convento dos Capuchos",
      "Pedra Amarela",
      "Sanctuary of Peninha",
    ],
  },
  rooms: {
    names: ["Room 1", "Room 2"],
    maxGuestsPerRoom: 2,
  },
  // Priority order matters: lead with the first persona unless the given
  // idea clearly calls for a different framing.
  personas: ["solo female travelers", "women looking to recharge and get away from urban life"],
} as const;

/** Renders the seed vocabulary into the text block embedded in every generation prompt. */
export function renderSeedContext(): string {
  const v = SEED_VOCABULARY;
  return [
    `Brand: ${v.brand.handle} — same handle on Instagram and TikTok. Only self-mention as ` +
      `@${v.brand.handle} on Instagram; never self-mention on TikTok (not functional there).`,
    `Accommodation-intent terms — at least one must appear explicitly in the caption every ` +
      `time, not just implied by describing scenery/activity: ${v.accommodationTerms.join(", ")}.`,
    `Location facts, must appear consistently: the village of ${v.location.village}, inside ` +
      `${v.location.regions.join(", ")}; ${v.location.distanceFacts.join("; ")}.`,
    `Nearby beaches: ${v.nearbyPOIs.beaches.join(", ")}.`,
    `Nearby trails/landmarks: ${v.nearbyPOIs.trailsAndLandmarks.join(", ")}.`,
    `Rooms: exactly ${v.rooms.names.join(" and ")}, max ${v.rooms.maxGuestsPerRoom} guests ` +
      "per room. Do not mention event space, group bookings, or celebrations — not positioned " +
      "for that yet, regardless of what the reference example below shows.",
    "Priority personas — lead with the first unless the given idea clearly calls for a " +
      `different framing: ${v.personas.join("; ")}.`,
  ].join("\n");
}
