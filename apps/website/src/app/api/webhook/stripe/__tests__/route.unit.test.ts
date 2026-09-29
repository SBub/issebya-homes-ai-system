import { addDays, format } from "date-fns";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockSupabaseFrom = vi.fn();

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => ({ from: mockSupabaseFrom }),
}));

const mockUpsertGuestContact = vi.fn().mockResolvedValue("guest-contact-id-123");

vi.mock("@/lib/shared/guest-contacts", () => ({
  upsertGuestContact: mockUpsertGuestContact,
}));

const mockConstructEvent = vi.fn();

vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
  },
}));

const mockSendConfirmation = vi.fn();
const mockSendNotification = vi.fn();

vi.mock("@/lib/resend", () => ({
  sendBookingConfirmationEmail: (...args: unknown[]) => mockSendConfirmation(...args),
  sendBookingNotificationEmail: (...args: unknown[]) => mockSendNotification(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

const mockRevalidateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

// --- Helpers ---

// This route never compares checkIn/checkOut against "now" (it just persists
// whatever dates the earlier /api/checkout/create call already validated),
// so a hardcoded date here can't cause a stale-test failure the way
// checkout/create's did. Kept relative anyway for consistency across the
// suite, so nothing here reads like a ticking time bomb.
const REFERENCE_DATE = new Date("2025-06-01T12:00:00Z");

const validMetadata = {
  roomType: "room1",
  checkIn: format(addDays(REFERENCE_DATE, 30), "yyyy-MM-dd"),
  checkOut: format(addDays(REFERENCE_DATE, 33), "yyyy-MM-dd"),
  personCount: "2",
  email: "guest@example.com",
  nights: "3",
  basePrice: "195",
  touristTax: "12",
  total: "207",
  guestName: "Guest Example",
  phone: "+14155552671",
};

function makeWebhookRequest(body: string, sig?: string): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sig) headers["stripe-signature"] = sig;

  return new NextRequest("https://issebya.com/api/webhook/stripe", {
    method: "POST",
    body,
    headers,
  });
}

function makeCheckoutCompletedEvent(metadata: Record<string, string> | null = validMetadata) {
  return {
    type: "checkout.session.completed",
    id: "evt_test_123",
    data: {
      object: {
        id: "cs_test_123",
        payment_intent: "pi_test_123",
        metadata,
      },
    },
  };
}

// The email-step timestamp writes (`update({ <column>: iso }).eq("access_token", …)`)
// share the `update` mock with the confirm update; a payload without `status`
// is a step write and resolves through this.
const mockStepEq = vi.fn();

const ISO_TIMESTAMP = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

/** Supabase mock: update finds and confirms a pending booking */
function mockSuccessfulUpdate() {
  mockSupabaseFrom.mockReturnValue({
    update: vi.fn((payload: Record<string, unknown>) =>
      "status" in payload
        ? {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { access_token: "tok_abc123" },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        : { eq: mockStepEq },
    ),
  });
}

/** Supabase mock: update finds nothing, fallback insert succeeds */
function mockFallbackInsert() {
  mockSupabaseFrom.mockReturnValue({
    update: vi.fn((payload: Record<string, unknown>) =>
      "status" in payload
        ? {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: "PGRST116", message: "No rows found" },
                  }),
                }),
              }),
            }),
          }
        : { eq: mockStepEq },
    ),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { access_token: "tok_new456" },
          error: null,
        }),
      }),
    }),
  });
}

/** Supabase mock: update finds nothing, insert fails with duplicate */
function mockDuplicateInsert() {
  mockSupabaseFrom.mockReturnValue({
    update: vi.fn((payload: Record<string, unknown>) =>
      "status" in payload
        ? {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: "PGRST116", message: "No rows found" },
                  }),
                }),
              }),
            }),
          }
        : { eq: mockStepEq },
    ),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      }),
    }),
  });
}

// --- Tests ---

