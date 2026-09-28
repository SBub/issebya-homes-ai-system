import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  PHOTO_TOO_LARGE_COPY,
  PHOTO_WRONG_TYPE_COPY,
  SELLER_CONTACT_CONSENT_COPY,
  sellerSuccessCopy,
} from "@/lib/shop/seller-submission";

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: (span?: undefined) => unknown) => fn(undefined),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// The Server Functions are the seam between the component and "the server".
const mockPrepare = vi.fn();
const mockSubmit = vi.fn();
vi.mock("../actions", () => ({
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

import { SellerForm } from "./SellerForm";

const SUBMISSION_ID = "3f1c2a4e-7b9d-4e21-9a3c-5d6e7f8a9b0c";

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
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrepare.mockReset();
  mockSubmit.mockReset();
  mockUploadPhoto.mockReset();
});

test("submit stays disabled until the consent box is ticked", async () => {
  const screen = await render(<SellerForm />);

  const submit = screen.getByRole("button", { name: "Send to the owner" });
  await expect.element(submit).toBeDisabled();

  await userEvent.click(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }));

  await expect.element(submit).toBeEnabled();
});

test("a 6 MB photo is rejected the moment it is chosen", async () => {
  const screen = await render(<SellerForm />);

  await userEvent.upload(
    screen.getByLabelText("Photos"),
    photo("big.jpg", "image/jpeg", 6 * 1024 * 1024),
  );

  await expect.element(screen.getByText(`big.jpg: ${PHOTO_TOO_LARGE_COPY}`)).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }));
  await expect.element(screen.getByRole("button", { name: "Send to the owner" })).toBeDisabled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockUploadPhoto).not.toHaveBeenCalled();
});

test("a GIF is rejected with the type error", async () => {
  const screen = await render(<SellerForm />);

  await userEvent.upload(screen.getByLabelText("Photos"), photo("cat.gif", "image/gif"));

  await expect.element(screen.getByText(`cat.gif: ${PHOTO_WRONG_TYPE_COPY}`)).toBeVisible();
});

test("a complete submission uploads each photo and shows the thank-you", async () => {
  const uploads = [
    { path: `${SUBMISSION_ID}/0.jpg`, signedUrl: "https://storage.example/0", token: "a" },
    { path: `${SUBMISSION_ID}/1.png`, signedUrl: "https://storage.example/1", token: "b" },
  ];
  mockPrepare.mockResolvedValue({ kind: "upload", submissionId: SUBMISSION_ID, uploads });
  mockUploadPhoto.mockResolvedValue(undefined);
  mockSubmit.mockResolvedValue({ ok: true });

  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.upload(screen.getByLabelText("Photos"), [
    photo("front.jpg", "image/jpeg"),
    photo("back.png", "image/png"),
  ]);
  await userEvent.click(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }));
  await userEvent.click(screen.getByRole("button", { name: "Send to the owner" }));

  await expect.element(screen.getByText(sellerSuccessCopy("seller@example.com"))).toBeVisible();

  expect(mockPrepare).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Oak side table",
      askingPrice: "120,50",
      contactConsent: true,
    }),
    [
      { type: "image/jpeg", size: 1024 },
      { type: "image/png", size: 1024 },
    ],
  );
  expect(mockUploadPhoto).toHaveBeenCalledTimes(2);
  expect(mockUploadPhoto.mock.calls.map(([url]) => url)).toEqual(
    uploads.map(({ signedUrl }) => signedUrl),
  );
  expect(mockSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ email: "seller@example.com" }),
    SUBMISSION_ID,
    uploads.map(({ path }) => path),
  );
  expect(mockCapture).toHaveBeenCalledWith("seller_submission_created", {
    photo_count: 2,
    condition: "vintage",
  });
});

test("a field error from the server shows under its input and typed values survive", async () => {
  mockPrepare.mockResolvedValue({
    kind: "invalid",
    errors: { title: "Please keep the title under 80 characters" },
    generalError: "",
  });

  const screen = await render(<SellerForm />);
  await fillFields(screen);
  await userEvent.upload(screen.getByLabelText("Photos"), photo("front.jpg", "image/jpeg"));
  await userEvent.click(screen.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }));
  await userEvent.click(screen.getByRole("button", { name: "Send to the owner" }));

  await expect.element(screen.getByText("Please keep the title under 80 characters")).toBeVisible();
  await expect.element(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByLabelText("Title")).toHaveValue("Oak side table");
  await expect.element(screen.getByLabelText("Your name")).toHaveValue("Ana Silva");
  await expect.element(screen.getByText("front.jpg", { exact: true })).toBeVisible();
  expect(mockUploadPhoto).not.toHaveBeenCalled();
});
