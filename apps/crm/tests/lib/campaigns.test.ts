import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// postCampaignDraft is the one real side effect draftForCandidates/
// runCheckStalledGuests reach for outside the Supabase client passed in —
// mock the module boundary, same "mock the module boundary, not the
// network" approach as this app's route tests (e.g.
// tests/api/promo-codes/get.test.ts), rather than mocking fetch here too.
const postCampaignDraftMock = vi.fn();
vi.mock("@/lib/telegram-router-client.js", () => ({
  postCampaignDraft: postCampaignDraftMock,
}));

const {
  alreadyNudgedGuestIds,
  findOrCreateCampaign,
  getSeasonalNudgeCandidates,
  getStalledLinkNudgeCandidates,
  runCheckStalledGuests,
} = await import("@/lib/campaigns.js");

/**
 * Minimal fake Supabase query-builder chain: every filter/modifier method
 * returns the same chain object (so any call order/combination works,
 * mirroring the real @supabase/supabase-js PostgrestFilterBuilder), and the
 * chain itself is thenable so `await supabase.from(...).select(...)...`
 * resolves to `result` even when the code never calls .maybeSingle()/
 * .single() (the plain-array-select case). Each method is a vi.fn() so
 * tests can assert on exact call args.
 */
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "not", "lt", "in", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.single = vi.fn(() => Promise.resolve(result));
  // Intentionally thenable — mirrors @supabase/supabase-js's own
  // PostgrestFilterBuilder, which is awaitable directly (no
  // .maybeSingle()/.single()) for plain multi-row selects; this mock chain
  // has to support that same direct-await shape.
  // biome-ignore lint/suspicious/noThenProperty: see comment above
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

describe("findOrCreateCampaign", () => {
  let fromMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromMock = vi.fn();
  });

  it("returns the existing campaign's id without inserting when one already exists", async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: { id: "campaign-1" }, error: null }));
    const supabase = { from: fromMock } as never;

    const id = await findOrCreateCampaign(supabase, "seasonal_nudge");

    expect(id).toBe("campaign-1");
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("campaigns");
  });

  it("creates a new campaign with the automated name when none exists", async () => {
    const selectChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: { id: "campaign-new" }, error: null });
    fromMock.mockReturnValueOnce(selectChain).mockReturnValueOnce(insertChain);
    const supabase = { from: fromMock } as never;

    const id = await findOrCreateCampaign(supabase, "stalled_link_nudge");

    expect(id).toBe("campaign-new");
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(insertChain.insert).toHaveBeenCalledWith({
      kind: "stalled_link_nudge",
      name: "Stalled booking-link follow-up (automated)",
    });
  });

  it("throws when the select errors", async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: null, error: { message: "boom" } }));
    const supabase = { from: fromMock } as never;

    await expect(findOrCreateCampaign(supabase, "seasonal_nudge")).rejects.toThrow("boom");
  });
});

