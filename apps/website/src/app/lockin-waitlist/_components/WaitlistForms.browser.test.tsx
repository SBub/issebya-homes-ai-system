import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  LOCKIN_FOLLOWUP_LABEL,
  LOCKIN_FOLLOWUP_SAVED,
  LOCKIN_FOLLOWUP_SUBMIT_LABEL,
  LOCKIN_OPT_IN_COPY,
  LOCKIN_SUBMIT_LABEL,
  LOCKIN_THANKS_HEADLINE,
} from "@/lib/lockin-waitlist/copy";
import { initialLockinWaitlistState } from "@/lib/lockin-waitlist/schema";

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// The forms' actions are real Server Function references; this module is the
// seam between the components and "the server".
const mockJoin = vi.fn();
const mockSaveReason = vi.fn();
vi.mock("../actions", () => ({
  joinLockinWaitlist: (...args: unknown[]) => mockJoin(...args),
  saveSignupReason: (...args: unknown[]) => mockSaveReason(...args),
}));

// PostHog is the other seam: every capture the forms make lands here.
const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

import { WaitlistFullForm } from "./WaitlistFullForm";
import { WaitlistShortForm } from "./WaitlistShortForm";

const FOLLOWUP = "f".repeat(64);

const success = {
  ...initialLockinWaitlistState,
  attempt: 1,
  ok: true,
  email: "guest@example.com",
  followupToken: FOLLOWUP,
};

// Both forms on one page, as the real page renders them.
async function renderBoth() {
  const screen = await render(
    <>
      <section aria-label="hero">
        <WaitlistShortForm />
      </section>
      <section aria-label="full">
        <WaitlistFullForm />
      </section>
    </>,
  );
  const hero = screen.getByRole("region", { name: "hero" });
  const full = screen.getByRole("region", { name: "full" });
  return { screen, hero, full };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJoin.mockReset();
  mockSaveReason.mockReset();
  mockCapture.mockReset();
});

// Every argument of every capture, serialised, for "never sent" checks.
function capturedText() {
  return JSON.stringify(mockCapture.mock.calls);
}

