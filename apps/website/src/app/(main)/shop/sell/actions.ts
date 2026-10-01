"use server";

import { addBreadcrumb, captureException, startSpan } from "@sentry/nextjs";
import { z } from "zod";
import { sendSellerSubmissionNotificationEmail } from "@/lib/resend";
import {
  type CreateDraftResult,
  isAllowedPhotoType,
  isOwnPhotoPath,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_DOWNLOAD_URL_TTL_SECONDS,
  PHOTOS_TOO_MANY_COPY,
  type PrepareResult,
  photoObjectPath,
  SELLER_ERROR_COPY,
  SELLER_SUBMISSIONS_BUCKET,
  SELLER_UPLOAD_ERROR_COPY,
  type SellerFieldErrors,
  type SellerFields,
  type SellerWizardState,
  type SubmitResult,
  sellerFieldsFromFormData,
  sellerFieldsSchema,
  sellerPhotosMetaSchema,
} from "@/lib/shop/seller-submission";
import { createAdminClient } from "@/lib/shared/supabase";
import { type FieldError, formatZodErrors } from "@/lib/shared/validation";

const TABLE = "shop_seller_submissions";

// What `prepareSellerPhotoUploads` accepts: the draft's id and the metadata
// of the photos the browser wants to upload under it.
const prepareSchema = z.object({
  submissionId: z.uuid(),
  photos: sellerPhotosMetaSchema,
});

// What `submitSellerSubmission` accepts. The paths are only shape-checked
// here; `isOwnPhotoPath` and the bucket listing decide whether they are real.
const finalizeSchema = z.object({
  submissionId: z.uuid(),
  photoPaths: z
    .array(z.string())
    .min(1)
    .max(MAX_PHOTOS)
    .refine((paths) => new Set(paths).size === paths.length),
});

function isHoneypot(issues: FieldError[]): boolean {
  return issues.some(({ field }) => field === "honeypot" || field === "fields.honeypot");
}

// First message per field. `fields.title` becomes `title`, and every
// `photos.*` issue collapses onto the one `photos` slot, naming the photo.
function toFieldErrors(issues: FieldError[]): SellerFieldErrors {
  const errors: SellerFieldErrors = {};
  for (const { field, message } of issues) {
    const [head, ...rest] = field.split(".");
    if (head === "photos") {
      errors.photos ??= rest.length ? `Photo ${Number(rest[0]) + 1}: ${message}` : message;
      continue;
    }
    const key = (head === "fields" ? rest[0] : head) as keyof SellerFields | undefined;
    if (key) errors[key] ??= message;
  }
  return errors;
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

const invalid = (generalError: string): { kind: "invalid"; errors: {}; generalError: string } => ({
  kind: "invalid",
  errors: {},
  generalError,
});

/**
 * Step one: validate the text fields and record them as a `draft` row, so the
 * photos have an id to live under before any of them is uploaded. With an
 * existing `submissionId` (Back and Next again, or a second click on Next
 * that arrived after the first returned) the draft is updated, not duplicated.
 */
export async function createSellerDraft(
  fields: SellerFields,
  submissionId: string | null = null,
): Promise<CreateDraftResult> {
  const parsed = sellerFieldsSchema.safeParse(fields);

  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);

    // Checked before any other field, and answered with the success shape and
    // nothing written, so a bot never learns which field gave it away.
    if (isHoneypot(issues)) {
      addBreadcrumb({ category: "shop", message: "Seller form honeypot tripped", level: "info" });
      return { kind: "done" };
    }

    return { kind: "invalid", errors: toFieldErrors(issues), generalError: "" };
  }

  if (submissionId !== null && !z.uuid().safeParse(submissionId).success) {
    return invalid(SELLER_ERROR_COPY);
  }

  const data = parsed.data;
  const row = {
    seller_name: data.name,
    seller_email: data.email,
    seller_phone: emptyToNull(data.phone),
    title: data.title,
    maker_or_brand: emptyToNull(data.makerOrBrand),
    materials: data.materials,
    dimensions: emptyToNull(data.dimensions),
    condition: data.condition,
    asking_price_cents: data.askingPrice,
    description: data.description,
    contact_consent_at: new Date().toISOString(),
    source: "shop_sell_form",
    status: "draft",
  };

  // Only the id and the condition go into Sentry. Never the seller's name,
  // email or phone.
  return startSpan(
    {
      name: "shop.seller_submission.draft",
      op: "http.server",
      attributes: {
        "http.route": "shop.createSellerDraft",
        "shop.submissionId": submissionId ?? "",
        "shop.condition": data.condition,
      },
    },
    async (): Promise<CreateDraftResult> => {
      const supabase = createAdminClient();

      if (submissionId !== null) {
        const { data: updated, error: updateError } = await supabase
          .from(TABLE)
          .update(row)
          .eq("id", submissionId)
          .eq("status", "draft")
          .select("id")
          .maybeSingle();

        if (updateError) {
          captureException(updateError, { tags: { "db.operation": `${TABLE}_update` } });
          return invalid(SELLER_ERROR_COPY);
        }
        if (updated) return { kind: "draft", submissionId };

        // No draft under that id (already sent, or never ours): start a fresh
        // one rather than strand the seller on an id that can never work.
        addBreadcrumb({
          category: "shop",
          message: "Seller draft id had no draft row; starting a new draft",
          level: "warning",
          data: { submissionId },
        });
      }

      const id = crypto.randomUUID();
      const { error: insertError } = await supabase.from(TABLE).insert({
        id,
        ...row,
        // Attached in step three. The table allows an empty list on a draft.
        photo_paths: [],
      });

      if (insertError) {
        captureException(insertError, { tags: { "db.operation": `${TABLE}_insert` } });
        return invalid(SELLER_ERROR_COPY);
      }

      return { kind: "draft", submissionId: id };
    },
  );
}

