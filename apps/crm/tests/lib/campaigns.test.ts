import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// postCampaignDraft is the one real side effect draftForCampaign/
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
  draftForCampaign,
  getCampaignById,
  getCampaignCandidates,
  getRecurringEnabledCampaigns,
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
  for (const method of ["select", "eq", "order", "limit", "not", "lt", "gte", "in", "insert"]) {
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
    gte: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

// The two real seeded campaigns
// (supabase/migrations/20260724110000_campaigns_data_driven_targeting.sql),
// as getRecurringEnabledCampaigns/getCampaignById would return them — used
// throughout below instead of re-deriving one-off row literals per test.
const SEASONAL_CAMPAIGN = {
  id: "campaign-seasonal",
  name: "Seasonal check-in (automated)",
  kind: "seasonal_nudge",
  target_funnel_stage: "new",
  min_idle_days: 3,
  target_stay_before: null,
  min_total_stays: null,
  discount_percent: null,
  offer_description: "",
  message_template:
    "Hi! Just checking in — no rush at all. [fill in what's happening locally this season]. Happy to help with availability or pricing whenever you're ready!",
  is_recurring: true,
  enabled: true,
  created_at: "2026-07-01T00:00:00Z",
};

const STALLED_CAMPAIGN = {
  id: "campaign-stalled",
  name: "Stalled booking-link follow-up (automated)",
  kind: "stalled_link_nudge",
  target_funnel_stage: "link_sent",
  min_idle_days: 5,
  target_stay_before: null,
  min_total_stays: null,
  discount_percent: null,
  offer_description: "",
  message_template:
    "Hi! Just following up on the booking link I sent over — still interested in those dates? Happy to answer any questions, or help if anything's changed.",
  is_recurring: true,
  enabled: true,
  created_at: "2026-07-02T00:00:00Z",
};

describe("getRecurringEnabledCampaigns", () => {
  it("selects campaigns filtered to is_recurring=true and enabled=true", async () => {
    const chain = makeChain({ data: [SEASONAL_CAMPAIGN, STALLED_CAMPAIGN], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const campaigns = await getRecurringEnabledCampaigns(supabase);

    expect(campaigns).toEqual([SEASONAL_CAMPAIGN, STALLED_CAMPAIGN]);
    expect(fromMock).toHaveBeenCalledWith("campaigns");
    expect(chain.eq).toHaveBeenCalledWith("is_recurring", true);
    expect(chain.eq).toHaveBeenCalledWith("enabled", true);
  });

  it("throws when the query errors", async () => {
    const chain = makeChain({ data: null, error: { message: "boom" } });
    const supabase = { from: vi.fn(() => chain) } as never;

    await expect(getRecurringEnabledCampaigns(supabase)).rejects.toThrow("boom");
  });
});

describe("getCampaignById", () => {
  it("returns the matching campaign row", async () => {
    const chain = makeChain({ data: SEASONAL_CAMPAIGN, error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const campaign = await getCampaignById(supabase, "campaign-seasonal");

    expect(campaign).toEqual(SEASONAL_CAMPAIGN);
    expect(chain.eq).toHaveBeenCalledWith("id", "campaign-seasonal");
  });

  it("returns null when no row matches", async () => {
    const chain = makeChain({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as never;

    const campaign = await getCampaignById(supabase, "missing-id");

    expect(campaign).toBeNull();
  });

  it("throws when the query errors", async () => {
    const chain = makeChain({ data: null, error: { message: "boom" } });
    const supabase = { from: vi.fn(() => chain) } as never;

    await expect(getCampaignById(supabase, "campaign-seasonal")).rejects.toThrow("boom");
  });
});

describe("getCampaignCandidates", () => {
  it("filters by target_funnel_stage and min_idle_days for the seasonal_nudge campaign shape", async () => {
    const chain = makeChain({ data: [{ id: "guest-1", phone: "+351920742845" }], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const candidates = await getCampaignCandidates(supabase, SEASONAL_CAMPAIGN);

    expect(candidates).toEqual([{ id: "guest-1", phone: "+351920742845" }]);
    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(chain.eq).toHaveBeenCalledWith("enabled", true);
    expect(chain.eq).toHaveBeenCalledWith("funnel_stage", "new");
    expect(chain.lt).toHaveBeenCalledWith("last_interaction_at", expect.any(String));
  });

  it("filters by target_funnel_stage and min_idle_days for the stalled_link_nudge campaign shape", async () => {
    const chain = makeChain({ data: [{ id: "guest-2", phone: "+351920000000" }], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;

    const candidates = await getCampaignCandidates(supabase, STALLED_CAMPAIGN);

    expect(candidates).toEqual([{ id: "guest-2", phone: "+351920000000" }]);
    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(chain.eq).toHaveBeenCalledWith("funnel_stage", "link_sent");
    expect(chain.lt).toHaveBeenCalledWith("last_interaction_at", expect.any(String));
  });

  it("applies target_stay_before as a last_stay_checkout filter when set (future win-back-style campaign)", async () => {
    const chain = makeChain({ data: [], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;
    const winbackLikeCampaign = {
      ...SEASONAL_CAMPAIGN,
      target_funnel_stage: null,
      min_idle_days: null,
      target_stay_before: "2026-01-01",
    };

    await getCampaignCandidates(supabase, winbackLikeCampaign);

    // enabled=true is always applied, but no per-campaign targeting eq()
    // fires here since target_funnel_stage is null for this campaign shape.
    expect(chain.eq).toHaveBeenCalledExactlyOnceWith("enabled", true);
    expect(chain.lt).toHaveBeenCalledWith("last_stay_checkout", "2026-01-01");
    expect(chain.gte).not.toHaveBeenCalled();
  });

  it("applies min_total_stays as a total_stays >= filter when set (future winter-program-style campaign targeting every guest with a completed booking)", async () => {
    const chain = makeChain({ data: [], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;
    const everyPastGuestCampaign = {
      ...SEASONAL_CAMPAIGN,
      target_funnel_stage: null,
      min_idle_days: null,
      min_total_stays: 1,
    };

    await getCampaignCandidates(supabase, everyPastGuestCampaign);

    // enabled=true is always applied, but no per-campaign targeting eq()
    // fires here since target_funnel_stage is null for this campaign shape.
    expect(chain.eq).toHaveBeenCalledExactlyOnceWith("enabled", true);
    expect(chain.lt).not.toHaveBeenCalled();
    expect(chain.gte).toHaveBeenCalledWith("total_stays", 1);
  });

  it("applies no per-campaign targeting filters (beyond the always-on enabled=true) when every targeting column is null", async () => {
    const chain = makeChain({ data: [], error: null });
    const fromMock = vi.fn(() => chain);
    const supabase = { from: fromMock } as never;
    const untargetedCampaign = {
      ...SEASONAL_CAMPAIGN,
      target_funnel_stage: null,
      min_idle_days: null,
      target_stay_before: null,
      min_total_stays: null,
    };

    await getCampaignCandidates(supabase, untargetedCampaign);

    expect(chain.eq).toHaveBeenCalledExactlyOnceWith("enabled", true);
    expect(chain.lt).not.toHaveBeenCalled();
    expect(chain.gte).not.toHaveBeenCalled();
  });

  it("throws when the query errors", async () => {
    const chain = makeChain({ data: null, error: { message: "db down" } });
    const supabase = { from: vi.fn(() => chain) } as never;

    await expect(getCampaignCandidates(supabase, SEASONAL_CAMPAIGN)).rejects.toThrow("db down");
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

describe("draftForCampaign", () => {
  beforeEach(() => {
    postCampaignDraftMock.mockReset();
    postCampaignDraftMock.mockResolvedValue({ ok: true });
  });

  /**
   * Builds a fromMock that answers each table's queries in the exact
   * sequence draftForCampaign actually issues them: the candidate select,
   * a dedup select, then one insert per non-deduped candidate.
   */
  function makeSupabase(options: {
    candidates: Array<{ id: string; phone: string | null; guest_name?: string | null }>;
    alreadyNudged?: string[];
  }) {
    const fromMock = vi.fn();
    const insertChains: Record<string, ReturnType<typeof makeChain>> = {};
    fromMock
      .mockReturnValueOnce(makeChain({ data: options.candidates, error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: (options.alreadyNudged ?? []).map((id) => ({ guest_contact_id: id })),
          error: null,
        }),
      );
    for (const candidate of options.candidates) {
      if (!(options.alreadyNudged ?? []).includes(candidate.id)) {
        const chain = makeChain({ data: { id: `promo-${candidate.id}` }, error: null });
        insertChains[candidate.id] = chain;
        fromMock.mockReturnValueOnce(chain);
      }
    }
    return { supabase: { from: fromMock } as never, insertChains };
  }

  it("drafts a promo code for every true candidate", async () => {
    const { supabase } = makeSupabase({
      candidates: [
        { id: "guest-2", phone: "+351900000002" },
        { id: "guest-3", phone: "+351900000003" },
      ],
    });

    const result = await draftForCampaign(supabase, STALLED_CAMPAIGN);

    expect(result).toEqual({ drafted: 2, skipped: 0 });
    expect(postCampaignDraftMock).toHaveBeenCalledTimes(2);
  });

  it("skips a candidate already nudged for that campaign (dedup guard) and doesn't insert or draft for them", async () => {
    const { supabase } = makeSupabase({
      candidates: [
        { id: "guest-1", phone: "+351900000001" },
        { id: "guest-4", phone: "+351900000004" },
      ],
      alreadyNudged: ["guest-4"],
    });

    const result = await draftForCampaign(supabase, SEASONAL_CAMPAIGN);

    expect(result).toEqual({ drafted: 1, skipped: 1 });
    expect(postCampaignDraftMock).toHaveBeenCalledTimes(1);
    expect(postCampaignDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ guestPhone: "+351900000001", campaignKind: "seasonal_nudge" }),
    );
  });

  it("generates a real, unique-looking hex code and renders message_template for each drafted candidate", async () => {
    const { supabase, insertChains } = makeSupabase({
      candidates: [{ id: "guest-1", phone: "+351900000001", guest_name: "Marion" }],
    });

    await draftForCampaign(supabase, SEASONAL_CAMPAIGN);

    const insertCall = insertChains["guest-1"].insert.mock.calls[0][0];
    // crypto.randomBytes(6).toString("hex").toUpperCase() -> 12 uppercase hex chars.
    expect(insertCall.code).toMatch(/^[0-9A-F]{12}$/);
    expect(insertCall).toEqual(
      expect.objectContaining({
        campaign_id: "campaign-seasonal",
        guest_contact_id: "guest-1",
        message_text: SEASONAL_CAMPAIGN.message_template,
      }),
    );

    const [draftArg] = postCampaignDraftMock.mock.calls[0];
    expect(draftArg.promoCodeId).toBe("promo-guest-1");
  });

  it("does not fail the whole run when postCampaignDraft fails for one candidate", async () => {
    postCampaignDraftMock.mockResolvedValueOnce({
      ok: false,
      error: "telegram-router unreachable",
    });
    const { supabase } = makeSupabase({
      candidates: [{ id: "guest-1", phone: "+351900000001" }],
    });

    const result = await draftForCampaign(supabase, SEASONAL_CAMPAIGN);

    // The promo_codes row is still counted as drafted — postCampaignDraft
    // failing is a logged warning, not a rollback (see campaigns.ts's
    // draftForCampaign doc comment).
    expect(result.drafted).toBe(1);
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
   * sequence runCheckStalledGuests actually issues them: the
   * getRecurringEnabledCampaigns select, then per campaign a candidate
   * select, a dedup select, and one insert per non-deduped candidate.
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
      // getRecurringEnabledCampaigns
      .mockReturnValueOnce(makeChain({ data: [SEASONAL_CAMPAIGN, STALLED_CAMPAIGN], error: null }))
      // draftForCampaign(seasonal) -> getCampaignCandidates
      .mockReturnValueOnce(makeChain({ data: options.seasonalCandidates, error: null }))
      // draftForCampaign(seasonal) -> alreadyNudgedGuestIds
      .mockReturnValueOnce(
        makeChain({
          data: (options.seasonalAlreadyNudged ?? []).map((id) => ({ guest_contact_id: id })),
          error: null,
        }),
      );
    for (const candidate of options.seasonalCandidates) {
      if (!(options.seasonalAlreadyNudged ?? []).includes(candidate.id)) {
        const chain = makeChain({ data: { id: `promo-${candidate.id}` }, error: null });
        insertChains[candidate.id] = chain;
        fromMock.mockReturnValueOnce(chain);
      }
    }
    // draftForCampaign(stalled) -> getCampaignCandidates
    fromMock.mockReturnValueOnce(makeChain({ data: options.stalledCandidates, error: null }));
    // draftForCampaign(stalled) -> alreadyNudgedGuestIds
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

  it("drafts a promo code for every true candidate across both recurring+enabled campaigns", async () => {
    const { supabase } = makeSupabase({
      seasonalCandidates: [{ id: "guest-1", phone: "+351900000001" }],
      stalledCandidates: [
        { id: "guest-2", phone: "+351900000002" },
        { id: "guest-3", phone: "+351900000003" },
      ],
    });

    const summary = await runCheckStalledGuests(supabase);

    expect(summary).toEqual({
      results: [
        { campaign_id: "campaign-seasonal", kind: "seasonal_nudge", drafted: 1, skipped: 0 },
        { campaign_id: "campaign-stalled", kind: "stalled_link_nudge", drafted: 2, skipped: 0 },
      ],
      total_drafted: 3,
      total_skipped_already_nudged: 0,
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
      results: [
        { campaign_id: "campaign-seasonal", kind: "seasonal_nudge", drafted: 1, skipped: 1 },
        { campaign_id: "campaign-stalled", kind: "stalled_link_nudge", drafted: 0, skipped: 0 },
      ],
      total_drafted: 1,
      total_skipped_already_nudged: 1,
    });
    // Only the non-deduped candidate's promo code was drafted.
    expect(postCampaignDraftMock).toHaveBeenCalledTimes(1);
    expect(postCampaignDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ guestPhone: "+351900000001" }),
    );
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
    // draftForCampaign doc comment).
    expect(summary.total_drafted).toBe(1);
  });
});
