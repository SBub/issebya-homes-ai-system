"use client";

import Image from "next/image";
import posthog from "posthog-js";
import {
  type ChangeEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ALLOWED_PHOTO_TYPES,
  checkPhotoFile,
  eurosToCents,
  formatCents,
  initialSellerWizardState,
  MAX_PHOTOS,
  PHOTOS_NONE_COPY,
  PHOTOS_TOO_MANY_COPY,
  SELLER_CONDITION_LABELS,
  SELLER_CONDITIONS,
  SELLER_CONTACT_CONSENT_COPY,
  SELLER_ERROR_COPY,
  SELLER_UPLOAD_ERROR_COPY,
  type SellerCondition,
  type SellerFieldErrors,
  type SellerWizardState,
  type SellerWizardStep,
  sellerFieldsFromFormData,
  sellerSuccessCopy,
} from "@/lib/shop/seller-submission";
import { prepareSellerPhotoUploads, sellerDetailsStep, submitSellerSubmission } from "../actions";
import { uploadPhoto } from "./upload-photo";

// A chosen photo. Files live in component state, not in the wizard state or
// the <form>: they must never reach a Server Function (they go straight to
// Storage), and React resets a <form>, file inputs included, when its action
// ends. `previewUrl` is an object URL for the thumbnails on the review step.
type ChosenPhoto = {
  id: number;
  file: File;
  previewUrl: string;
  error: string | null;
  // Set only while (or after) this photo uploads.
  progress: number | null;
};

// Every forward step is a dispatch with one of these. BACK only moves the step.
type WizardPayload =
  | { type: "DETAILS"; formData: FormData }
  | { type: "PHOTOS"; files: File[] }
  | { type: "SEND" }
  | { type: "BACK" };

type WizardReducer = (
  prevState: SellerWizardState,
  // A <form action> hands the reducer its FormData; the step one form does
  // exactly that, so a bare FormData is the DETAILS payload.
  payload: WizardPayload | FormData,
) => Promise<SellerWizardState>;

const STEPS: { step: SellerWizardStep; label: string }[] = [
  { step: "details", label: "Details" },
  { step: "photos", label: "Photos" },
  { step: "review", label: "Review" },
];

const subscribeToNothing = () => () => {};

// False during the server render and hydration, true from the first browser
// render after that. The consent gate on the step one button is a courtesy
// for browsers running the script: with JavaScript off the server-rendered
// button has to stay enabled, or the plain POST could never happen.
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

const inputClass = (error: string | undefined) =>
  `border px-3 py-2 text-sm bg-transparent w-full ${error ? "border-red-500" : "border-current"}`;

const buttonClass =
  "uppercase tracking-[0.2em] text-xs border border-current px-4 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

type FieldProps = {
  name: keyof SellerFieldErrors;
  label: string;
  error: string | undefined;
  helper?: string;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    className: string;
  }) => ReactNode;
};