/**
 * Step two: the draft exists, so mint one signed upload URL per photo at a
 * path the server picks under the draft's id. Nothing is minted unless the
 * photo metadata passes and the row really is a draft of ours.
 */
export async function prepareSellerPhotoUploads(
  submissionId: string,
  photosMeta: { type: string; size: number }[],
): Promise<PrepareResult> {
  // A hard ceiling on URLs per request, independent of the schema.
  if (!Array.isArray(photosMeta) || photosMeta.length > MAX_PHOTOS) {
    return { kind: "invalid", errors: { photos: PHOTOS_TOO_MANY_COPY }, generalError: "" };
  }

  const parsed = prepareSchema.safeParse({ submissionId, photos: photosMeta });

  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);
    if (issues.some(({ field }) => field === "submissionId")) return invalid(SELLER_ERROR_COPY);
    return { kind: "invalid", errors: toFieldErrors(issues), generalError: "" };
  }

  const { photos } = parsed.data;

  return startSpan(
    {
      name: "shop.seller_submission.prepare",
      op: "http.server",
      attributes: {
        "http.route": "shop.prepareSellerPhotoUploads",
        "shop.submissionId": submissionId,
        "shop.photoCount": photos.length,
      },
    },
    async (): Promise<PrepareResult> => {
      const supabase = createAdminClient();

      const { data: draft, error: draftError } = await supabase
        .from(TABLE)
        .select("id")
        .eq("id", submissionId)
        .eq("status", "draft")
        .maybeSingle();

      if (draftError) {
        captureException(draftError, { tags: { "db.operation": `${TABLE}_select` } });
        return invalid(SELLER_ERROR_COPY);
      }
      if (!draft) {
        addBreadcrumb({
          category: "shop",
          message: "Seller photo uploads refused: no draft under that id",
          level: "warning",
          data: { submissionId },
        });
        return invalid(SELLER_ERROR_COPY);
      }

      const bucket = supabase.storage.from(SELLER_SUBMISSIONS_BUCKET);

      const results = await Promise.all(
        photos.map(async ({ type }, index) => {
          const path = photoObjectPath(submissionId, index, type);
          const { data, error } = await bucket.createSignedUploadUrl(path);
          return { path, data, error };
        }),
      );

      const failed = results.find(({ error, data }) => error || !data);
      if (failed) {
        captureException(failed.error ?? new Error("No signed upload URL returned"), {
          tags: { "storage.operation": "create_signed_upload_url" },
        });
        return invalid(SELLER_ERROR_COPY);
      }

      return {
        kind: "upload",
        uploads: results.map(({ path, data }) => ({
          path,
          signedUrl: data?.signedUrl ?? "",
          token: data?.token ?? "",
        })),
      };
    },
  );
}

/**
 * Step three: the photos are in the bucket. Confirm every claimed path
 * belongs to this submission and really exists within the limits, attach
 * them and flip the draft to `submitted`, then tell the owner. The email is
 * best effort. Only a row still in `draft` flips, so a second Send (a retry,
 * a double click) changes nothing and sends no second email.
 */
