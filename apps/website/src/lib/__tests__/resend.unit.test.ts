import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WISHLIST_EMAIL_SUBJECT } from "@/lib/shop/wishlist";
import { SITE_URL } from "@/lib/site";
import { sendSellerSubmissionNotificationEmail, sendWishlistConfirmationEmail } from "../resend";

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

const submission = {
  sellerName: "Ana Silva",
  sellerEmail: "seller@example.com",
  sellerPhone: null,
  title: "Oak side table",
  makerOrBrand: "Atelier Norte",
  materials: "Solid oak",
  dimensions: "40 × 30 × 55 cm",
  condition: "vintage" as const,
  askingPriceCents: 12050,
  description: "Bought in Porto in the seventies, one small mark on the top.",
};

const photoUrls = ["https://storage.example/a?token=1", "https://storage.example/b?token=2"];

describe("sendSellerSubmissionNotificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_NOTIFICATION_EMAIL", "owner@example.com");
    vi.stubEnv("RESEND_FROM_EMAIL", "house@example.com");
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the owner a plain-text summary with every field and photo link", async () => {
    await sendSellerSubmissionNotificationEmail(submission, photoUrls);

    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message).toMatchObject({
      from: "house@example.com",
      to: "owner@example.com",
      replyTo: "seller@example.com",
      subject: "New shop submission: Oak side table",
    });

    const lines: string[] = message.text.split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "Seller: Ana Silva",
        "Email: seller@example.com",
        "Phone: not given",
        "Title: Oak side table",
        "Maker or brand: Atelier Norte",
        "Materials: Solid oak",
        "Dimensions: 40 × 30 × 55 cm",
        "Condition: Vintage",
        "Asking price: €120.50",
        submission.description,
        `Photo 1: ${photoUrls[0]}`,
        `Photo 2: ${photoUrls[1]}`,
        "Review in Supabase Studio → shop_seller_submissions",
      ]),
    );
    expect(lines.filter((line) => line.startsWith("Photo "))).toHaveLength(2);
  });

  it("throws when Resend reports an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: "api_error", message: "down" } });

    await expect(sendSellerSubmissionNotificationEmail(submission, photoUrls)).rejects.toThrow(
      "down",
    );
  });

  it("sends nothing when no admin email is configured", async () => {
    vi.stubEnv("ADMIN_NOTIFICATION_EMAIL", "");

    await sendSellerSubmissionNotificationEmail(submission, photoUrls);

    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("sendWishlistConfirmationEmail", () => {
  const wish = {
    email: "guest@example.com",
    productName: "Oak side table",
    productSlug: "oak-side-table",
    unsubscribeToken: "a".repeat(64),
  };
  const link = `https://issebya.com/shop/wishlist/unsubscribe?token=${"a".repeat(64)}`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_NOTIFICATION_EMAIL", "owner@example.com");
    vi.stubEnv("RESEND_FROM_EMAIL", "house@example.com");
    mockSend.mockResolvedValue({ data: { id: "email-2" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the guest a plain-text note naming and linking the product", async () => {
    await sendWishlistConfirmationEmail(wish);

    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message).toMatchObject({
      from: "house@example.com",
      to: "guest@example.com",
      replyTo: "owner@example.com",
      subject: WISHLIST_EMAIL_SUBJECT,
    });
    expect(message.react).toBeUndefined();
    const lines: string[] = message.text.split("\n");
    expect(lines).toContain("https://issebya.com/shop/oak-side-table");
    expect(lines).toContain(`${SITE_URL}/shop/oak-side-table`);
    expect(message.text).toContain("Oak side table");
  });

  it("ends with the unsubscribe link and sends it as List-Unsubscribe", async () => {
    await sendWishlistConfirmationEmail(wish);

    const message = mockSend.mock.calls[0][0];
    expect(message.text).toContain(link);
    expect(message.headers["List-Unsubscribe"]).toBe(`<${link}>`);
    expect(message.headers).not.toHaveProperty("List-Unsubscribe-Post");
    expect(message.replyTo).toBe("owner@example.com");
  });

  it("omits replyTo when no admin email is configured", async () => {
    vi.stubEnv("ADMIN_NOTIFICATION_EMAIL", "");

    await sendWishlistConfirmationEmail(wish);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty("replyTo");
  });

  it("throws without sending when RESEND_FROM_EMAIL is missing", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "");

    await expect(sendWishlistConfirmationEmail(wish)).rejects.toThrow(
      "Missing environment variable: RESEND_FROM_EMAIL",
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when Resend reports an error", async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: "api_error", message: "down" } });

    await expect(sendWishlistConfirmationEmail(wish)).rejects.toThrow("down");
  });
});
