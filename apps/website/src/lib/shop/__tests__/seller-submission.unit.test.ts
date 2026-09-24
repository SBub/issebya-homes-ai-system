import { describe, expect, it } from "vitest";
import {
  checkPhotoFile,
  eurosToCents,
  formatCents,
  isOwnPhotoPath,
  MAX_PHOTO_BYTES,
  PHOTO_TOO_LARGE_COPY,
  PHOTO_WRONG_TYPE_COPY,
  PHOTOS_NONE_COPY,
  PHOTOS_TOO_MANY_COPY,
  photoObjectPath,
  SELLER_SUBMISSIONS_BUCKET,
  sellerFieldsFromFormData,
  sellerSubmissionSchema,
} from "../seller-submission";

const SUBMISSION_ID = "3f1c2a4e-7b9d-4e21-9a3c-5d6e7f8a9b0c";
const OTHER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const validFields = {
  name: "Ana Silva",
  email: "  Seller@Example.COM ",
  phone: "",
  title: "Oak side table",
  makerOrBrand: "",
  materials: "Solid oak, linseed oil",
  dimensions: "40 × 30 × 55 cm",
  condition: "vintage",
  askingPrice: "120,50",
  description: "Bought in Porto in the seventies, one small mark on the top.",
  contactConsent: true,
  honeypot: "",
};

const jpeg = { type: "image/jpeg", size: 1024 };
const png = { type: "image/png", size: 2048 };

