import { describe, expect, it } from "vitest";
import { blobUrl, rawUrl } from "../links";

const SHA = "a1410c6b3afa1ac500fc7018ca1ad42d5956e3b0";
const PATH = "apps/website/src/app/(main)/shop/page.tsx";
const entry = { path: PATH, ref: SHA };

describe("GitHub links", () => {
  it("builds the blob URL at the pinned ref", () => {
    expect(blobUrl(entry)).toBe(
      `https://github.com/SBub/issebya-homes-ai-system/blob/${SHA}/${PATH}`,
    );
  });

  it("builds the raw URL at the pinned ref", () => {
    expect(rawUrl(entry)).toBe(
      `https://raw.githubusercontent.com/SBub/issebya-homes-ai-system/${SHA}/${PATH}`,
    );
  });

  it("encodes square brackets in a segment", () => {
    expect(blobUrl({ ...entry, path: "apps/website/src/app/p/[slug]/page.tsx" })).toContain(
      "/apps/website/src/app/p/%5Bslug%5D/page.tsx",
    );
  });
});
