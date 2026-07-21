import { describe, expect, it } from "vitest";
import { extractGuestPhoneFromNotionPage } from "@/lib/notion-phone-sync.js";

describe("extractGuestPhoneFromNotionPage", () => {
  it("extracts guestName + phone when Phone is a phone_number property", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
      Phone: { type: "phone_number", phone_number: "+351920742845" },
    });

    expect(result).toEqual({ guestName: "Jane Doe", phone: "+351920742845" });
  });

  it("extracts guestName + phone when Phone is a rich_text property", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
      Phone: { type: "rich_text", rich_text: [{ plain_text: "+351920742845" }] },
    });

    expect(result).toEqual({ guestName: "Jane Doe", phone: "+351920742845" });
  });

  it("returns null when the Phone property is missing entirely", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
    });

    expect(result).toBeNull();
  });

  it("returns null when Phone (phone_number) is empty/blank", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
      Phone: { type: "phone_number", phone_number: "   " },
    });

    expect(result).toBeNull();
  });

  it("returns null when Phone (rich_text) is empty/blank", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
      Phone: { type: "rich_text", rich_text: [] },
    });

    expect(result).toBeNull();
  });

  it("returns null when Phone (phone_number) is null", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
      Phone: { type: "phone_number", phone_number: null },
    });

    expect(result).toBeNull();
  });

  it("returns null when there's no Name at all", () => {
    const result = extractGuestPhoneFromNotionPage({
      Phone: { type: "phone_number", phone_number: "+351920742845" },
    });

    expect(result).toBeNull();
  });

  it("normalizes away a whatsapp: prefix that somehow ends up in Notion's Phone value", () => {
    const result = extractGuestPhoneFromNotionPage({
      Name: { type: "title", title: [{ plain_text: "Jane Doe" }] },
      Phone: { type: "phone_number", phone_number: "whatsapp:+351920742845" },
    });

    expect(result).toEqual({ guestName: "Jane Doe", phone: "+351920742845" });
  });
});
