import { describe, expect, it } from "vitest";
import { LOCKIN_OPT_IN_COPY, LOCKIN_OPT_IN_REQUIRED } from "../copy";
import {
  lockinWaitlistInputFromFormData,
  lockinWaitlistSchema,
  lockinWaitlistUpsert,
  signupReasonInputFromFormData,
  signupReasonSchema,
} from "../schema";

const NOW = "2026-10-13T12:00:00.000Z";
const TOKEN = "f".repeat(64);

function fullForm(overrides: Record<string, string | string[] | null> = {}) {
  const fields: Record<string, string | string[] | null> = {
    email: "  Guest@Example.com ",
    name: " Ana ",
    lifeArea: "health",
    duration: "7_days",
    months: ["november", "january", "november"],
    marketingOptIn: "on",
    website: "",
    ...overrides,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) fd.append(key, v);
    else if (value !== null) fd.set(key, value);
  }
  return fd;
}

const parse = (fd: FormData) => lockinWaitlistSchema.safeParse(lockinWaitlistInputFromFormData(fd));

function parsed(fd: FormData) {
  const result = parse(fd);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

function issueFields(fd: FormData) {
  const result = parse(fd);
  return result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
}

describe("lockinWaitlistSchema", () => {
  it("accepts a full submit, normalising the email and deduplicating months", () => {
    expect(parsed(fullForm())).toEqual({
      email: "guest@example.com",
      name: "Ana",
      lifeArea: "health",
      duration: "7_days",
      months: ["november", "january"],
      marketingOptIn: true,
      honeypot: "",
    });
  });

  it("accepts a short-form submit with every answer empty", () => {
    const fd = fullForm({ name: null, lifeArea: null, duration: null, months: [] });

    expect(parsed(fd)).toMatchObject({
      name: undefined,
      lifeArea: undefined,
      duration: undefined,
      months: [],
    });
  });

  it("rejects missing consent with the friendly message", () => {
    const result = parse(fullForm({ marketingOptIn: null }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(LOCKIN_OPT_IN_REQUIRED);
  });

  it.each([
    ["a bad email", { email: "not-an-email" }, "email"],
    ["an off-list life area", { lifeArea: "Money" }, "lifeArea"],
    ["a label instead of a slug", { lifeArea: "Health" }, "lifeArea"],
    ["an off-list duration", { duration: "1_day" }, "duration"],
    ["an off-list month", { months: ["March"] }, "months"],
    ["a filled honeypot", { website: "https://spam.example" }, "honeypot"],
    ["a name over 100 characters", { name: "a".repeat(101) }, "name"],
  ])("rejects %s", (_label, overrides, field) => {
    expect(issueFields(fullForm(overrides))).toContain(field);
  });
});

describe("signupReasonSchema", () => {
  function reasonForm(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return signupReasonSchema.safeParse(signupReasonInputFromFormData(fd));
  }

  it("accepts a token and a trimmed reason", () => {
    const result = reasonForm({ followupToken: TOKEN, signupReason: "  a reel  " });

    expect(result.data).toEqual({ followupToken: TOKEN, signupReason: "a reel" });
  });

  it.each([
    ["missing", {}],
    ["malformed", { followupToken: "xyz" }],
    ["uppercase", { followupToken: "F".repeat(64) }],
  ])("rejects a %s token", (_label, token) => {
    const result = reasonForm({ ...token, signupReason: "a reel" });

    expect(result.error?.issues.map((issue) => issue.path[0])).toContain("followupToken");
  });

  it("rejects a reason over 1000 characters", () => {
    const result = reasonForm({ followupToken: TOKEN, signupReason: "a".repeat(1001) });

    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["signupReason"]);
  });
});

describe("lockinWaitlistUpsert", () => {
  let counter = 0;
  const newToken = () => String(++counter).padStart(64, "0");
  const emailOnly = () =>
    parsed(fullForm({ name: null, lifeArea: null, duration: null, months: [] }));

  const existing = {
    name: "Ana",
    life_area: "health",
    duration: "3_days",
    months: ["december"],
    unsubscribed_at: null,
  };

  it("keeps every earlier answer on a short-form resubmit", () => {
    const { row, isNew, reconsented } = lockinWaitlistUpsert(emailOnly(), existing, NOW, newToken);

    expect(row).toMatchObject({
      email: "guest@example.com",
      name: "Ana",
      life_area: "health",
      duration: "3_days",
      months: ["december"],
    });
    expect(isNew).toBe(false);
    expect(reconsented).toBe(false);
  });

  it("lets new answers override earlier ones", () => {
    const { row } = lockinWaitlistUpsert(parsed(fullForm()), existing, NOW, newToken);

    expect(row).toMatchObject({
      name: "Ana",
      life_area: "health",
      duration: "7_days",
      months: ["november", "january"],
    });
  });

  it("stores unanswered fields of a new sign-up as null", () => {
    const { row, isNew } = lockinWaitlistUpsert(emailOnly(), null, NOW, newToken);

    expect(row).toMatchObject({ name: null, life_area: null, duration: null, months: null });
    expect(isNew).toBe(true);
    expect(row).not.toHaveProperty("unsubscribe_token");
  });

  it("records the server's consent copy and time", () => {
    const { row } = lockinWaitlistUpsert(emailOnly(), null, NOW, newToken);

    expect(row).toMatchObject({
      marketing_opt_in: true,
      opted_in_at: NOW,
      opt_in_copy: LOCKIN_OPT_IN_COPY,
    });
  });

  it("re-subscribes an unsubscribed row with a fresh unsubscribe token", () => {
    const { row, isNew, reconsented } = lockinWaitlistUpsert(
      emailOnly(),
      { ...existing, unsubscribed_at: "2026-10-01T10:00:00.000Z" },
      NOW,
      newToken,
    );

    expect(reconsented).toBe(true);
    expect(isNew).toBe(false);
    expect(row.unsubscribed_at).toBeNull();
    expect(row.unsubscribe_token).toMatch(/^[0-9a-f]{64}$/);
    expect(row.unsubscribe_token).not.toBe(row.followup_token);
  });

  it("keeps a subscribed row's unsubscribe token out of the payload", () => {
    const { row } = lockinWaitlistUpsert(emailOnly(), existing, NOW, newToken);

    expect(row).not.toHaveProperty("unsubscribe_token");
    expect(row).not.toHaveProperty("unsubscribed_at");
  });

  it("issues a fresh follow-up token on every submit and never sets signup_reason", () => {
    const first = lockinWaitlistUpsert(emailOnly(), null, NOW, newToken).row;
    const second = lockinWaitlistUpsert(emailOnly(), existing, NOW, newToken).row;

    expect(first.followup_token).toMatch(/^[0-9a-f]{64}$/);
    expect(second.followup_token).not.toBe(first.followup_token);
    expect(first).not.toHaveProperty("signup_reason");
    expect(second).not.toHaveProperty("signup_reason");
  });
});
