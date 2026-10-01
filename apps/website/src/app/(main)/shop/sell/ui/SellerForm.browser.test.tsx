import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  PHOTO_TOO_LARGE_COPY,
  PHOTO_WRONG_TYPE_COPY,
  SELLER_CONTACT_CONSENT_COPY,
  SELLER_ERROR_COPY,
  type SellerWizardState,
  sellerFieldsFromFormData,
  sellerSuccessCopy,
} from "@/lib/shop/seller-submission";

// The Server Functions are the seam between the component and "the server".
const mockDetails = vi.fn();
const mockPrepare = vi.fn();
const mockSubmit = vi.fn();
vi.mock("../actions", () => ({
  sellerDetailsStep: (...args: unknown[]) => mockDetails(...args),
  prepareSellerPhotoUploads: (...args: unknown[]) => mockPrepare(...args),
  submitSellerSubmission: (...args: unknown[]) => mockSubmit(...args),
}));

const mockUploadPhoto = vi.fn();
vi.mock("./upload-photo", () => ({
  uploadPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
}));

const mockCapture = vi.fn();
vi.mock("posthog-js", () => ({
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

// The real `next/image` reaches for `process` at import time, which does not
// exist in a browser. The review step's thumbnails are plain object URLs, so
// a plain <img> keeps the suite independent of the image optimizer.
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { SellerForm } from "./SellerForm";

const SUBMISSION_ID = "3f1c2a4e-7b9d-4e21-9a3c-5d6e7f8a9b0c";

const uploads = [
  { path: `${SUBMISSION_ID}/0.jpg`, signedUrl: "https://storage.example/0", token: "a" },
  { path: `${SUBMISSION_ID}/1.png`, signedUrl: "https://storage.example/1", token: "b" },
];

// What the real `sellerDetailsStep` answers on success: the draft id, the
// typed fields echoed, and the same id again when it was already there.
async function detailsSaved(
  prev: SellerWizardState,
  formData: FormData,
): Promise<SellerWizardState> {
  return {
    ...prev,
    step: "photos",
    submissionId: prev.submissionId ?? SUBMISSION_ID,
    fields: sellerFieldsFromFormData(formData),
    errors: {},
    generalError: "",
    attempt: prev.attempt + 1,
  };
}

function photo(name: string, type: string, size = 1024) {
  return new File([new Uint8Array(size)], name, { type });
}

type Screen = Awaited<ReturnType<typeof render>>;

async function fillFields(screen: Screen) {
  await userEvent.fill(screen.getByLabelText("Your name"), "Ana Silva");
  await userEvent.fill(screen.getByLabelText("Email"), "seller@example.com");
  await userEvent.fill(screen.getByLabelText("Title"), "Oak side table");
  await userEvent.fill(screen.getByLabelText("Materials"), "Solid oak");
  await userEvent.selectOptions(screen.getByLabelText("Condition"), "vintage");
  await userEvent.fill(screen.getByLabelText("Asking price in euros"), "120,50");
  await userEvent.fill(
    screen.getByLabelText("Description"),
    "Bought in Porto in the seventies, one small mark on the top.",
  );
  await userEvent.click(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }));
}

const next = (screen: Screen) => screen.getByRole("button", { name: "Next" });
const photosInput = (screen: Screen) => screen.getByLabelText("Photos", { exact: true });

beforeEach(() => {
  vi.clearAllMocks();
  mockDetails.mockReset();
  mockPrepare.mockReset();
  mockSubmit.mockReset();
  mockUploadPhoto.mockReset();
  mockDetails.mockImplementation(detailsSaved);
  mockPrepare.mockResolvedValue({ kind: "upload", uploads });
  mockUploadPhoto.mockResolvedValue(undefined);
  mockSubmit.mockResolvedValue({ ok: true });
});

test("Next stays disabled until the consent box is ticked", async () => {
  const screen = await render(<SellerForm />);

  await expect.element(next(screen)).toBeDisabled();

  await userEvent.click(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }));

  await expect.element(next(screen)).toBeEnabled();
});

