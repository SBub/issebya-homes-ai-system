import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeReminder,
  getDueReminders,
  recordReminderSent,
} from "@/lib/telegram/notifications.js";

describe("notifications client", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NOTIFICATIONS_API_URL = "http://localhost:3004";
    process.env.NOTIFICATIONS_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe("getDueReminders", () => {
    it("throws when not configured, without calling fetch", async () => {
      delete process.env.NOTIFICATIONS_API_URL;
      await expect(getDueReminders()).rejects.toThrow("NOTIFICATIONS_API_URL is not configured");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fetches and parses due reminders with the X-API-Key header", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reminders: [
              {
                key: "rfi_21_2027",
                message: "File RFI-21",
                dueAt: "2027-01-05T09:00:00Z",
                lastMessageId: null,
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const reminders = await getDueReminders();

      expect(reminders).toHaveLength(1);
      expect(reminders[0].key).toBe("rfi_21_2027");
      expect(reminders[0].dueAt).toBeInstanceOf(Date);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3004/api/reminders/due");
      expect(init.headers["X-API-Key"]).toBe("test-key");
    });

    it("throws with the response body on a non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
      await expect(getDueReminders()).rejects.toThrow(/failed \(500\)[\s\S]*boom/);
    });
  });

  describe("acknowledgeReminder", () => {
    it("posts to the key-scoped ack endpoint", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await acknowledgeReminder("rfi 21/2027");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3004/api/reminders/rfi%2021%2F2027/ack");
      expect(init.method).toBe("POST");
    });

    it("throws on a non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
      await expect(acknowledgeReminder("missing")).rejects.toThrow(/failed \(404\)/);
    });
  });

  describe("recordReminderSent", () => {
    it("posts the messageId to the key-scoped sent endpoint", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await recordReminderSent("rfi_21_2027", 42);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3004/api/reminders/rfi_21_2027/sent");
      expect(JSON.parse(init.body)).toEqual({ messageId: 42 });
    });
  });
});