// Label, control and error for one field, wired together with stable ids.
function Field({ name, label, error, helper, children }: FieldProps) {
  const id = `seller-${name}`;
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const describedBy = [helper ? helperId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={`seller-${name}-label text-sm`}>
        {label}
      </label>
      {children({
        id,
        name,
        "aria-invalid": !!error,
        "aria-describedby": describedBy || undefined,
        className: inputClass(error),
      })}
      {helper && (
        <span id={helperId} className="text-xs">
          {helper}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-red-500 text-xs">
          {error}
        </span>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: SellerWizardStep }) {
  return (
    <ol
      aria-label="Steps"
      className="flex flex-wrap gap-x-6 gap-y-1 uppercase tracking-[0.2em] text-xs"
    >
      {STEPS.map(({ step, label }, index) => (
        <li
          key={step}
          aria-current={step === current ? "step" : undefined}
          className={step === current ? "" : "opacity-50"}
        >
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function GeneralError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="text-red-500 text-sm" role="alert" aria-live="polite">
      {message}
    </p>
  );
}

type StepProps = {
  state: SellerWizardState;
  dispatch: (payload: WizardPayload | FormData) => void;
  isPending: boolean;
};

/**
 * Step one. A real <form action>, so before hydration or with JavaScript off
 * it posts to `sellerDetailsStep` and the server answers with step two.
 */
function DetailsStep({ state, dispatch, isPending }: StepProps) {
  const hydrated = useHydrated();
  // Seeded from the state so Back keeps the tick. Controlled so Next can stay
  // disabled until it is ticked (once the script runs).
  const [consented, setConsented] = useState(state.fields.contactConsent);
  const { errors, fields, attempt } = state;

  return (
    <form action={dispatch} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-4" disabled={isPending}>
        <legend className="uppercase tracking-[0.2em] text-xs mb-2">About you</legend>

        <Field name="name" label="Your name" error={errors.name}>
          {(props) => (
            // Re-keyed per attempt: React resets an uncontrolled form when the
            // action ends, so the echoed values re-seed it after an error.
            <input
              key={`name-${attempt}`}
              {...props}
              type="text"
              autoComplete="name"
              defaultValue={fields.name}
            />
          )}
        </Field>

        <Field name="email" label="Email" error={errors.email}>
          {(props) => (
            <input
              key={`email-${attempt}`}
              {...props}
              type="email"
              autoComplete="email"
              defaultValue={fields.email}
            />
          )}
        </Field>

        <Field name="phone" label="Phone (optional)" error={errors.phone}>
          {(props) => (
            <input
              key={`phone-${attempt}`}
              {...props}
              type="tel"
              autoComplete="tel"
              defaultValue={fields.phone}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={isPending}>
        <legend className="uppercase tracking-[0.2em] text-xs mb-2">The piece</legend>

        <Field name="title" label="Title" error={errors.title}>
          {(props) => (
            <input key={`title-${attempt}`} {...props} type="text" defaultValue={fields.title} />
          )}
        </Field>

        <Field name="makerOrBrand" label="Maker or brand (optional)" error={errors.makerOrBrand}>
          {(props) => (
            <input
              key={`maker-${attempt}`}
              {...props}
              type="text"
              defaultValue={fields.makerOrBrand}
            />
          )}
        </Field>

        <Field name="materials" label="Materials" error={errors.materials}>
          {(props) => (
            <input
              key={`materials-${attempt}`}
              {...props}
              type="text"
              defaultValue={fields.materials}
            />
          )}
        </Field>

        <Field name="dimensions" label="Dimensions (optional)" error={errors.dimensions}>
          {(props) => (
            <input
              key={`dimensions-${attempt}`}
              {...props}
              type="text"
              placeholder="e.g. 40 × 30 × 90 cm"
              defaultValue={fields.dimensions}
            />
          )}
        </Field>

        <Field name="condition" label="Condition" error={errors.condition}>
          {(props) => (
            <select key={`condition-${attempt}`} {...props} defaultValue={fields.condition}>
              <option value="">Choose one</option>
              {SELLER_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {SELLER_CONDITION_LABELS[condition]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field name="askingPrice" label="Asking price in euros" error={errors.askingPrice}>
          {({ className, ...props }) => (
            <div className="flex items-center gap-2">
              <span aria-hidden="true">€</span>
              <input
                key={`price-${attempt}`}
                {...props}
                className={className}
                type="text"
                inputMode="decimal"
                placeholder="120"
                defaultValue={fields.askingPrice}
              />
            </div>
          )}
        </Field>

        <Field
          name="description"
          label="Description"
          error={errors.description}
          helper="Story, provenance, anything the owner should know"
        >
          {(props) => (
            <textarea
              key={`description-${attempt}`}
              {...props}
              rows={5}
              defaultValue={fields.description}
            />
          )}
        </Field>
      </fieldset>

      {/* Honeypot: off-screen and hidden from assistive tech. Humans never
          fill it; bots that fill every field get a silent success. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label htmlFor="seller-website">Website</label>
        <input
          id="seller-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          name="contactConsent"
          type="checkbox"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-1"
          disabled={isPending}
        />
        {SELLER_CONTACT_CONSENT_COPY}
      </label>
      {errors.contactConsent && (
        <span className="text-red-500 text-xs">{errors.contactConsent}</span>
      )}

      <GeneralError message={state.generalError} />

      <button
        type="submit"
        disabled={isPending || (hydrated && !consented)}
        className={`self-start ${buttonClass}`}
      >
        {isPending ? "Saving…" : "Next"}
      </button>
    </form>
  );
}

type PhotosStepProps = StepProps & {
  photos: ChosenPhoto[];
  notice: string;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: number) => void;
  onBack: () => void;
};

/** Step two. Needs the script: the files go from the browser to Storage. */
function PhotosStep({
  state,
  dispatch,
  isPending,
  photos,
  notice,
  onChoose,
  onRemove,
  onBack,
}: PhotosStepProps) {
  const hasPhotoError = photos.some((p) => p.error);
  const photosError = notice || state.errors.photos;

  return (
    <form
      action={() => dispatch({ type: "PHOTOS", files: photos.map(({ file }) => file) })}
      noValidate
      className="flex flex-col gap-4"
    >
      <fieldset className="flex flex-col gap-2" disabled={isPending}>
        <label htmlFor="seller-photos" className="seller-photos-label text-sm">
          Photos
        </label>
        <input
          // No `name`: the files must never be part of the FormData sent to
          // a Server Function. They live in state and go straight to Storage.
          id="seller-photos"
          type="file"
          multiple
          accept={ALLOWED_PHOTO_TYPES.join(",")}
          onChange={onChoose}
          aria-invalid={!!photosError}
          aria-describedby={`seller-photos-helper${photosError ? " seller-photos-error" : ""}`}
          className="text-sm"
        />
        <span id="seller-photos-helper" className="text-xs">
          Up to {MAX_PHOTOS} photos, JPEG, PNG or WebP, 5 MB each.
        </span>
        {photosError && (
          <span id="seller-photos-error" className="text-red-500 text-xs">
            {photosError}
          </span>
        )}
        <noscript>
          <p className="text-sm">Adding photos needs JavaScript turned on.</p>
        </noscript>

        {photos.length > 0 && (
          <ul aria-label="Chosen photos" className="flex flex-col gap-2 text-sm">
            {photos.map(({ id, file, error, progress }) => (
              <li key={id} className="flex flex-wrap items-center gap-3">
                <span className="truncate max-w-[20ch]">{file.name}</span>
                {error && (
                  <span className="text-red-500 text-xs">
                    {file.name}: {error}
                  </span>
                )}
                {progress !== null && (
                  <progress aria-label={`Uploading ${file.name}`} value={progress} max={1} />
                )}
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  aria-label={`Remove ${file.name}`}
                  className="underline text-xs cursor-pointer"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <GeneralError message={state.generalError} />

      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={isPending} className={buttonClass}>
          Back
        </button>
        <button type="submit" disabled={isPending || hasPhotoError} className={buttonClass}>
          {isPending ? "Uploading…" : "Next"}
        </button>
      </div>
    </form>
  );
}

type ReviewStepProps = StepProps & { photos: ChosenPhoto[]; onBack: () => void };

function conditionLabel(condition: string): string {
  return (SELLER_CONDITIONS as readonly string[]).includes(condition)
    ? SELLER_CONDITION_LABELS[condition as SellerCondition]
    : condition;
}

function priceLabel(askingPrice: string): string {
  const cents = eurosToCents(askingPrice);
  return cents === null ? askingPrice : formatCents(cents);
}

/** Step three. Read-only summary, then Send: only now is the owner emailed. */
function ReviewStep({ state, dispatch, isPending, photos, onBack }: ReviewStepProps) {
  const { fields } = state;
  const rows: [string, string][] = [
    ["Name", fields.name],
    ["Email", fields.email],
    ["Phone", fields.phone || "not given"],
    ["Title", fields.title],
    ["Maker or brand", fields.makerOrBrand || "not given"],
    ["Materials", fields.materials],
    ["Dimensions", fields.dimensions || "not given"],
    ["Condition", conditionLabel(fields.condition)],
    ["Asking price", priceLabel(fields.askingPrice)],
    ["Description", fields.description],
  ];

  return (
    <form action={() => dispatch({ type: "SEND" })} className="flex flex-col gap-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="uppercase tracking-[0.2em] text-xs pt-0.5">{label}</dt>
            <dd className="whitespace-pre-wrap break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {photos.length > 0 ? (
        <ul aria-label="Your photos" className="flex flex-wrap gap-2">
          {photos.map(({ id, file, previewUrl }) => (
            <li key={id}>
              <Image
                src={previewUrl}
                alt={file.name}
                width={96}
                height={96}
                unoptimized
                className="h-24 w-24 object-cover border border-current"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">
          {state.photoPaths.length} {state.photoPaths.length === 1 ? "photo" : "photos"} attached.
        </p>
      )}

      <GeneralError message={state.generalError} />

      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={isPending} className={buttonClass}>
          Back
        </button>
        <button type="submit" disabled={isPending} className={buttonClass}>
          {isPending ? "Sending…" : "Send to the owner"}
        </button>
      </div>
    </form>
  );
}

export function SellerForm() {
  const [photos, setPhotos] = useState<ChosenPhoto[]>([]);
  const [photoNotice, setPhotoNotice] = useState("");
  const nextPhotoId = useRef(0);

  const setProgress = (file: File, progress: number | null) =>
    setPhotos((current) => current.map((p) => (p.file === file ? { ...p, progress } : p)));

  // PHOTOS: the step that needs a browser. Mint URLs under the draft, upload
  // with per-photo progress, and carry the paths forward.
  const uploadPhotos = async (
    prev: SellerWizardState,
    files: File[],
  ): Promise<SellerWizardState> => {
    const fail = (errors: SellerFieldErrors, generalError = ""): SellerWizardState => ({
      ...prev,
      step: "photos",
      errors,
      generalError,
    });

    if (prev.submissionId === null) return fail({}, SELLER_ERROR_COPY);
    // Nothing leaves the browser until the photos pass the same checks the
    // server will run.
    if (files.length === 0) return fail({ photos: PHOTOS_NONE_COPY });
    if (files.length > MAX_PHOTOS) return fail({ photos: PHOTOS_TOO_MANY_COPY });
    if (files.some((file) => checkPhotoFile(file))) return fail({});

    const prepared = await prepareSellerPhotoUploads(
      prev.submissionId,
      files.map(({ type, size }) => ({ type, size })),
    );
    if (prepared.kind === "invalid") return fail(prepared.errors, prepared.generalError);

    try {
      await Promise.all(
        prepared.uploads.map(({ signedUrl }, index) => {
          const file = files[index];
          setProgress(file, 0);
          return uploadPhoto(signedUrl, file, (fraction) => setProgress(file, fraction));
        }),
      );
    } catch {
      // The files stay chosen. Next again asks for fresh URLs under the same draft.
      for (const file of files) setProgress(file, null);
      return fail({}, SELLER_UPLOAD_ERROR_COPY);
    }

    return {
      ...prev,
      step: "review",
      photoPaths: prepared.uploads.map(({ path }) => path),
      errors: {},
      generalError: "",
    };
  };

  // SEND: flip the draft to submitted. The server only flips a draft, so a
  // second Send that gets through changes nothing and sends no second email.
  const send = async (prev: SellerWizardState): Promise<SellerWizardState> => {
    if (prev.step === "done") return prev;
    if (prev.submissionId === null || prev.photoPaths.length === 0) {
      return { ...prev, generalError: SELLER_ERROR_COPY };
    }

    const submitted = await submitSellerSubmission(prev.submissionId, prev.photoPaths);
    if (!submitted.ok) {
      return { ...prev, errors: submitted.errors, generalError: submitted.generalError };
    }

    posthog.capture("seller_submission_created", {
      photo_count: prev.photoPaths.length,
      condition: prev.fields.condition,
    });
    return { ...prev, step: "done", errors: {}, generalError: "" };
  };

  // The one reducer. React runs it one dispatch at a time, each with the
  // state the previous one returned, which is how step two gets the draft id
  // from step one and step three gets the paths from step two. Every branch
  // returns its failure as state: a throw would drop every dispatch queued
  // behind it.
  const runWizard: WizardReducer = async (prev, payload) => {
    const action: WizardPayload =
      payload instanceof FormData ? { type: "DETAILS", formData: payload } : payload;
    try {
      switch (action.type) {
        case "DETAILS":
          try {
            return await sellerDetailsStep(prev, action.formData);
          } catch {
            // The call never answered, so echo what was typed ourselves: React
            // resets the form when this returns, and the inputs re-seed from it.
            return {
              ...prev,
              fields: sellerFieldsFromFormData(action.formData),
              attempt: prev.attempt + 1,
              errors: {},
              generalError: SELLER_ERROR_COPY,
            };
          }
        case "PHOTOS":
          return await uploadPhotos(prev, action.files);
        case "SEND":
          return await send(prev);
        case "BACK":
          if (prev.step !== "photos" && prev.step !== "review") return prev;
          return {
            ...prev,
            step: prev.step === "review" ? "photos" : "details",
            errors: {},
            generalError: "",
          };
      }
    } catch {
      return { ...prev, generalError: SELLER_ERROR_COPY };
    }
  };

  // While this component renders on the server, React needs the Server
  // Function itself here: that is what makes step one a real POST form, so it
  // works before hydration and with JavaScript off, and the server answers
  // with the page on step two. In the browser the reducer is `runWizard`,
  // which calls that same Server Function for DETAILS and adds the branches
  // only a browser can run.
  const [state, dispatch, isPending] = useActionState(
    typeof window === "undefined" ? (sellerDetailsStep as WizardReducer) : runWizard,
    initialSellerWizardState,
  );

  if (state.step === "done") {
    return (
      <p role="status" className="text-sm">
        {sellerSuccessCopy(state.fields.email.trim().toLowerCase())}
      </p>
    );
  }

  const handlePhotosChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    // Cleared so choosing the same file again still fires a change.
    event.target.value = "";

    const room = MAX_PHOTOS - photos.length;
    setPhotoNotice(chosen.length > room ? PHOTOS_TOO_MANY_COPY : "");
    setPhotos([
      ...photos,
      ...chosen.slice(0, Math.max(room, 0)).map((file) => ({
        id: nextPhotoId.current++,
        file,
        previewUrl: URL.createObjectURL(file),
        error: checkPhotoFile(file),
        progress: null,
      })),
    ]);
  };

  const removePhoto = (id: number) => {
    setPhotoNotice("");
    const removed = photos.find((p) => p.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    setPhotos(photos.filter((p) => p.id !== id));
  };

  const back = () => startTransition(() => dispatch({ type: "BACK" }));

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <StepIndicator current={state.step} />
      {state.step === "details" && (
        <DetailsStep state={state} dispatch={dispatch} isPending={isPending} />
      )}
      {state.step === "photos" && (
        <PhotosStep
          state={state}
          dispatch={dispatch}
          isPending={isPending}
          photos={photos}
          notice={photoNotice}
          onChoose={handlePhotosChosen}
          onRemove={removePhoto}
          onBack={back}
        />
      )}
      {state.step === "review" && (
        <ReviewStep
          state={state}
          dispatch={dispatch}
          isPending={isPending}
          photos={photos}
          onBack={back}
        />
      )}
    </div>
  );
}