async function joinFromHero(hero: Awaited<ReturnType<typeof renderBoth>>["hero"]) {
  await userEvent.fill(hero.getByLabelText("Email", { exact: true }), "guest@example.com");
  await userEvent.click(hero.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await userEvent.click(hero.getByRole("button", { name: LOCKIN_SUBMIT_LABEL }));
}

test("the short form's submit stays disabled until consent is ticked", async () => {
  const { hero } = await renderBoth();
  const submit = hero.getByRole("button", { name: LOCKIN_SUBMIT_LABEL });

  await userEvent.fill(hero.getByLabelText("Email", { exact: true }), "guest@example.com");
  await expect.element(submit).toBeDisabled();
  await userEvent.click(submit, { force: true });
  expect(mockJoin).not.toHaveBeenCalled();

  await userEvent.click(hero.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await expect.element(submit).toBeEnabled();
});

test("the consent label links only to the privacy policy", async () => {
  const { hero } = await renderBoth();

  await expect
    .element(hero.getByRole("link", { name: "Privacy policy" }))
    .toHaveAttribute("href", "/privacy-policy");
});

test("a bad email shows an inline error and keeps the full form", async () => {
  mockJoin.mockResolvedValue({
    ...initialLockinWaitlistState,
    attempt: 1,
    errors: { email: "Please enter a valid email address" },
    email: "not-an-email",
    answers: { name: "", lifeArea: "health", duration: "", months: ["december"] },
  });
  const { screen, full } = await renderBoth();

  await userEvent.fill(full.getByLabelText("Email", { exact: true }), "not-an-email");
  // The inputs are visually hidden; a visitor clicks the option label.
  await userEvent.click(full.getByText("Health", { exact: true }));
  await userEvent.click(full.getByText("December", { exact: true }));
  await userEvent.click(full.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await userEvent.click(full.getByRole("button", { name: LOCKIN_SUBMIT_LABEL }));

  await expect.element(full.getByText("Please enter a valid email address")).toBeVisible();
  expect(mockJoin).toHaveBeenCalledOnce();
  // Still the same page and form, re-seeded from the echoed answers.
  await expect.element(full.getByLabelText("Email", { exact: true })).toHaveValue("not-an-email");
  await expect.element(full.getByLabelText("Health")).toBeChecked();
  await expect.element(full.getByLabelText("December")).toBeChecked();
  expect(screen.container.querySelectorAll("form")).toHaveLength(2);
});

test("a successful submit replaces only the submitted form with the thank-you panel", async () => {
  mockJoin.mockResolvedValue(success);
  const { hero, full } = await renderBoth();

  await userEvent.fill(hero.getByLabelText("Email", { exact: true }), "guest@example.com");
  await userEvent.click(hero.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await userEvent.click(hero.getByRole("button", { name: LOCKIN_SUBMIT_LABEL }));

  await expect.element(hero.getByRole("heading", { name: LOCKIN_THANKS_HEADLINE })).toBeVisible();
  await expect.element(hero.getByLabelText("Email", { exact: true })).not.toBeInTheDocument();
  await expect.element(full.getByLabelText("Email", { exact: true })).toBeVisible();
  await expect.element(full.getByRole("button", { name: LOCKIN_SUBMIT_LABEL })).toBeVisible();
});

test("the follow-up answer is sent with the submit's follow-up token", async () => {
  mockJoin.mockResolvedValue(success);
  mockSaveReason.mockResolvedValue({ attempt: 1, ok: true, errors: {}, generalError: "" });
  const { hero } = await renderBoth();

  await userEvent.fill(hero.getByLabelText("Email", { exact: true }), "guest@example.com");
  await userEvent.click(hero.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await userEvent.click(hero.getByRole("button", { name: LOCKIN_SUBMIT_LABEL }));

  await userEvent.fill(hero.getByLabelText(LOCKIN_FOLLOWUP_LABEL), "a reel");
  await userEvent.click(hero.getByRole("button", { name: LOCKIN_FOLLOWUP_SUBMIT_LABEL }));

  await expect.element(hero.getByText(LOCKIN_FOLLOWUP_SAVED)).toBeVisible();
  expect(mockSaveReason).toHaveBeenCalledOnce();
  const sent = mockSaveReason.mock.calls[0][1] as FormData;
  expect(sent.get("followupToken")).toBe(FOLLOWUP);
  expect(sent.get("signupReason")).toBe("a reel");
  expect(sent.get("email")).toBeNull();
});

test("a short-form join captures one lockin_waitlist_joined without the email", async () => {
  mockJoin.mockResolvedValue(success);
  const { hero } = await renderBoth();

  await joinFromHero(hero);

  await expect.element(hero.getByRole("heading", { name: LOCKIN_THANKS_HEADLINE })).toBeVisible();
  expect(mockCapture).toHaveBeenCalledExactlyOnceWith("lockin_waitlist_joined", { form: "short" });
  expect(capturedText()).not.toContain("guest@example.com");
});

test("a full-form join captures the choices, never the name or email", async () => {
  mockJoin.mockResolvedValue({
    ...success,
    answers: { name: "Ada Visitor", lifeArea: "health", duration: "7_days", months: ["december"] },
  });
  const { full } = await renderBoth();

  await userEvent.fill(full.getByLabelText("Email", { exact: true }), "guest@example.com");
  await userEvent.click(full.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await userEvent.click(full.getByRole("button", { name: LOCKIN_SUBMIT_LABEL }));

  await expect.element(full.getByRole("heading", { name: LOCKIN_THANKS_HEADLINE })).toBeVisible();
  expect(mockCapture).toHaveBeenCalledExactlyOnceWith("lockin_waitlist_joined", {
    form: "full",
    life_area: "health",
    duration: "7_days",
    months: ["december"],
  });
  expect(capturedText()).not.toContain("guest@example.com");
  expect(capturedText()).not.toContain("Ada Visitor");
});

test("a validation error captures nothing", async () => {
  mockJoin.mockResolvedValue({
    ...initialLockinWaitlistState,
    attempt: 1,
    errors: { email: "Please enter a valid email address" },
    email: "not-an-email",
  });
  const { hero } = await renderBoth();

  await userEvent.fill(hero.getByLabelText("Email", { exact: true }), "not-an-email");
  await userEvent.click(hero.getByRole("checkbox", { name: LOCKIN_OPT_IN_COPY }));
  await userEvent.click(hero.getByRole("button", { name: LOCKIN_SUBMIT_LABEL }));

  await expect.element(hero.getByText("Please enter a valid email address")).toBeVisible();
  expect(mockCapture).not.toHaveBeenCalled();
});

test("a honeypot submit shows the thank-you panel and captures nothing", async () => {
  mockJoin.mockResolvedValue({ ...success, followupToken: "" });
  const { hero } = await renderBoth();

  await joinFromHero(hero);

  await expect.element(hero.getByRole("heading", { name: LOCKIN_THANKS_HEADLINE })).toBeVisible();
  expect(mockCapture).not.toHaveBeenCalled();
});

test("a saved reason captures lockin_waitlist_reason_added without the reason text", async () => {
  mockJoin.mockResolvedValue(success);
  mockSaveReason.mockResolvedValue({ attempt: 1, ok: true, errors: {}, generalError: "" });
  const { hero } = await renderBoth();

  await joinFromHero(hero);
  await userEvent.fill(hero.getByLabelText(LOCKIN_FOLLOWUP_LABEL), "a reel about deep work");
  await userEvent.click(hero.getByRole("button", { name: LOCKIN_FOLLOWUP_SUBMIT_LABEL }));

  await expect.element(hero.getByText(LOCKIN_FOLLOWUP_SAVED)).toBeVisible();
  expect(mockCapture).toHaveBeenCalledTimes(2);
  expect(mockCapture).toHaveBeenLastCalledWith("lockin_waitlist_reason_added", { form: "short" });
  expect(capturedText()).not.toContain("a reel about deep work");
});