describe("getSeasonalNudgeCandidates", () => {
  it("queries funnel_stage='new' with a non-null, >3-day-stale last_interaction_at", async () => {
    const chain = makeChain({ data: [{ id: "guest-1", phone: "+351920742845" }], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const candidates = await getSeasonalNudgeCandidates(supabase);

    expect(candidates).toEqual([{ id: "guest-1", phone: "+351920742845" }]);
    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(chain.eq).toHaveBeenCalledWith("funnel_stage", "new");
    expect(chain.not).toHaveBeenCalledWith("last_interaction_at", "is", null);
    expect(chain.lt).toHaveBeenCalledWith("last_interaction_at", expect.any(String));
  });

  it("throws when the query errors", async () => {
    const chain = makeChain({ data: null, error: { message: "db down" } });
    const supabase = { from: vi.fn(() => chain) } as never;

    await expect(getSeasonalNudgeCandidates(supabase)).rejects.toThrow("db down");
  });
});

describe("getStalledLinkNudgeCandidates", () => {
  it("queries funnel_stage='link_sent' with a >5-day-stale last_interaction_at", async () => {
    const chain = makeChain({ data: [{ id: "guest-2", phone: "+351920000000" }], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const candidates = await getStalledLinkNudgeCandidates(supabase);

    expect(candidates).toEqual([{ id: "guest-2", phone: "+351920000000" }]);
    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(chain.eq).toHaveBeenCalledWith("funnel_stage", "link_sent");
    expect(chain.lt).toHaveBeenCalledWith("last_interaction_at", expect.any(String));
  });
});

describe("alreadyNudgedGuestIds", () => {
  it("returns an empty set without querying when there are no candidate ids", async () => {
    const fromMock = vi.fn();
    const supabase = { from: fromMock } as never;

    const result = await alreadyNudgedGuestIds(supabase, "campaign-1", []);

    expect(result).toEqual(new Set());
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the set of guest_contact_ids that already have a promo_codes row for this campaign", async () => {
    const chain = makeChain({
      data: [{ guest_contact_id: "guest-1" }, { guest_contact_id: "guest-3" }],
      error: null,
    });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const result = await alreadyNudgedGuestIds(supabase, "campaign-1", [
      "guest-1",
      "guest-2",
      "guest-3",
    ]);

    expect(result).toEqual(new Set(["guest-1", "guest-3"]));
    expect(fromMock).toHaveBeenCalledWith("promo_codes");
    expect(chain.eq).toHaveBeenCalledWith("campaign_id", "campaign-1");
    expect(chain.in).toHaveBeenCalledWith("guest_contact_id", ["guest-1", "guest-2", "guest-3"]);
  });
});

describe("runCheckStalledGuests", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    postCampaignDraftMock.mockReset();
    postCampaignDraftMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /**
   * Builds a fromMock that answers each table's queries in the exact
   * sequence runCheckStalledGuests actually issues them: two
   * find-or-create campaign selects, the two candidate selects, then per
   * campaign a dedup select and one insert per non-deduped candidate.
   */
  function makeSupabase(options: {
    seasonalCandidates: Array<{ id: string; phone: string | null }>;
    stalledCandidates: Array<{ id: string; phone: string | null }>;
    seasonalAlreadyNudged?: string[];
    stalledAlreadyNudged?: string[];
  }) {
    const fromMock = vi.fn();
    const insertChains: Record<string, ReturnType<typeof makeChain>> = {};
    fromMock
      // findOrCreateCampaign("seasonal_nudge") — already exists
      .mockReturnValueOnce(makeChain({ data: { id: "campaign-seasonal" }, error: null }))
      // findOrCreateCampaign("stalled_link_nudge") — already exists
      .mockReturnValueOnce(makeChain({ data: { id: "campaign-stalled" }, error: null }))
      // getSeasonalNudgeCandidates
      .mockReturnValueOnce(makeChain({ data: options.seasonalCandidates, error: null }))
      // getStalledLinkNudgeCandidates
      .mockReturnValueOnce(makeChain({ data: options.stalledCandidates, error: null }))
      // draftForCandidates(seasonal) -> alreadyNudgedGuestIds
      .mockReturnValueOnce(
        makeChain({
          data: (options.seasonalAlreadyNudged ?? []).map((id) => ({ guest_contact_id: id })),
          error: null,
        }),
      );
    // draftForCandidates(seasonal) -> one insert per non-deduped candidate
    for (const candidate of options.seasonalCandidates) {
      if (!(options.seasonalAlreadyNudged ?? []).includes(candidate.id)) {
        const chain = makeChain({ data: { id: `promo-${candidate.id}` }, error: null });
        insertChains[candidate.id] = chain;
        fromMock.mockReturnValueOnce(chain);
      }
    }
    // draftForCandidates(stalled) -> alreadyNudgedGuestIds
    fromMock.mockReturnValueOnce(
      makeChain({
        data: (options.stalledAlreadyNudged ?? []).map((id) => ({ guest_contact_id: id })),
        error: null,
      }),
    );
    for (const candidate of options.stalledCandidates) {
      if (!(options.stalledAlreadyNudged ?? []).includes(candidate.id)) {
        const chain = makeChain({ data: { id: `promo-${candidate.id}` }, error: null });
        insertChains[candidate.id] = chain;
        fromMock.mockReturnValueOnce(chain);
      }
    }
    return { supabase: { from: fromMock } as never, insertChains };
  }

  it("drafts a promo code for every true candidate in both campaigns", async () => {
    const { supabase } = makeSupabase({
      seasonalCandidates: [{ id: "guest-1", phone: "+351900000001" }],
      stalledCandidates: [
        { id: "guest-2", phone: "+351900000002" },
        { id: "guest-3", phone: "+351900000003" },
      ],
    });

    const summary = await runCheckStalledGuests(supabase);

    expect(summary).toEqual({
      seasonal_nudge_drafted: 1,
      stalled_link_nudge_drafted: 2,
      skipped_already_nudged: 0,
    });
    expect(postCampaignDraftMock).toHaveBeenCalledTimes(3);
  });

  it("skips a candidate already nudged for that campaign (dedup guard) and doesn't insert or draft for them", async () => {
    const { supabase } = makeSupabase({
      seasonalCandidates: [
        { id: "guest-1", phone: "+351900000001" },
        { id: "guest-4", phone: "+351900000004" },
      ],
      stalledCandidates: [],
      seasonalAlreadyNudged: ["guest-4"],
    });

    const summary = await runCheckStalledGuests(supabase);

    expect(summary).toEqual({
      seasonal_nudge_drafted: 1,
      stalled_link_nudge_drafted: 0,
      skipped_already_nudged: 1,
    });
    // Only the non-deduped candidate's promo code was drafted.
    expect(postCampaignDraftMock).toHaveBeenCalledTimes(1);
    expect(postCampaignDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ guestPhone: "+351900000001" }),
    );
  });

  it("generates a real, unique-looking hex code for each drafted candidate", async () => {
    const { supabase, insertChains } = makeSupabase({
      seasonalCandidates: [{ id: "guest-1", phone: "+351900000001" }],
      stalledCandidates: [],
    });

    await runCheckStalledGuests(supabase);

    const insertCall = insertChains["guest-1"].insert.mock.calls[0][0];
    // crypto.randomBytes(6).toString("hex").toUpperCase() -> 12 uppercase hex chars.
    expect(insertCall.code).toMatch(/^[0-9A-F]{12}$/);
    expect(insertCall).toEqual(
      expect.objectContaining({
        campaign_id: "campaign-seasonal",
        guest_contact_id: "guest-1",
        message_text: expect.any(String),
      }),
    );

    const [draftArg] = postCampaignDraftMock.mock.calls[0];
    expect(draftArg.promoCodeId).toBe("promo-guest-1");
  });

  it("does not fail the whole cron response when postCampaignDraft fails for one candidate", async () => {
    postCampaignDraftMock.mockResolvedValueOnce({
      ok: false,
      error: "telegram-router unreachable",
    });
    const { supabase } = makeSupabase({
      seasonalCandidates: [{ id: "guest-1", phone: "+351900000001" }],
      stalledCandidates: [],
    });

    const summary = await runCheckStalledGuests(supabase);

    // The promo_codes row is still counted as drafted — postCampaignDraft
    // failing is a logged warning, not a rollback (see campaigns.ts's
    // draftForCandidates doc comment).
    expect(summary.seasonal_nudge_drafted).toBe(1);
  });
});
