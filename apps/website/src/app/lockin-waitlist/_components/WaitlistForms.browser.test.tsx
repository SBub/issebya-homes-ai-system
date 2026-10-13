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
});

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
