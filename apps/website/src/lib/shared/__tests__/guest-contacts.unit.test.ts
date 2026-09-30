import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mockFrom = vi.fn();
const mockAddBreadcrumb = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

import { upsertGuestContact } from "@/lib/shared/guest-contacts";

const BASE_PARAMS = {
  phone: "+351920000001",
  email: "guest@example.com",
  guestName: "Guest Name",
  whatsappOptIn: true,
};

const UNIQUE_VIOLATION = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "guest_contacts_email_key"',
};

/**
 * Builds a chainable query-builder stub matching however much of the
 * Supabase JS surface guest-contacts.ts actually calls per query
 * (select/eq/maybeSingle for lookups, insert/update/select/eq/single for
 * writes). Each call site gets its own stub instance via `mockFrom`.
 */
function chain(terminal: () => unknown) {
  const node: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => node;
  node.select = vi.fn(self);
  node.eq = vi.fn(self);
  node.insert = vi.fn(self);
  node.update = vi.fn(self);
  node.maybeSingle = vi.fn(terminal);
  node.single = vi.fn(terminal);
  return node;
}

/** A lookup stub resolving to `row` (or no row). */
function lookup(row: { id: string } | null) {
  return chain(() => ({ data: row, error: null }));
}

/** A write stub resolving to `{ id }`, or to `error` when given. */
function writeResult(id: string | null, error: unknown = null) {
  return chain(() => ({ data: id ? { id } : null, error }));
}

/**
 * Queues the from() calls in order. Each resolution does the email lookup,
 * then the phone lookup, then one write.
 */
function queue(...chains: ReturnType<typeof chain>[]) {
  for (const c of chains) {
    mockFrom.mockReturnValueOnce(c);
  }
}

describe("upsertGuestContact", () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    mockFrom.mockReset();
    mockAddBreadcrumb.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("looks the contact up by exact email, then exact phone", async () => {
    const emailLookup = lookup(null);
    const phoneLookup = lookup(null);
    queue(emailLookup, phoneLookup, writeResult("new-id"));

    await upsertGuestContact(BASE_PARAMS);

    expect(emailLookup.eq).toHaveBeenCalledWith("email", BASE_PARAMS.email);
    expect(phoneLookup.eq).toHaveBeenCalledWith("phone", BASE_PARAMS.phone);
  });

  it("updates the existing row when found by email with a different/new phone", async () => {
    const updateChain = writeResult("existing-id");
    queue(lookup({ id: "existing-id" }), lookup(null), updateChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("existing-id");
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ phone: BASE_PARAMS.phone, email: BASE_PARAMS.email }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", "existing-id");
    expect(updateChain.insert).not.toHaveBeenCalled();
    // Two lookups + one update, no insert attempted.
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it("updates the existing row when found by phone with a different/new email", async () => {
    const updateChain = writeResult("existing-id-2");
    queue(lookup(null), lookup({ id: "existing-id-2" }), updateChain);

    const id = await upsertGuestContact({ ...BASE_PARAMS, email: "new-email@example.com" });

    expect(id).toBe("existing-id-2");
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new-email@example.com", phone: BASE_PARAMS.phone }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("fully updates the row when phone and email both match the same row", async () => {
    const updateChain = writeResult("same-row");
    queue(lookup({ id: "same-row" }), lookup({ id: "same-row" }), updateChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("same-row");
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ phone: BASE_PARAMS.phone, email: BASE_PARAMS.email }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it("links to the email row without writing phone when phone and email belong to two rows", async () => {
    const updateChain = writeResult("email-row");
    queue(lookup({ id: "email-row" }), lookup({ id: "phone-row" }), updateChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("email-row");
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    const payload = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("phone");
    expect(payload).toMatchObject({
      email: BASE_PARAMS.email,
      guest_name: BASE_PARAMS.guestName,
      enabled: BASE_PARAMS.whatsappOptIn,
    });
    expect(updateChain.eq).toHaveBeenCalledWith("id", "email-row");
    expect(updateChain.eq).not.toHaveBeenCalledWith("id", "phone-row");
    expect(mockFrom).toHaveBeenCalledTimes(3);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArgs = JSON.stringify(warnSpy.mock.calls[0]);
    expect(warnArgs).toContain("email-row");
    expect(warnArgs).toContain("phone-row");
    expect(warnArgs).not.toContain(BASE_PARAMS.phone);
    expect(warnArgs).not.toContain(BASE_PARAMS.email);
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it("inserts a new row when no existing match is found", async () => {
    const insertChain = writeResult("new-id");
    queue(lookup(null), lookup(null), insertChain);

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("new-id");
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: BASE_PARAMS.phone, email: BASE_PARAMS.email }),
    );
  });

  it("falls back to lookup+update on a race-condition unique violation during insert", async () => {
    const retryUpdateChain = writeResult("raced-id");
    queue(
      lookup(null),
      lookup(null),
      writeResult(null, UNIQUE_VIOLATION),
      lookup({ id: "raced-id" }),
      lookup(null),
      retryUpdateChain,
    );

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("raced-id");
    expect(retryUpdateChain.eq).toHaveBeenCalledWith("id", "raced-id");
  });

  it("re-resolves and retries on a unique violation during update (stale lookup)", async () => {
    const retryUpdateChain = writeResult("email-row");
    queue(
      lookup(null),
      lookup({ id: "phone-row" }),
      writeResult(null, UNIQUE_VIOLATION),
      lookup({ id: "email-row" }),
      lookup({ id: "phone-row" }),
      retryUpdateChain,
    );

    const id = await upsertGuestContact(BASE_PARAMS);

    expect(id).toBe("email-row");
    expect(retryUpdateChain.update.mock.calls[0][0]).not.toHaveProperty("phone");
    expect(retryUpdateChain.eq).toHaveBeenCalledWith("id", "email-row");
  });

  it("throws after one retry when the update hits a unique violation twice", async () => {
    queue(
      lookup({ id: "existing-id" }),
      lookup(null),
      writeResult(null, UNIQUE_VIOLATION),
      lookup({ id: "existing-id" }),
      lookup(null),
      writeResult(null, UNIQUE_VIOLATION),
    );

    await expect(upsertGuestContact(BASE_PARAMS)).rejects.toMatchObject({ code: "23505" });
    expect(mockFrom).toHaveBeenCalledTimes(6);
  });

  it("throws when insert fails for a reason other than a unique violation", async () => {
    queue(lookup(null), lookup(null), writeResult(null, { code: "42501", message: "denied" }));

    await expect(upsertGuestContact(BASE_PARAMS)).rejects.toMatchObject({ code: "42501" });
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });
});
