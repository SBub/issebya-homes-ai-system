import { captureException } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialSellerWizardState,
  isOwnPhotoPath,
  SELLER_ERROR_COPY,
  SELLER_UPLOAD_ERROR_COPY,
  type SellerFields,
  type SellerWizardState,
} from "@/lib/shop/seller-submission";
import {
  createSellerDraft,
  prepareSellerPhotoUploads,
  sellerDetailsStep,
  submitSellerSubmission,
} from "../actions";

// --- Mocks ---

const mockCreateSignedUploadUrl = vi.fn();
const mockList = vi.fn();
const mockCreateSignedUrls = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  createSignedUploadUrl: mockCreateSignedUploadUrl,
  list: mockList,
  createSignedUrls: mockCreateSignedUrls,
}));

// A PostgREST query is a chain ending in `maybeSingle`. Each call records
// the filters it was given and resolves to the result queued for it.
type Filter = [column: string, value: unknown];
type Query = { filters: Filter[]; columns?: string };
let queries: Query[];

function chain(query: Query, result: unknown) {
  const self = {
    eq: (column: string, value: unknown) => {
      query.filters.push([column, value]);
      return self;
    },
    select: (columns?: string) => {
      query.columns = columns;
      return self;
    },
    maybeSingle: () => Promise.resolve(result),
  };
  return self;
}

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
let updateResult: unknown;
let selectResults: unknown[];

const mockFrom = vi.fn((table: string) => {
  if (table !== "shop_seller_submissions") throw new Error(`Unexpected table ${table}`);
  return {
    insert: mockInsert,
    update: (row: unknown) => {
      mockUpdate(row);
      const query: Query = { filters: [] };
      queries.push(query);
      return chain(query, updateResult);
    },
    select: (columns: string) => {
      mockSelect(columns);
      const query: Query = { filters: [], columns };
      queries.push(query);
      return chain(query, selectResults.shift() ?? { data: null, error: null });
    },
  };
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

// What `createSellerDraft` writes for `fields`, before the id and the photos.
const draftRow = {
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
  contact_consent_at: expect.any(String),
  source: "shop_sell_form",
  status: "draft",
};

const storedRow = {
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
};

const jpeg = { type: "image/jpeg", size: 1024 };
const png = { type: "image/png", size: 2048 };
const webp = { type: "image/webp", size: 4096 };

const ownPaths = [`${SUBMISSION_ID}/0.jpg`, `${SUBMISSION_ID}/1.png`];

function listed(names: string[], metadata = { size: 1024, mimetype: "image/jpeg" }) {
  return { data: names.map((name) => ({ name, metadata })), error: null };
}

function formDataFrom(values: SellerFields): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (key === "contactConsent") {
      if (value) formData.set("contactConsent", "on");
    } else if (key === "honeypot") {
      formData.set("website", String(value));
    } else {
      formData.set(key, String(value));
    }
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  updateResult = { data: null, error: null };
  selectResults = [];
  mockInsert.mockResolvedValue({ error: null });
});

// --- Tests ---

