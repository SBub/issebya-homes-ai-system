import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialPost } from "../../../src/lib/social/generate.js";
import {
  createSocialPost,
  notionConfigured,
  postToNotionProperties,
} from "../../../src/lib/social/notion.js";

const post: SocialPost = {
  altText: "issebya homes, rooftop pool, Porto villa, sunset swim",
  caption: "Golden hour never gets old here. #issebyahomes #porto #rooftop #travel #villa",
};

describe("postToNotionProperties", () => {
  it("maps the idea, alt text, and caption", () => {
    const props = postToNotionProperties("Rooftop pool at sunset", post);
    expect(props["Post idea"]).toEqual({
      title: [{ text: { content: "Rooftop pool at sunset" } }],
    });
    expect(props["Alt text"]).toEqual({ rich_text: [{ text: { content: post.altText } }] });
    expect(props.Caption).toEqual({ rich_text: [{ text: { content: post.caption } }] });
  });
});

describe("notionConfigured", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", () => {
    delete process.env.NOTION_API_KEY;
    process.env.NOTION_DATABASE_ID = "db-id";
    expect(notionConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    process.env.NOTION_API_KEY = "key";
    process.env.NOTION_DATABASE_ID = "db-id";
    expect(notionConfigured()).toBe(true);
  });
});

describe("createSocialPost", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NOTION_API_KEY = "test-key";
    process.env.NOTION_DATABASE_ID = "test-db-id";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops (ok: true) when Notion isn't configured, without calling fetch", async () => {
    delete process.env.NOTION_API_KEY;
    const result = await createSocialPost("Rooftop pool at sunset", post);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a page under the configured database, no existing-page lookup", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-page" }), { status: 200 }),
    );

    const result = await createSocialPost("Rooftop pool at sunset", post);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/pages");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties["Post idea"]).toEqual({
      title: [{ text: { content: "Rooftop pool at sunset" } }],
    });
  });

  it("returns ok: false with the error message on failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));

    const result = await createSocialPost("Rooftop pool at sunset", post);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });
});
