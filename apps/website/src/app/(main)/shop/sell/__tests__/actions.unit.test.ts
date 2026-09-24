import { captureException } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isOwnPhotoPath,
  SELLER_ERROR_COPY,
  SELLER_UPLOAD_ERROR_COPY,
  type SellerFields,
} from "@/lib/shop/seller-submission";
import { prepareSellerPhotoUploads, submitSellerSubmission } from "../actions";

// --- Mocks ---

const mockCreateSignedUploadUrl = vi.fn();
const mockList = vi.fn();
const mockCreateSignedUrls = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  createSignedUploadUrl: mockCreateSignedUploadUrl,
  list: mockList,
  createSignedUrls: mockCreateSignedUrls,
}));
const mockInsert = vi.fn();
const mockFrom = vi.fn((table: string) => {
  if (table === "shop_seller_submissions") return { insert: mockInsert };
  throw new Error(`Unexpected table ${table}`);
});
const mockCreateAdminClient = vi.fn(() => ({
  from: mockFrom,
  storage: { from: mockStorageFrom },
}));

vi.mock("@/lib/shared/supabase", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/resend", () => ({
  sendSellerSubmissionNotificationEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// --- Helpers ---

const SUBMISSION_ID = "3f1c2a4e-7b9d-4e21-9a3c-5d6e7f8a9b0c";
const OTHER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const fields: SellerFields = {
  name: "Ana Silva",
  email: " Seller@Example.com ",
  phone: "",
  title: "Oak side table",
  makerOrBrand: "",
  materials: "Solid oak",
  dimensions: "",
  condition: "vintage",
  askingPrice: "120,50",
  description: "Bought in Porto in the seventies, one small mark on the top.",
  contactConsent: true,
  honeypot: "",
};

const jpeg = { type: "image/jpeg", size: 1024 };
const png = { type: "image/png", size: 2048 };
const webp = { type: "image/webp", size: 4096 };

const ownPaths = [`${SUBMISSION_ID}/0.jpg`, `${SUBMISSION_ID}/1.png`];

function listed(names: string[], metadata = { size: 1024, mimetype: "image/jpeg" }) {
  return { data: names.map((name) => ({ name, metadata })), error: null };
}

// --- Tests ---

describe("prepareSellerPhotoUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUploadUrl.mockImplementation(async (path: string) => ({
      data: { path, signedUrl: `https://storage.example/upload/${path}?token=t`, token: "t" },
      error: null,
    }));
  });

  it("mints one URL per photo at server-chosen paths under a fresh id", async () => {
    const result = await prepareSellerPhotoUploads(fields, [jpeg, png, webp]);

    expect(result.kind).toBe("upload");
    if (result.kind !== "upload") return;

    expect(mockStorageFrom).toHaveBeenCalledWith("seller-submissions");
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledTimes(3);
    const minted = mockCreateSignedUploadUrl.mock.calls.map(([path]) => path as string);
    expect(minted).toEqual([
      `${result.submissionId}/0.jpg`,
      `${result.submissionId}/1.png`,
      `${result.submissionId}/2.webp`,
    ]);
    for (const path of minted) {
      expect(isOwnPhotoPath(result.submissionId, path)).toBe(true);
      expect(path.startsWith("seller-submissions/")).toBe(false);
    }
    expect(result.uploads).toEqual(
      minted.map((path) => ({
        path,
        signedUrl: `https://storage.example/upload/${path}?token=t`,
        token: "t",
      })),
    );
    expect(Object.keys(result).sort()).toEqual(["kind", "submissionId", "uploads"]);
  });

  it("mints nothing when a text field is invalid", async () => {
    const result = await prepareSellerPhotoUploads({ ...fields, title: "" }, [jpeg]);

    expect(result).toEqual({
      kind: "invalid",
      errors: { title: "Please give the piece a title" },
      generalError: "",
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints nothing for seven photos", async () => {
    const result = await prepareSellerPhotoUploads(fields, Array(7).fill(jpeg));

    expect(result.kind).toBe("invalid");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("mints nothing for a 6 MB photo", async () => {
    const result = await prepareSellerPhotoUploads(fields, [
      jpeg,
      { type: "image/jpeg", size: 6 * 1024 * 1024 },
    ]);

    expect(result).toMatchObject({
      kind: "invalid",
      errors: { photos: "Photo 2: too large (max 5 MB)" },
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot with done and mints nothing", async () => {
    const result = await prepareSellerPhotoUploads({ ...fields, honeypot: "x" }, [jpeg]);

    expect(result).toEqual({ kind: "done" });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("reports a Storage failure without leaking it", async () => {
    mockCreateSignedUploadUrl.mockResolvedValue({ data: null, error: new Error("boom") });

    const result = await prepareSellerPhotoUploads(fields, [jpeg]);

    expect(result).toEqual({ kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY });
    expect(captureException).toHaveBeenCalledOnce();
  });
});

describe("submitSellerSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(listed(["0.jpg", "1.png"]));
    mockInsert.mockResolvedValue({ error: null });
    mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://storage.example/sign/${path}` })),
      error: null,
    }));
    mockSendEmail.mockResolvedValue(undefined);
  });

  it("records one row for its own uploaded photos and emails the owner", async () => {
    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: true });
    expect(mockList).toHaveBeenCalledWith(SUBMISSION_ID, { limit: 100 });
    expect(mockInsert).toHaveBeenCalledOnce();

    const row = mockInsert.mock.calls[0][0];
    expect(row).toEqual({
      id: SUBMISSION_ID,
      seller_name: "Ana Silva",
      seller_email: "seller@example.com",
      seller_phone: null,
      title: "Oak side table",
      maker_or_brand: null,
      materials: "Solid oak",
      dimensions: null,
      condition: "vintage",
      asking_price_cents: 12050,
      description: fields.description,
      photo_paths: ownPaths,
      contact_consent_at: expect.any(String),
      source: "shop_sell_form",
    });
    expect(Number.isInteger(row.asking_price_cents)).toBe(true);
    expect(row).not.toHaveProperty("status");

    expect(mockCreateSignedUrls).toHaveBeenCalledWith(ownPaths, 7 * 24 * 60 * 60);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ sellerEmail: "seller@example.com", askingPriceCents: 12050 }),
      ownPaths.map((path) => `https://storage.example/sign/${path}`),
    );
  });

  it.each([
    [`${OTHER_ID}/0.jpg`],
    [`seller-submissions/${SUBMISSION_ID}/0.jpg`],
    [`${SUBMISSION_ID}/../${OTHER_ID}/0.jpg`],
  ])("refuses a path outside its own prefix: %s", async (foreign) => {
    const result = await submitSellerSubmission(fields, SUBMISSION_ID, [ownPaths[0], foreign]);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_ERROR_COPY });
    expect(mockList).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refuses a duplicated path", async () => {
    const result = await submitSellerSubmission(fields, SUBMISSION_ID, [ownPaths[0], ownPaths[0]]);

    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refuses a path that was never uploaded", async () => {
    mockList.mockResolvedValue(listed(["0.jpg"]));

    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_UPLOAD_ERROR_COPY });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refuses a stored object over 5 MB", async () => {
    mockList.mockResolvedValue(
      listed(["0.jpg", "1.png"], { size: 5 * 1024 * 1024 + 1, mimetype: "image/jpeg" }),
    );

    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refuses a stored object that is not an image", async () => {
    mockList.mockResolvedValue(listed(["0.jpg", "1.png"], { size: 10, mimetype: "text/html" }));

    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still succeeds when the owner email fails, and reports it", async () => {
    mockSendEmail.mockRejectedValue(new Error("resend down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("treats an already-recorded submission as success without a second email", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports any other insert failure", async () => {
    mockInsert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });

    const result = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_ERROR_COPY });
    expect(captureException).toHaveBeenCalledOnce();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot with success and touches nothing", async () => {
    const result = await submitSellerSubmission(
      { ...fields, honeypot: "x" },
      SUBMISSION_ID,
      ownPaths,
    );

    expect(result).toEqual({ ok: true });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid text without touching Storage", async () => {
    const result = await submitSellerSubmission(
      { ...fields, askingPrice: "12.345" },
      SUBMISSION_ID,
      ownPaths,
    );

    expect(result).toEqual({
      ok: false,
      errors: { askingPrice: "Enter a price in euros, e.g. 120 or 120.50" },
      generalError: "",
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a submission id that is not a uuid", async () => {
    const result = await submitSellerSubmission(fields, "not-a-uuid", ["not-a-uuid/0.jpg"]);

    expect(result.ok).toBe(false);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns only the declared result keys", async () => {
    const ok = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);
    expect(Object.keys(ok)).toEqual(["ok"]);

    mockList.mockResolvedValue(listed([]));
    const failed = await submitSellerSubmission(fields, SUBMISSION_ID, ownPaths);
    expect(Object.keys(failed).sort()).toEqual(["errors", "generalError", "ok"]);
  });
});