describe("createSellerDraft", () => {
  it("inserts a draft row with a fresh id and no photos", async () => {
    const result = await createSellerDraft(fields);

    expect(result.kind).toBe("draft");
    if (result.kind !== "draft") return;
    expect(result.submissionId).toMatch(UUID);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledOnce();
    const row = mockInsert.mock.calls[0][0];
    expect(row).toEqual({ id: result.submissionId, ...draftRow, photo_paths: [] });
    expect(Number.isInteger(row.asking_price_cents)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["kind", "submissionId"]);
  });

  it("updates the existing draft when given its id, and keeps that id", async () => {
    updateResult = { data: { id: SUBMISSION_ID }, error: null };

    const result = await createSellerDraft(
      { ...fields, title: "Walnut side table" },
      SUBMISSION_ID,
    );

    expect(result).toEqual({ kind: "draft", submissionId: SUBMISSION_ID });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0][0]).toEqual({ ...draftRow, title: "Walnut side table" });
    expect(queries[0].filters).toEqual([
      ["id", SUBMISSION_ID],
      ["status", "draft"],
    ]);
  });

  it("starts a fresh draft when the given id has no draft row", async () => {
    updateResult = { data: null, error: null };

    const result = await createSellerDraft(fields, SUBMISSION_ID);

    expect(result.kind).toBe("draft");
    if (result.kind !== "draft") return;
    expect(result.submissionId).not.toBe(SUBMISSION_ID);
    expect(result.submissionId).toMatch(UUID);
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("returns field errors for invalid text without touching the database", async () => {
    const result = await createSellerDraft({ ...fields, title: "" });

    expect(result).toEqual({
      kind: "invalid",
      errors: { title: "Please give the piece a title" },
      generalError: "",
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot with done and writes nothing", async () => {
    const result = await createSellerDraft({ ...fields, honeypot: "x" });

    expect(result).toEqual({ kind: "done" });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a submission id that is not a uuid", async () => {
    const result = await createSellerDraft(fields, "not-a-uuid");

    expect(result).toEqual({ kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("reports an insert failure without leaking it", async () => {
    mockInsert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });

    const result = await createSellerDraft(fields);

    expect(result).toEqual({ kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY });
    expect(captureException).toHaveBeenCalledOnce();
  });
});

describe("prepareSellerPhotoUploads", () => {
  beforeEach(() => {
    selectResults = [{ data: { id: SUBMISSION_ID }, error: null }];
    mockCreateSignedUploadUrl.mockImplementation(async (path: string) => ({
      data: { path, signedUrl: `https://storage.example/upload/${path}?token=t`, token: "t" },
      error: null,
    }));
  });

  it("mints one URL per photo at server-chosen paths under the draft's id", async () => {
    const result = await prepareSellerPhotoUploads(SUBMISSION_ID, [jpeg, png, webp]);

    expect(result.kind).toBe("upload");
    if (result.kind !== "upload") return;

    // Only a row still in draft may receive photos.
    expect(queries[0].filters).toEqual([
      ["id", SUBMISSION_ID],
      ["status", "draft"],
    ]);
    expect(mockStorageFrom).toHaveBeenCalledWith("seller-submissions");
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledTimes(3);
    const minted = mockCreateSignedUploadUrl.mock.calls.map(([path]) => path as string);
    expect(minted).toEqual([
      `${SUBMISSION_ID}/0.jpg`,
      `${SUBMISSION_ID}/1.png`,
      `${SUBMISSION_ID}/2.webp`,
    ]);
    for (const path of minted) {
      expect(isOwnPhotoPath(SUBMISSION_ID, path)).toBe(true);
      expect(path.startsWith("seller-submissions/")).toBe(false);
    }
    expect(result.uploads).toEqual(
      minted.map((path) => ({
        path,
        signedUrl: `https://storage.example/upload/${path}?token=t`,
        token: "t",
      })),
    );
    expect(Object.keys(result).sort()).toEqual(["kind", "uploads"]);
  });

  it("mints nothing when there is no draft under that id", async () => {
    selectResults = [{ data: null, error: null }];

    const result = await prepareSellerPhotoUploads(SUBMISSION_ID, [jpeg]);

    expect(result).toEqual({ kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY });
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints nothing for seven photos", async () => {
    const result = await prepareSellerPhotoUploads(SUBMISSION_ID, Array(7).fill(jpeg));

    expect(result.kind).toBe("invalid");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("mints nothing for a 6 MB photo", async () => {
    const result = await prepareSellerPhotoUploads(SUBMISSION_ID, [
      jpeg,
      { type: "image/jpeg", size: 6 * 1024 * 1024 },
    ]);

    expect(result).toMatchObject({
      kind: "invalid",
      errors: { photos: "Photo 2: too large (max 5 MB)" },
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("mints nothing for a submission id that is not a uuid", async () => {
    const result = await prepareSellerPhotoUploads("not-a-uuid", [jpeg]);

    expect(result).toEqual({ kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("reports a Storage failure without leaking it", async () => {
    mockCreateSignedUploadUrl.mockResolvedValue({ data: null, error: new Error("boom") });

    const result = await prepareSellerPhotoUploads(SUBMISSION_ID, [jpeg]);

    expect(result).toEqual({ kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY });
    expect(captureException).toHaveBeenCalledOnce();
  });
});

describe("submitSellerSubmission", () => {
  beforeEach(() => {
    mockList.mockResolvedValue(listed(["0.jpg", "1.png"]));
    updateResult = { data: storedRow, error: null };
    mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://storage.example/sign/${path}` })),
      error: null,
    }));
    mockSendEmail.mockResolvedValue(undefined);
  });

  it("attaches its own uploaded photos, flips the draft to submitted and emails the owner", async () => {
    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: true });
    expect(mockList).toHaveBeenCalledWith(SUBMISSION_ID, { limit: 100 });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0][0]).toEqual({ photo_paths: ownPaths, status: "submitted" });
    expect(queries[0].filters).toEqual([
      ["id", SUBMISSION_ID],
      ["status", "draft"],
    ]);

    expect(mockCreateSignedUrls).toHaveBeenCalledWith(ownPaths, 7 * 24 * 60 * 60);
    expect(mockSendEmail).toHaveBeenCalledWith(
      {
        sellerName: "Ana Silva",
        sellerEmail: "seller@example.com",
        sellerPhone: null,
        title: "Oak side table",
        makerOrBrand: null,
        materials: "Solid oak",
        dimensions: null,
        condition: "vintage",
        askingPriceCents: 12050,
        description: fields.description,
      },
      ownPaths.map((path) => `https://storage.example/sign/${path}`),
    );
  });

  it.each([
    [`${OTHER_ID}/0.jpg`],
    [`seller-submissions/${SUBMISSION_ID}/0.jpg`],
    [`${SUBMISSION_ID}/../${OTHER_ID}/0.jpg`],
  ])("refuses a path outside its own prefix: %s", async (foreign) => {
    const result = await submitSellerSubmission(SUBMISSION_ID, [ownPaths[0], foreign]);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_ERROR_COPY });
    expect(mockList).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses a duplicated path", async () => {
    const result = await submitSellerSubmission(SUBMISSION_ID, [ownPaths[0], ownPaths[0]]);

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses a path that was never uploaded", async () => {
    mockList.mockResolvedValue(listed(["0.jpg"]));

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_UPLOAD_ERROR_COPY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses a stored object over 5 MB", async () => {
    mockList.mockResolvedValue(
      listed(["0.jpg", "1.png"], { size: 5 * 1024 * 1024 + 1, mimetype: "image/jpeg" }),
    );

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses a stored object that is not an image", async () => {
    mockList.mockResolvedValue(listed(["0.jpg", "1.png"], { size: 10, mimetype: "text/html" }));

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still succeeds when the owner email fails, and reports it", async () => {
    mockSendEmail.mockRejectedValue(new Error("resend down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("treats an already-submitted row as success without a second email", async () => {
    updateResult = { data: null, error: null };
    selectResults = [{ data: { status: "submitted" }, error: null }];

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("refuses an id with no row at all", async () => {
    updateResult = { data: null, error: null };
    selectResults = [{ data: null, error: null }];

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_ERROR_COPY });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("reports an update failure", async () => {
    updateResult = { data: null, error: { code: "XX000", message: "boom" } };

    const result = await submitSellerSubmission(SUBMISSION_ID, ownPaths);

    expect(result).toEqual({ ok: false, errors: {}, generalError: SELLER_ERROR_COPY });
    expect(captureException).toHaveBeenCalledOnce();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a submission id that is not a uuid", async () => {
    const result = await submitSellerSubmission("not-a-uuid", ["not-a-uuid/0.jpg"]);

    expect(result.ok).toBe(false);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns only the declared result keys", async () => {
    const ok = await submitSellerSubmission(SUBMISSION_ID, ownPaths);
    expect(Object.keys(ok)).toEqual(["ok"]);

    mockList.mockResolvedValue(listed([]));
    const failed = await submitSellerSubmission(SUBMISSION_ID, ownPaths);
    expect(Object.keys(failed).sort()).toEqual(["errors", "generalError", "ok"]);
  });
});

describe("sellerDetailsStep", () => {
  it("creates the draft from the posted fields and moves to the photos step", async () => {
    const result = await sellerDetailsStep(initialSellerWizardState, formDataFrom(fields));

    expect(result).toEqual({
      step: "photos",
      submissionId: expect.stringMatching(UUID),
      fields,
      photoPaths: [],
      errors: {},
      generalError: "",
      attempt: 1,
    });
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("re-uses the draft id it was given instead of inserting again", async () => {
    updateResult = { data: { id: SUBMISSION_ID }, error: null };
    const prev: SellerWizardState = {
      ...initialSellerWizardState,
      step: "details",
      submissionId: SUBMISSION_ID,
      attempt: 1,
    };

    const result = await sellerDetailsStep(prev, formDataFrom(fields));

    expect(result).toMatchObject({ step: "photos", submissionId: SUBMISSION_ID, attempt: 2 });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("stays on the details step with the field errors and the typed values", async () => {
    const typed = { ...fields, askingPrice: "12.345" };

    const result = await sellerDetailsStep(initialSellerWizardState, formDataFrom(typed));

    expect(result).toEqual({
      step: "details",
      submissionId: null,
      fields: typed,
      photoPaths: [],
      errors: { askingPrice: "Enter a price in euros, e.g. 120 or 120.50" },
      generalError: "",
      attempt: 1,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot with the done step", async () => {
    const result = await sellerDetailsStep(
      initialSellerWizardState,
      formDataFrom({ ...fields, honeypot: "x" }),
    );

    expect(result.step).toBe("done");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns a thrown failure as state instead of throwing", async () => {
    mockCreateAdminClient.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const result = await sellerDetailsStep(initialSellerWizardState, formDataFrom(fields));

    expect(result).toMatchObject({ step: "details", generalError: SELLER_ERROR_COPY, attempt: 1 });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("treats a malformed previous state as a fresh start", async () => {
    const result = await sellerDetailsStep(
      { submissionId: 42, photoPaths: "nope" } as unknown as SellerWizardState,
      formDataFrom(fields),
    );

    expect(result).toMatchObject({ step: "photos", photoPaths: [], attempt: 1 });
    expect(mockInsert).toHaveBeenCalledOnce();
  });
});
