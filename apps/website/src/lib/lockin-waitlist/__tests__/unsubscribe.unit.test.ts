import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  isLockinToken,
  newLockinToken,
  resolveLockinUnsubscribe,
  scrubLockinUnsubscribeToken,
  lockinUnsubscribeResultPath,
  lockinUnsubscribeUrl,
} from "../unsubscribe";
import { lockinWaitlistUpsert } from "../schema";

const TOKEN_A = "a".repeat(64);

type Row = {
  email: string;
  marketing_opt_in: boolean;
  unsubscribed_at: string | null;
  unsubscribe_token: string;
};

// A one-row stand-in for `lockin_waitlist`, supporting exactly the
// chains `resolveLockinUnsubscribe` uses. `forceEmptyUpdate` simulates a concurrent
// click that won the race between the read and the write.
function fakeStore(row: Row, options: { lookupError?: { code: string } } = {}) {
  const state = { row: { ...row }, forceEmptyUpdate: false };
  let lastUpdateChain: { is: ReturnType<typeof vi.fn> } | undefined;

  const update = vi.fn((values: Partial<Row>) => {
    const filters: { token?: string; nullUnsubscribed?: boolean } = {};
    const chain = {
      eq: (_column: string, value: string) => {
        filters.token = value;
        return chain;
      },
      is: vi.fn((_column: string, _value: null) => {
        filters.nullUnsubscribed = true;
        return chain;
      }),
      select: async () => {
        const matches =
          !state.forceEmptyUpdate &&
          state.row.unsubscribe_token === filters.token &&
          (!filters.nullUnsubscribed || state.row.unsubscribed_at === null);
        if (!matches) return { data: [], error: null };
        state.row = { ...state.row, ...values };
        return { data: [{ email: state.row.email }], error: null };
      },
    };
    lastUpdateChain = chain;
    return chain;
  });

  const from = vi.fn(() => ({
    select: () => ({
      eq: (_column: string, token: string) => ({
        maybeSingle: async () => {
          if (options.lookupError) return { data: null, error: options.lookupError };
          const found = state.row.unsubscribe_token === token;
          return {
            data: found
              ? {
                  marketing_opt_in: state.row.marketing_opt_in,
                  unsubscribed_at: state.row.unsubscribed_at,
                }
              : null,
            error: null,
          };
        },
      }),
    }),
    update,
  }));

  return {
    state,
    from,
    update,
    lastIs: () => lastUpdateChain?.is,
    client: { from } as unknown as SupabaseClient,
  };
}

const subscribed: Row = {
  email: "guest@example.com",
  marketing_opt_in: true,
  unsubscribed_at: null,
  unsubscribe_token: TOKEN_A,
};

