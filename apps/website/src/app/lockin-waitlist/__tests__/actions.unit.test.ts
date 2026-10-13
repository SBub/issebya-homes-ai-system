import { captureException } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCKIN_ERROR_COPY,
  LOCKIN_OPT_IN_COPY,
  LOCKIN_OPT_IN_REQUIRED,
} from "@/lib/lockin-waitlist/copy";
import { initialLockinWaitlistState, initialSignupReasonState } from "@/lib/lockin-waitlist/schema";
import { joinLockinWaitlist, saveSignupReason } from "../actions";

// --- Mocks ---

const STORED_UNSUBSCRIBE = "c".repeat(64);
const STORED_FOLLOWUP = "e".repeat(64);
const FOLLOWUP = "f".repeat(64);

// `select().eq().maybeSingle()` is the pre-read; `upsert().select().single()`
// is the write reading back the stored tokens; `update().eq().select()` is
// the follow-up answer.
const mockMaybeSingle = vi.fn();
const mockSelectEq = vi.fn((_column: string, _value: string) => ({
  maybeSingle: mockMaybeSingle,
}));
const mockUpsertSingle = vi.fn();
const mockUpsert = vi.fn((_row: Record<string, unknown>, _options: unknown) => ({
  select: () => ({ single: mockUpsertSingle }),
}));
const mockUpdateSelect = vi.fn();
const mockUpdateEq = vi.fn((_column: string, _value: string) => ({ select: mockUpdateSelect }));
const mockUpdate = vi.fn((_values: Record<string, unknown>) => ({ eq: mockUpdateEq }));
const mockFrom = vi.fn((table: string) => {
  if (table !== "lockin_waitlist") throw new Error(`Unexpected table ${table}`);
  return { select: () => ({ eq: mockSelectEq }), upsert: mockUpsert, update: mockUpdate };
});
const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }));

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

const mockSendWelcome = vi.fn();
vi.mock("@/lib/resend", () => ({
  sendLockinWaitlistWelcomeEmail: (...args: unknown[]) => mockSendWelcome(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// --- Helpers ---

function formData(fields: Record<string, string | string[] | null>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) fd.append(key, v);
    else if (value !== null) fd.set(key, value);
  }
  return fd;
}

const shortForm = (overrides: Record<string, string | null> = {}) =>
  formData({ email: "  Guest@Example.com ", marketingOptIn: "on", website: "", ...overrides });

const subscribedRow = {
  name: "Ana",
  life_area: "health",
  duration: null,
  months: null,
  unsubscribed_at: null,
};

// --- Tests ---

describe("joinLockinWaitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsertSingle.mockResolvedValue({
      data: { unsubscribe_token: STORED_UNSUBSCRIBE, followup_token: STORED_FOLLOWUP },
      error: null,
    });
    mockSendWelcome.mockResolvedValue(undefined);
  });

  it("saves a new sign-up once and welcomes it once", async () => {
    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm());

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(1);
    expect(result.followupToken).toBe(STORED_FOLLOWUP);
    expect(mockSelectEq).toHaveBeenCalledWith("email", "guest@example.com");
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "guest@example.com",
        marketing_opt_in: true,
        opt_in_copy: LOCKIN_OPT_IN_COPY,
      }),
      { onConflict: "email" },
    );
    expect(mockSendWelcome).toHaveBeenCalledOnce();
    expect(mockSendWelcome).toHaveBeenCalledWith({
      email: "guest@example.com",
      unsubscribeToken: STORED_UNSUBSCRIBE,
    });
  });

  it("takes the stored consent copy from the server, not the form", async () => {
    await joinLockinWaitlist(
      initialLockinWaitlistState,
      formData({ email: "guest@example.com", marketingOptIn: "on", opt_in_copy: "other" }),
    );

    expect(mockUpsert.mock.calls[0][0].opt_in_copy).toBe(LOCKIN_OPT_IN_COPY);
  });

  it("saves the full form's answers as slugs", async () => {
    await joinLockinWaitlist(
      initialLockinWaitlistState,
      formData({
        email: "guest@example.com",
        name: "Ana",
        lifeArea: "creative_project",
        duration: "weekend",
        months: ["december", "later"],
        marketingOptIn: "on",
      }),
    );

    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      name: "Ana",
      life_area: "creative_project",
      duration: "weekend",
      months: ["december", "later"],
    });
  });

  it("updates a subscribed email without a second welcome", async () => {
    mockMaybeSingle.mockResolvedValue({ data: subscribedRow, error: null });

    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm());

    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledOnce();
    // The short form wipes nothing the full form answered earlier.
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ name: "Ana", life_area: "health" });
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("welcomes an unsubscribed email consenting again", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { ...subscribedRow, unsubscribed_at: "2026-10-01T10:00:00.000Z" },
      error: null,
    });

    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm());

    expect(result.ok).toBe(true);
    const row = mockUpsert.mock.calls[0][0];
    expect(row.unsubscribed_at).toBeNull();
    expect(row.unsubscribe_token).toMatch(/^[0-9a-f]{64}$/);
    expect(mockSendWelcome).toHaveBeenCalledOnce();
  });

  it("answers a filled honeypot with the thank-you state and writes nothing", async () => {
    const result = await joinLockinWaitlist(
      initialLockinWaitlistState,
      shortForm({ website: "https://spam.example" }),
    );

    expect(result.ok).toBe(true);
    expect(result.followupToken).toBe("");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("keeps the sign-up when the welcome email fails, and reports it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendWelcome.mockRejectedValue(new Error("resend down"));

    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm());

    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { "email.type": "lockin_waitlist_welcome" },
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    ["a bad email", { email: "not-an-email" }, "email"],
    ["missing consent", { marketingOptIn: null }, "marketingOptIn"],
  ] as const)("answers %s inline without touching the database", async (_l, overrides, field) => {
    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm(overrides));

    expect(result.ok).toBe(false);
    expect(result.errors[field]).toBeTruthy();
    expect(result.followupToken).toBe("");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("uses the friendly consent message", async () => {
    const result = await joinLockinWaitlist(
      initialLockinWaitlistState,
      shortForm({ marketingOptIn: null }),
    );

    expect(result.errors.marketingOptIn).toBe(LOCKIN_OPT_IN_REQUIRED);
  });

  it("reports an off-list month on the months group and echoes the answers", async () => {
    const result = await joinLockinWaitlist(
      initialLockinWaitlistState,
      formData({ email: "guest@example.com", months: ["March"], lifeArea: "health" }),
    );

    expect(result.errors.months).toBeTruthy();
    expect(result.answers).toMatchObject({ lifeArea: "health", months: ["March"] });
  });

  it("stores nothing when the pre-read fails", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { code: "XX000" } });

    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm());

    expect(result.ok).toBe(false);
    expect(result.generalError).toBe(LOCKIN_ERROR_COPY);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.anything(), {
      tags: { "db.operation": "lockin_waitlist_select" },
    });
  });

  it("sends no email when the upsert fails", async () => {
    mockUpsertSingle.mockResolvedValue({ data: null, error: { code: "XX000" } });

    const result = await joinLockinWaitlist(initialLockinWaitlistState, shortForm());

    expect(result.ok).toBe(false);
    expect(result.generalError).toBe(LOCKIN_ERROR_COPY);
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });
});

