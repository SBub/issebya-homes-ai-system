import { describe, expect, it } from "vitest";
import { blobUrl, pullUrl, rawUrl } from "../links";

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

  it("builds blob, raw and pull URLs for another repo", () => {
    const foreign = { ...entry, path: "src/data/realtime.ts", repo: "SBub/adw-dashboard" };
    expect(blobUrl(foreign)).toBe(
      `https://github.com/SBub/adw-dashboard/blob/${SHA}/src/data/realtime.ts`,
    );
    expect(rawUrl(foreign)).toBe(
      `https://raw.githubusercontent.com/SBub/adw-dashboard/${SHA}/src/data/realtime.ts`,
    );
    expect(pullUrl(111, "SBub/adw-dashboard")).toBe(
      "https://github.com/SBub/adw-dashboard/pull/111",
    );
  });

  it("defaults the pull URL to this repo", () => {
    expect(pullUrl(164)).toBe("https://github.com/SBub/issebya-homes-ai-system/pull/164");
  });
});