describe("isLockinToken / newLockinToken", () => {
  it("generates distinct tokens of the accepted shape", () => {
    const first = newLockinToken();
    const second = newLockinToken();
    expect(isLockinToken(first)).toBe(true);
    expect(isLockinToken(second)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe("lockinUnsubscribeUrl / lockinUnsubscribeResultPath", () => {
  it("builds the link and token-free result paths", () => {
    expect(lockinUnsubscribeUrl(TOKEN_A)).toBe(
      `https://issebya.com/lockin-waitlist/unsubscribe?token=${TOKEN_A}`,
    );
    expect(lockinUnsubscribeResultPath("unsubscribed")).toBe("/lockin-waitlist/unsubscribe/done");
    expect(lockinUnsubscribeResultPath("already")).toBe("/lockin-waitlist/unsubscribe/already");
    expect(lockinUnsubscribeResultPath("invalid")).toBe("/lockin-waitlist/unsubscribe/invalid");
  });
});

describe("resolveLockinUnsubscribe", () => {
  it("unsubscribes a subscribed row once, filtered on unsubscribed_at is null", async () => {
    const store = fakeStore(subscribed);

    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("unsubscribed");

    expect(store.update).toHaveBeenCalledOnce();
    const values = store.update.mock.calls[0][0];
    expect(values.marketing_opt_in).toBe(false);
    expect(new Date(values.unsubscribed_at as string).toISOString()).toBe(values.unsubscribed_at);
    expect(store.lastIs()).toHaveBeenCalledWith("unsubscribed_at", null);
    expect(store.state.row.email).toBe("guest@example.com");
  });

  it("never deletes the row", async () => {
    const store = fakeStore(subscribed);
    const remove = vi.fn();
    const client = {
      from: () => ({ ...store.from(), delete: remove }),
    } as unknown as SupabaseClient;

    expect(await resolveLockinUnsubscribe(client, TOKEN_A)).toBe("unsubscribed");
    expect(await resolveLockinUnsubscribe(client, TOKEN_A)).toBe("already");
    expect(remove).not.toHaveBeenCalled();
  });

  it("answers an already-unsubscribed row without writing", async () => {
    const store = fakeStore({
      ...subscribed,
      marketing_opt_in: false,
      unsubscribed_at: "2026-09-20T10:00:00.000Z",
    });

    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("already");
    expect(store.update).not.toHaveBeenCalled();
  });

  it("answers the same link twice as unsubscribed, then already", async () => {
    const store = fakeStore(subscribed);

    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("unsubscribed");
    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("already");
    expect(store.update).toHaveBeenCalledOnce();
  });

  it("answers already when a concurrent click wrote first", async () => {
    const store = fakeStore(subscribed);
    store.state.forceEmptyUpdate = true;

    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("already");
  });

  it("answers invalid for a well-formed token nobody holds", async () => {
    const store = fakeStore(subscribed);

    expect(await resolveLockinUnsubscribe(store.client, "b".repeat(64))).toBe("invalid");
    expect(store.update).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["repeated", ["a", "b"]],
    ["not hex", "xyz"],
    ["63 chars", "a".repeat(63)],
    ["uppercase", "A".repeat(64)],
  ])("answers invalid for a %s token without a DB call", async (_label, token) => {
    const store = fakeStore(subscribed);

    expect(await resolveLockinUnsubscribe(store.client, token)).toBe("invalid");
    expect(store.from).not.toHaveBeenCalled();
  });

  it("throws on a lookup error without the token in the message", async () => {
    const store = fakeStore(subscribed, { lookupError: { code: "XX000" } });

    const error = await resolveLockinUnsubscribe(store.client, TOKEN_A).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("XX000");
    expect((error as Error).message).not.toContain(TOKEN_A);
  });

  it("kills an old email's link once the visitor consents again", async () => {
    const store = fakeStore(subscribed);

    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("unsubscribed");

    // The action's re-consent payload, applied to the stored row.
    const { row, reconsented } = lockinWaitlistUpsert(
      {
        email: store.state.row.email,
        name: undefined,
        lifeArea: undefined,
        duration: undefined,
        months: [],
        marketingOptIn: true,
        honeypot: "",
      },
      { name: null, life_area: null, duration: null, months: null, ...store.state.row },
      new Date().toISOString(),
      newLockinToken,
    );
    expect(reconsented).toBe(true);
    store.state.row = { ...store.state.row, ...(row as Partial<Row>) };
    const tokenB = store.state.row.unsubscribe_token;

    expect(await resolveLockinUnsubscribe(store.client, TOKEN_A)).toBe("invalid");
    expect(await resolveLockinUnsubscribe(store.client, tokenB)).toBe("unsubscribed");
  });
});

describe("scrubLockinUnsubscribeToken", () => {
  it("removes the token from the request URL and query", () => {
    const event = scrubLockinUnsubscribeToken({
      request: {
        url: `https://issebya.com/lockin-waitlist/unsubscribe?token=${TOKEN_A}`,
        query_string: `token=${TOKEN_A}`,
      },
    });

    expect(JSON.stringify(event)).not.toContain(TOKEN_A);
    expect(event.request.url).toBe(
      "https://issebya.com/lockin-waitlist/unsubscribe?token=[redacted]",
    );
  });

  it("removes the token from transaction span data", () => {
    const event = scrubLockinUnsubscribeToken({
      transaction: "GET /lockin-waitlist/unsubscribe",
      contexts: { trace: { data: { "url.query": `token=${TOKEN_A}` } } },
      spans: [
        {
          description: `GET /lockin-waitlist/unsubscribe?token=${TOKEN_A}`,
          data: { "http.target": `/lockin-waitlist/unsubscribe?token=${TOKEN_A}` },
        },
      ],
    });

    expect(JSON.stringify(event)).not.toContain(TOKEN_A);
  });

  it("removes the token from a parsed query object", () => {
    const event = scrubLockinUnsubscribeToken({
      request: {
        url: "https://issebya.com/lockin-waitlist/unsubscribe",
        query_string: { token: TOKEN_A },
      },
    });

    expect(JSON.stringify(event)).not.toContain(TOKEN_A);
  });

  it("leaves a wishlist unsubscribe event to the wishlist scrubber", () => {
    const original = {
      request: { url: `https://issebya.com/shop/wishlist/unsubscribe?token=${TOKEN_A}` },
    };
    const event = scrubLockinUnsubscribeToken(structuredClone(original));

    expect(event).toEqual(original);
  });

  it("leaves unrelated events untouched", () => {
    const original = {
      request: { url: "https://issebya.com/booking/confirmation?session=abc&token=keep" },
    };
    const event = scrubLockinUnsubscribeToken(structuredClone(original));

    expect(event).toEqual(original);
  });
});