describe("POST /api/webhook/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStepEq.mockResolvedValue({ error: null });
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}");
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing stripe-signature header");
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_invalid");
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid signature");
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 200 and confirms pending booking on checkout.session.completed", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockSuccessfulUpdate();
    mockSendConfirmation.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);

    // Verify Supabase update was called with payment_intent
    expect(mockSupabaseFrom).toHaveBeenCalledWith("bookings");
    const updateFn = mockSupabaseFrom.mock.results[0].value.update;
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_123" }),
    );

    // Verify emails were sent
    expect(mockSendConfirmation).toHaveBeenCalledOnce();
    expect(mockSendNotification).toHaveBeenCalledOnce();

    // Verify confirmation email data
    const emailData = mockSendConfirmation.mock.calls[0][0];
    expect(emailData.room_type).toBe("room1");
    expect(emailData.email).toBe("guest@example.com");
    expect(emailData.nights).toBe(3);
    expect(emailData.total_amount).toBe(207);

    // Verify the availability cache for this room was invalidated so the
    // next read no longer serves the pre-confirmation snapshot
    expect(mockRevalidateTag).toHaveBeenCalledWith("availability-room1", { expire: 0 });
  });

  it("returns 200 with no DB/email calls when metadata is missing", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent(null));

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockSendConfirmation).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 200 with no DB/email calls when metadata is incomplete", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent({ roomType: "room1" }));

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockSendConfirmation).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("falls back to insert when no pending booking exists", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockFallbackInsert();
    mockSendConfirmation.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Verify payment_intent is written on fallback insert too
    const insertFn = mockSupabaseFrom.mock.results[0].value.insert;
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_123" }),
    );
    // Emails should still be sent after fallback insert
    expect(mockSendConfirmation).toHaveBeenCalledOnce();
    expect(mockSendNotification).toHaveBeenCalledOnce();

    // Verify the availability cache was invalidated on the fallback-insert
    // path too, not just the update-existing-booking path
    expect(mockRevalidateTag).toHaveBeenCalledWith("availability-room1", { expire: 0 });
  });

  it("handles duplicate webhook gracefully (no emails sent, no cache invalidation)", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockDuplicateInsert();

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    expect(res.status).toBe(200);
    // No emails when booking is null (duplicate)
    expect(mockSendConfirmation).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
    // No new confirmed booking resulted from this request, so nothing to
    // invalidate
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("ignores non-checkout events", async () => {
    mockConstructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      id: "evt_other",
      data: { object: {} },
    });

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockSendConfirmation).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("still returns 200 when email sending fails", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockSuccessfulUpdate();
    mockSendConfirmation.mockRejectedValue(new Error("Resend is down"));
    mockSendNotification.mockRejectedValue(new Error("Resend is down"));

    const { POST } = await import("../route");
    const req = makeWebhookRequest("{}", "sig_valid");
    const res = await POST(req);

    // Webhook should still succeed even if emails fail
    expect(res.status).toBe(200);
  });

  it("stamps confirmed_at in the same update that confirms the pending booking", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockSuccessfulUpdate();
    mockSendConfirmation.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);

    const { POST } = await import("../route");
    await POST(makeWebhookRequest("{}", "sig_valid"));

    const updateFn = mockSupabaseFrom.mock.results[0].value.update;
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", confirmed_at: ISO_TIMESTAMP }),
    );
  });

  it("stamps confirmed_at on the fallback insert", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockFallbackInsert();
    mockSendConfirmation.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);

    const { POST } = await import("../route");
    await POST(makeWebhookRequest("{}", "sig_valid"));

    const insertFn = mockSupabaseFrom.mock.results[0].value.insert;
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", confirmed_at: ISO_TIMESTAMP }),
    );
  });

  it("stamps each email step by access_token after its send succeeds", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockSuccessfulUpdate();
    mockSendConfirmation.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);

    const { POST } = await import("../route");
    await POST(makeWebhookRequest("{}", "sig_valid"));

    const updatePayloads = mockSupabaseFrom.mock.results.flatMap((r) =>
      r.value.update.mock.calls.map((c: unknown[]) => c[0]),
    );
    expect(updatePayloads).toContainEqual({ guest_email_sent_at: ISO_TIMESTAMP });
    expect(updatePayloads).toContainEqual({ owner_email_sent_at: ISO_TIMESTAMP });
    expect(mockStepEq).toHaveBeenCalledTimes(2);
    expect(mockStepEq).toHaveBeenNthCalledWith(1, "access_token", "tok_abc123");
    expect(mockStepEq).toHaveBeenNthCalledWith(2, "access_token", "tok_abc123");
  });

  it("does not stamp the guest email when its send fails, but still stamps the owner email", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockSuccessfulUpdate();
    mockSendConfirmation.mockRejectedValue(new Error("Resend is down"));
    mockSendNotification.mockResolvedValue(undefined);

    const { POST } = await import("../route");
    const res = await POST(makeWebhookRequest("{}", "sig_valid"));

    expect(res.status).toBe(200);
    expect(mockSendNotification).toHaveBeenCalledOnce();
    const updatePayloads = mockSupabaseFrom.mock.results.flatMap((r) =>
      r.value.update.mock.calls.map((c: unknown[]) => c[0]),
    );
    expect(updatePayloads).not.toContainEqual({ guest_email_sent_at: ISO_TIMESTAMP });
    expect(updatePayloads).toContainEqual({ owner_email_sent_at: ISO_TIMESTAMP });
  });

  it("still returns 200 when a step timestamp write fails", async () => {
    mockConstructEvent.mockReturnValue(makeCheckoutCompletedEvent());
    mockSuccessfulUpdate();
    mockSendConfirmation.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);
    mockStepEq.mockResolvedValue({ error: { message: "db down" } });

    const { POST } = await import("../route");
    const res = await POST(makeWebhookRequest("{}", "sig_valid"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    // Both sends still happened; the failed stamp did not abort the second.
    expect(mockSendNotification).toHaveBeenCalledOnce();
  });
});