function issues(input: unknown) {
  const result = sellerSubmissionSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function paths(input: unknown) {
  return issues(input).map(({ path }) => path);
}

describe("sellerSubmissionSchema", () => {
  it("accepts a valid submission, normalising the email and converting the price", () => {
    const result = sellerSubmissionSchema.parse({ fields: validFields, photos: [jpeg, png] });

    expect(result.fields.email).toBe("seller@example.com");
    expect(result.fields.askingPrice).toBe(12050);
  });

  it("rejects zero and seven photos", () => {
    expect(issues({ fields: validFields, photos: [] })).toEqual([
      { path: "photos", message: PHOTOS_NONE_COPY },
    ]);
    expect(issues({ fields: validFields, photos: Array(7).fill(jpeg) })).toEqual([
      { path: "photos", message: PHOTOS_TOO_MANY_COPY },
    ]);
  });

  it("accepts six photos", () => {
    expect(paths({ fields: validFields, photos: Array(6).fill(jpeg) })).toEqual([]);
  });

  it("rejects a 6 MB photo and accepts one of exactly 5 MB", () => {
    expect(
      issues({ fields: validFields, photos: [{ type: "image/jpeg", size: 6 * 1024 * 1024 }] }),
    ).toEqual([{ path: "photos.0.size", message: PHOTO_TOO_LARGE_COPY }]);
    expect(
      paths({ fields: validFields, photos: [{ type: "image/jpeg", size: MAX_PHOTO_BYTES }] }),
    ).toEqual([]);
  });

  it("rejects GIF and PDF files", () => {
    for (const type of ["image/gif", "application/pdf"]) {
      expect(issues({ fields: validFields, photos: [{ type, size: 1024 }] })).toEqual([
        { path: "photos.0.type", message: PHOTO_WRONG_TYPE_COPY },
      ]);
    }
  });

  it("rejects a missing consent", () => {
    expect(paths({ fields: { ...validFields, contactConsent: false }, photos: [jpeg] })).toEqual([
      "fields.contactConsent",
    ]);
  });

  it("flags a filled honeypot", () => {
    expect(paths({ fields: { ...validFields, honeypot: "spam" }, photos: [jpeg] })).toEqual([
      "fields.honeypot",
    ]);
  });

  it.each([
    ["title", "x".repeat(81)],
    ["description", "x".repeat(19)],
    ["phone", "1234"],
    ["condition", "broken"],
    ["name", ""],
    ["materials", ""],
    ["makerOrBrand", "x".repeat(41)],
    ["dimensions", "x".repeat(121)],
  ])("rejects an out-of-bounds %s", (field, value) => {
    expect(paths({ fields: { ...validFields, [field]: value }, photos: [jpeg] })).toEqual([
      `fields.${field}`,
    ]);
  });

  it("rejects a price entered wrongly", () => {
    expect(paths({ fields: { ...validFields, askingPrice: "12.345" }, photos: [jpeg] })).toEqual([
      "fields.askingPrice",
    ]);
  });
});

describe("eurosToCents", () => {
  it.each([
    ["120", 12000],
    ["120.5", 12050],
    ["120.50", 12050],
    ["120,05", 12005],
    ["0", 0],
    [" 45 ", 4500],
  ])("reads %j as %i cents", (input, cents) => {
    expect(eurosToCents(input)).toBe(cents);
  });

  it.each(["12.345", "12.3.4", "-5", "abc", "", "1e3", "€120", "1 200"])("rejects %j", (input) => {
    expect(eurosToCents(input)).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats integer cents as euros", () => {
    expect(formatCents(12050)).toBe("€120.50");
    expect(formatCents(5)).toBe("€0.05");
  });
});

describe("checkPhotoFile", () => {
  it("passes a valid photo and names the problem with an invalid one", () => {
    expect(checkPhotoFile(jpeg)).toBeNull();
    expect(checkPhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toBe(
      PHOTO_TOO_LARGE_COPY,
    );
    expect(checkPhotoFile({ type: "image/gif", size: 1024 })).toBe(PHOTO_WRONG_TYPE_COPY);
    expect(checkPhotoFile({ type: "", size: 1024 })).toBe(PHOTO_WRONG_TYPE_COPY);
  });
});

describe("photo paths", () => {
  it("builds `<id>/<index>.<ext>` from the mime type, never with the bucket name", () => {
    expect(photoObjectPath(SUBMISSION_ID, 0, "image/jpeg")).toBe(`${SUBMISSION_ID}/0.jpg`);
    expect(photoObjectPath(SUBMISSION_ID, 1, "image/png")).toBe(`${SUBMISSION_ID}/1.png`);
    expect(photoObjectPath(SUBMISSION_ID, 5, "image/webp")).toBe(`${SUBMISSION_ID}/5.webp`);
    expect(
      photoObjectPath(SUBMISSION_ID, 0, "image/jpeg").startsWith(`${SELLER_SUBMISSIONS_BUCKET}/`),
    ).toBe(false);
  });

  it("accepts its own paths", () => {
    expect(isOwnPhotoPath(SUBMISSION_ID, `${SUBMISSION_ID}/0.jpg`)).toBe(true);
    expect(isOwnPhotoPath(SUBMISSION_ID, `${SUBMISSION_ID}/5.webp`)).toBe(true);
  });

  it.each([
    `${OTHER_ID}/0.jpg`,
    `seller-submissions/${SUBMISSION_ID}/0.jpg`,
    `${SUBMISSION_ID}/../x/0.jpg`,
    `/${SUBMISSION_ID}/0.jpg`,
    `${SUBMISSION_ID}/6.jpg`,
    `${SUBMISSION_ID}/0.gif`,
  ])("rejects %s", (path) => {
    expect(isOwnPhotoPath(SUBMISSION_ID, path)).toBe(false);
  });
});

describe("sellerFieldsFromFormData", () => {
  it("maps the honeypot and the consent checkbox", () => {
    const fd = new FormData();
    fd.set("name", "Ana");
    fd.set("website", "bot");
    fd.set("contactConsent", "on");

    const fields = sellerFieldsFromFormData(fd);

    expect(fields.name).toBe("Ana");
    expect(fields.honeypot).toBe("bot");
    expect(fields.contactConsent).toBe(true);
    expect(fields.phone).toBe("");
  });
});