export async function submitSellerSubmission(
  submissionId: string,
  photoPaths: string[],
): Promise<SubmitResult> {
  const failure = (generalError: string): SubmitResult => ({ ok: false, errors: {}, generalError });

  const parsedRefs = finalizeSchema.safeParse({ submissionId, photoPaths });
  if (!parsedRefs.success) return failure(SELLER_ERROR_COPY);

  // Only paths the prepare step could have minted for this very submission.
  if (!parsedRefs.data.photoPaths.every((path) => isOwnPhotoPath(submissionId, path))) {
    addBreadcrumb({
      category: "shop",
      message: "Seller submission refused a photo path outside its own prefix",
      level: "warning",
      data: { submissionId },
    });
    return failure(SELLER_ERROR_COPY);
  }

  const paths = [...parsedRefs.data.photoPaths].sort();

  // Only the id and the photo count go into Sentry. Never the seller's name,
  // email or phone.
  return startSpan(
    {
      name: "shop.seller_submission.submit",
      op: "http.server",
      attributes: {
        "http.route": "shop.submitSellerSubmission",
        "shop.submissionId": submissionId,
        "shop.photoCount": paths.length,
      },
    },
    async (): Promise<SubmitResult> => {
      const supabase = createAdminClient();
      const bucket = supabase.storage.from(SELLER_SUBMISSIONS_BUCKET);

      // Existence check against what Storage actually recorded, not what the
      // browser claims. The bucket enforces size and type on upload too.
      const { data: objects, error: listError } = await bucket.list(submissionId, { limit: 100 });

      if (listError || !objects) {
        captureException(listError ?? new Error("No listing returned"), {
          tags: { "storage.operation": "list" },
        });
        return failure(SELLER_ERROR_COPY);
      }

      const stored = new Map(objects.map((object) => [`${submissionId}/${object.name}`, object]));
      const allUploaded = paths.every((path) => {
        const metadata = stored.get(path)?.metadata;
        return (
          typeof metadata?.size === "number" &&
          metadata.size <= MAX_PHOTO_BYTES &&
          typeof metadata.mimetype === "string" &&
          isAllowedPhotoType(metadata.mimetype)
        );
      });

      if (!allUploaded) return failure(SELLER_UPLOAD_ERROR_COPY);

      const { data: row, error: updateError } = await supabase
        .from(TABLE)
        .update({ photo_paths: paths, status: "submitted" })
        .eq("id", submissionId)
        .eq("status", "draft")
        .select(
          "seller_name, seller_email, seller_phone, title, maker_or_brand, materials, dimensions, condition, asking_price_cents, description",
        )
        .maybeSingle();

      if (updateError) {
        captureException(updateError, { tags: { "db.operation": `${TABLE}_update` } });
        return failure(SELLER_ERROR_COPY);
      }

      if (!row) {
        // Nothing flipped. Already sent (a retry of the same Send): the owner
        // has had the email, so this is a success. No row at all: refuse.
        const { data: existing } = await supabase
          .from(TABLE)
          .select("status")
          .eq("id", submissionId)
          .maybeSingle();
        return existing && existing.status !== "draft" ? { ok: true } : failure(SELLER_ERROR_COPY);
      }

      try {
        const { data: signed, error: signError } = await bucket.createSignedUrls(
          paths,
          PHOTO_DOWNLOAD_URL_TTL_SECONDS,
        );
        if (signError || !signed) throw signError ?? new Error("No signed URLs returned");
        const photoUrls = signed.map(({ signedUrl }) => signedUrl);
        if (!photoUrls.every((url): url is string => typeof url === "string")) {
          throw new Error("A photo could not be signed for download");
        }

        await sendSellerSubmissionNotificationEmail(
          {
            sellerName: row.seller_name,
            sellerEmail: row.seller_email,
            sellerPhone: row.seller_phone,
            title: row.title,
            makerOrBrand: row.maker_or_brand,
            materials: row.materials,
            dimensions: row.dimensions,
            condition: row.condition,
            askingPriceCents: row.asking_price_cents,
            description: row.description,
          },
          photoUrls,
        );
      } catch (error) {
        // The submission is saved; the owner still sees it in Studio.
        console.error("Seller submission notification failed", error);
        captureException(error, { tags: { "email.type": "seller_submission_notification" } });
      }

      return { ok: true };
    },
  );
}

/**
 * The details step as the wizard reducer sees it: `(prevState, formData)` in,
 * the next wizard state out. It is a Server Function so that React can render
 * step one as a plain POST form. Before hydration, or with JavaScript off, the
 * browser posts here, the draft is created, and the page comes back on step
 * two. With JavaScript the client reducer calls it the same way.
 *
 * `prevState` arrives from the browser, so it is input like any field: only
 * the pieces the next state needs are read from it, and the id is validated
 * again by `createSellerDraft`.
 */
export async function sellerDetailsStep(
  prevState: SellerWizardState,
  formData: FormData,
): Promise<SellerWizardState> {
  const fields = sellerFieldsFromFormData(formData);
  const previousId = typeof prevState?.submissionId === "string" ? prevState.submissionId : null;
  const attempt = (Number.isInteger(prevState?.attempt) ? prevState.attempt : 0) + 1;
  const photoPaths = Array.isArray(prevState?.photoPaths)
    ? prevState.photoPaths.filter((path): path is string => typeof path === "string")
    : [];
  const base = { submissionId: previousId, fields, photoPaths, attempt };

  try {
    const result = await createSellerDraft(fields, previousId);

    if (result.kind === "done") return { ...base, step: "done", errors: {}, generalError: "" };
    if (result.kind === "invalid") {
      return { ...base, step: "details", errors: result.errors, generalError: result.generalError };
    }
    return {
      ...base,
      step: "photos",
      submissionId: result.submissionId,
      errors: {},
      generalError: "",
    };
  } catch (error) {
    captureException(error, { tags: { "http.route": "shop.sellerDetailsStep" } });
    return { ...base, step: "details", errors: {}, generalError: SELLER_ERROR_COPY };
  }
}
