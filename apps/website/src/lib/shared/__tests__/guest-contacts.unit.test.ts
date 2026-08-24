import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

import { upsertGuestContact } from "@/lib/shared/guest-contacts";

const BASE_PARAMS = {
  phone: "+351920000001",
  email: "guest@example.com",
  guestName: "Guest Name",
  whatsappOptIn: true,
};

/**
 * Builds a chainable query-builder stub matching however much of the
 * Supabase JS surface guest-contacts.ts actually calls per query
 * (select/or/limit/maybeSingle for lookups, insert/update/select/eq/single
 * for writes). Each call site gets its own stub instance via `fromImpl`.
 */
function chain(terminal: () => unknown) {
  const node: Record<string, unknown> = {};
  const self = () => node;
  node.select = vi.fn(self);
  node.or = vi.fn(self);
  node.limit = vi.fn(self);
  node.eq = vi.fn(self);
  node.insert = vi.fn(self);
  node.update = vi.fn(self);
  node.maybeSingle = vi.fn(terminal);
  node.single = vi.fn(terminal);
  return node;
}

describe("upsertGuestContact", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("updates the existing row when found by email with a different/new phone (the crash scenario)", async () => {
    const existing = { id: "existing-id", phone: null, email: BASE_PARAMS.email };
    const lookupChain = chain(() => ({ data: existing, error: null }));
    const updateChain = chain(() => ({ data: { id: "existing-id" }, error: null }));
    mockFrom.mockReturnValueOnce(lookupChain).mockReturnValueOnce(updateChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("existing-id");
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ phone: BASE_PARAMS.phone, email: BASE_PARAMS.email }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", "existing-id");
    // Only a lookup + update — no insert attempted.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it("updates the existing row when found by phone with a different/new email", async () => {
    const existing = { id: "existing-id-2", phone: BASE_PARAMS.phone, email: null };
    const lookupChain = chain(() => ({ data: existing, error: null }));
    const updateChain = chain(() => ({ data: { id: "existing-id-2" }, error: null }));
    mockFrom.mockReturnValueOnce(lookupChain).mockReturnValueOnce(updateChain);

    const id = await upsertGuestContact({ ...BASE_PARAMS, email: "new-email@example.com" });

    expect(id).toBe("existing-id-2");
  });

  it("inserts a new row when no existing match is found", async () => {
    const lookupChain = chain(() => ({ data: null, error: null }));
    const insertChain = chain(() => ({ data: { id: "new-id" }, error: null }));
    mockFrom.mockReturnValueOnce(lookupChain).mockReturnValueOnce(insertChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("new-id");
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: BASE_PARAMS.phone, email: BASE_PARAMS.email }),
    );
  });

  it("falls back to lookup+update on a race-condition unique violation during insert", async () => {
    const lookupChain = chain(() => ({ data: null, error: null }));
    const insertChain = chain(() => ({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    }));
    const retryLookupChain = chain(() => ({ data: { id: "raced-id" }, error: null }));
    const retryUpdateChain = chain(() => ({ data: { id: "raced-id" }, error: null }));
    mockFrom
      .mockReturnValueOnce(lookupChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(retryLookupChain)
      .mockReturnValueOnce(retryUpdateChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("raced-id");
  });

  it("throws when insert fails for a reason other than a unique violation", async () => {
    const lookupChain = chain(() => ({ data: null, error: null }));
    const insertChain = chain(() => ({
      data: null,
      error: { code: "42501", message: "permission denied" },
    }));
    mockFrom.mockReturnValueOnce(lookupChain).mockReturnValueOnce(insertChain);

    await expect(upsertGuestContact(BASE_PARAMS)).rejects.toMatchObject({ code: "42501" });
  });
});