describe("saveSignupReason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSelect.mockResolvedValue({ data: [{ email: "guest@example.com" }], error: null });
  });

  it("writes the answer to the row holding the token and clears the token", async () => {
    const result = await saveSignupReason(
      initialSignupReasonState,
      formData({ followupToken: FOLLOWUP, signupReason: " a reel " }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({ signup_reason: "a reel", followup_token: null });
    expect(mockUpdateEq).toHaveBeenCalledOnce();
    expect(mockUpdateEq).toHaveBeenCalledWith("followup_token", FOLLOWUP);
  });

  it("writes nothing for a token no row holds, and still says thanks", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [], error: null });

    const result = await saveSignupReason(
      initialSignupReasonState,
      formData({ followupToken: "a".repeat(64), signupReason: "a reel" }),
    );

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateEq).toHaveBeenCalledWith("followup_token", "a".repeat(64));
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["malformed", "xyz"],
  ])("touches no database for a %s token", async (_label, token) => {
    const result = await saveSignupReason(
      initialSignupReasonState,
      formData({ followupToken: token, signupReason: "a reel" }),
    );

    expect(result.ok).toBe(true);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("ignores an email in the form: the token is the only filter", async () => {
    await saveSignupReason(
      initialSignupReasonState,
      formData({ followupToken: FOLLOWUP, signupReason: "a reel", email: "other@example.com" }),
    );

    expect(mockUpdateEq).toHaveBeenCalledOnce();
    expect(mockUpdateEq).toHaveBeenCalledWith("followup_token", FOLLOWUP);
    expect(JSON.stringify(mockUpdate.mock.calls)).not.toContain("other@example.com");
  });

  it("answers an over-long reason inline without a write", async () => {
    const result = await saveSignupReason(
      initialSignupReasonState,
      formData({ followupToken: FOLLOWUP, signupReason: "a".repeat(1001) }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.signupReason).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports a database error", async () => {
    mockUpdateSelect.mockResolvedValue({ data: null, error: { code: "XX000" } });

    const result = await saveSignupReason(
      initialSignupReasonState,
      formData({ followupToken: FOLLOWUP, signupReason: "a reel" }),
    );

    expect(result.ok).toBe(false);
    expect(result.generalError).toBe(LOCKIN_ERROR_COPY);
    expect(captureException).toHaveBeenCalledOnce();
  });
});