test("the wizard saves a draft, uploads each photo, shows the summary and sends", async () => {
  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.click(next(screen));

  // Step two: the draft exists, the photos go under its id.
  await expect.element(photosInput(screen)).toBeVisible();
  expect(mockDetails).toHaveBeenCalledOnce();
  const [prev, formData] = mockDetails.mock.calls[0] as [SellerWizardState, FormData];
  expect(prev.submissionId).toBeNull();
  expect(formData.get("title")).toBe("Oak side table");
  expect(formData.get("contactConsent")).toBe("on");

  await userEvent.upload(photosInput(screen), [
    photo("front.jpg", "image/jpeg"),
    photo("back.png", "image/png"),
  ]);
  await userEvent.click(next(screen));

  // Step three: the summary and the thumbnails from memory.
  await expect.element(screen.getByRole("button", { name: "Send to the owner" })).toBeVisible();
  await expect.element(screen.getByText("Oak side table")).toBeVisible();
  await expect.element(screen.getByText("€120.50")).toBeVisible();
  await expect.element(screen.getByRole("img", { name: "front.jpg" })).toBeVisible();
  await expect.element(screen.getByRole("img", { name: "back.png" })).toBeVisible();

  expect(mockPrepare).toHaveBeenCalledWith(SUBMISSION_ID, [
    { type: "image/jpeg", size: 1024 },
    { type: "image/png", size: 1024 },
  ]);
  expect(mockUploadPhoto).toHaveBeenCalledTimes(2);
  expect(mockUploadPhoto.mock.calls.map(([url]) => url)).toEqual(
    uploads.map(({ signedUrl }) => signedUrl),
  );
  expect(mockSubmit).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Send to the owner" }));

  await expect.element(screen.getByText(sellerSuccessCopy("seller@example.com"))).toBeVisible();
  expect(mockSubmit).toHaveBeenCalledWith(
    SUBMISSION_ID,
    uploads.map(({ path }) => path),
  );
  expect(mockCapture).toHaveBeenCalledWith("seller_submission_created", {
    photo_count: 2,
    condition: "vintage",
  });
});

test("bad files are rejected the moment they are chosen", async () => {
  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.click(next(screen));

  await userEvent.upload(photosInput(screen), [
    photo("big.jpg", "image/jpeg", 6 * 1024 * 1024),
    photo("cat.gif", "image/gif"),
  ]);

  await expect.element(screen.getByText(`big.jpg: ${PHOTO_TOO_LARGE_COPY}`)).toBeVisible();
  await expect.element(screen.getByText(`cat.gif: ${PHOTO_WRONG_TYPE_COPY}`)).toBeVisible();
  await expect.element(next(screen)).toBeDisabled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockUploadPhoto).not.toHaveBeenCalled();
});

test("Back keeps the typed details and the chosen photos, and Next re-uses the draft", async () => {
  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.click(next(screen));
  await userEvent.upload(photosInput(screen), photo("front.jpg", "image/jpeg"));
  await expect.element(screen.getByText("front.jpg", { exact: true })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Back" }));

  await expect.element(screen.getByLabelText("Your name")).toHaveValue("Ana Silva");
  await expect.element(screen.getByLabelText("Title")).toHaveValue("Oak side table");
  await expect.element(screen.getByLabelText("Asking price in euros")).toHaveValue("120,50");
  await expect
    .element(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }))
    .toBeChecked();

  await userEvent.click(next(screen));

  await expect.element(screen.getByText("front.jpg", { exact: true })).toBeVisible();
  expect(mockDetails).toHaveBeenCalledTimes(2);
  const [again] = mockDetails.mock.calls[1] as [SellerWizardState];
  expect(again.submissionId).toBe(SUBMISSION_ID);
});

test("a double click on Next creates one draft", async () => {
  const screen = await render(<SellerForm />);
  await fillFields(screen);

  await userEvent.dblClick(next(screen));

  await expect.element(photosInput(screen)).toBeVisible();
  // Whatever got through ran one call at a time: only the first saw no id.
  const freshDrafts = mockDetails.mock.calls.filter(
    ([prev]) => (prev as SellerWizardState).submissionId === null,
  );
  expect(freshDrafts).toHaveLength(1);
});

test("a failed step comes back as an error in state, and the next Next still runs", async () => {
  mockDetails.mockRejectedValueOnce(new Error("network"));

  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.click(next(screen));

  await expect.element(screen.getByRole("alert")).toHaveTextContent(SELLER_ERROR_COPY);
  await expect.element(screen.getByLabelText("Title")).toHaveValue("Oak side table");

  await userEvent.click(next(screen));

  await expect.element(photosInput(screen)).toBeVisible();
  expect(mockDetails).toHaveBeenCalledTimes(2);
});

test("a field error from the server shows under its input and typed values survive", async () => {
  mockDetails.mockImplementationOnce(async (prev: SellerWizardState, formData: FormData) => ({
    ...prev,
    step: "details",
    fields: sellerFieldsFromFormData(formData),
    errors: { title: "Please keep the title under 80 characters" },
    generalError: "",
    attempt: prev.attempt + 1,
  }));

  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.click(next(screen));

  await expect.element(screen.getByText("Please keep the title under 80 characters")).toBeVisible();
  await expect.element(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByLabelText("Title")).toHaveValue("Oak side table");
  await expect.element(screen.getByLabelText("Your name")).toHaveValue("Ana Silva");
  expect(mockPrepare).not.toHaveBeenCalled();
});
