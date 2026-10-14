import { describe, expect, it } from "vitest";
import { lockinWaitlistJoinedEvent, lockinWaitlistReasonAddedEvent } from "../analytics";
import {
  initialLockinWaitlistState,
  initialSignupReasonState,
  type LockinWaitlistFormState,
} from "../schema";

const TOKEN = "f".repeat(64);
const EMAIL = "guest@example.com";
const NAME = "Ada Visitor";

const shortSuccess: LockinWaitlistFormState = {
  ...initialLockinWaitlistState,
  attempt: 1,
  ok: true,
  email: EMAIL,
  followupToken: TOKEN,
};

const fullSuccess: LockinWaitlistFormState = {
  ...shortSuccess,
  answers: {
    name: NAME,
    lifeArea: "health",
    duration: "7_days",
    months: ["november", "december"],
  },
};

describe("lockinWaitlistJoinedEvent", () => {
  it("sends only the form for a short-form join", () => {
    expect(lockinWaitlistJoinedEvent("short", shortSuccess)).toEqual({
      event: "lockin_waitlist_joined",
      properties: { form: "short" },
    });
  });

  it("sends the choices, never the email or name, for a full-form join", () => {
    const tracked = lockinWaitlistJoinedEvent("full", fullSuccess);

    expect(tracked).toEqual({
      event: "lockin_waitlist_joined",
      properties: {
        form: "full",
        life_area: "health",
        duration: "7_days",
        months: ["november", "december"],
      },
    });
    const serialised = JSON.stringify(tracked);
    expect(serialised).not.toContain(EMAIL);
    expect(serialised).not.toContain(NAME);
    expect(serialised).not.toContain(TOKEN);
    expect(tracked?.properties).not.toHaveProperty("email");
    expect(tracked?.properties).not.toHaveProperty("name");
  });

  it("omits unanswered questions instead of sending them empty", () => {
    const partial = {
      ...fullSuccess,
      answers: { ...fullSuccess.answers, duration: "", months: [] },
    };

    expect(lockinWaitlistJoinedEvent("full", partial)?.properties).toEqual({
      form: "full",
      life_area: "health",
    });
  });

  it("is null for the honeypot's success shape", () => {
    expect(lockinWaitlistJoinedEvent("short", { ...shortSuccess, followupToken: "" })).toBeNull();
  });

  it("is null for a validation error", () => {
    const invalid = {
      ...initialLockinWaitlistState,
      attempt: 1,
      errors: { email: "Please enter a valid email address" },
    };

    expect(lockinWaitlistJoinedEvent("full", invalid)).toBeNull();
  });

  it("is null for a general error", () => {
    const failed = { ...initialLockinWaitlistState, attempt: 1, generalError: "Something broke" };

    expect(lockinWaitlistJoinedEvent("short", failed)).toBeNull();
  });
});

describe("lockinWaitlistReasonAddedEvent", () => {
  const saved = { ...initialSignupReasonState, attempt: 1, ok: true };

  it("sends only the form when a real join's reason is saved", () => {
    expect(lockinWaitlistReasonAddedEvent("full", TOKEN, saved)).toEqual({
      event: "lockin_waitlist_reason_added",
      properties: { form: "full" },
    });
  });

  it("is null after a honeypot join's empty token", () => {
    expect(lockinWaitlistReasonAddedEvent("short", "", saved)).toBeNull();
  });

  it("is null when the reason was not saved", () => {
    const invalid = { ...initialSignupReasonState, attempt: 1, errors: { signupReason: "Empty" } };

    expect(lockinWaitlistReasonAddedEvent("short", TOKEN, invalid)).toBeNull();
  });
});
