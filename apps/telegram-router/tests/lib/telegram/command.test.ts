import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isCronListCommand,
  isHeartbeatCommand,
  parseSocialCommand,
} from "@/lib/telegram/command.js";
import type { TelegramUpdate } from "@/lib/telegram/telegram.js";

function update(text: string | undefined, chatId = 992297288): TelegramUpdate {
  return {
    update_id: 1,
    message: text === undefined ? undefined : { message_id: 1, chat: { id: chatId }, text },
  };
}

describe("parseSocialCommand", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = "992297288";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("extracts the idea after /social", () => {
    expect(parseSocialCommand(update("/social Rooftop pool at sunset"))).toBe(
      "Rooftop pool at sunset",
    );
  });

  it("is case-insensitive", () => {
    expect(parseSocialCommand(update("/SOCIAL Rooftop pool"))).toBe("Rooftop pool");
  });

  it("strips a trailing @BotName suffix (group chat mention)", () => {
    expect(parseSocialCommand(update("/social@IssebyaBot Rooftop pool"))).toBe("Rooftop pool");
  });

  it("captures multi-line idea text", () => {
    expect(parseSocialCommand(update("/social Rooftop pool\nfilmed at sunset"))).toBe(
      "Rooftop pool\nfilmed at sunset",
    );
  });

  it("collapses extra leading whitespace before the idea", () => {
    expect(parseSocialCommand(update("/social    Rooftop pool"))).toBe("Rooftop pool");
  });

  it("returns null when there's no text message", () => {
    expect(parseSocialCommand(update(undefined))).toBeNull();
  });

  it("returns null when the message isn't from the configured chat", () => {
    expect(parseSocialCommand(update("/social Rooftop pool", 1))).toBeNull();
  });

  it("returns null when TELEGRAM_CHAT_ID isn't configured", () => {
    delete process.env.TELEGRAM_CHAT_ID;
    expect(parseSocialCommand(update("/social Rooftop pool"))).toBeNull();
  });

  it("returns null when the text isn't a /social command", () => {
    expect(parseSocialCommand(update("hello there"))).toBeNull();
  });

  it("returns null when /social has no idea text after it", () => {
    expect(parseSocialCommand(update("/social"))).toBeNull();
  });

  it("returns null when /social is followed only by whitespace", () => {
    expect(parseSocialCommand(update("/social    "))).toBeNull();
  });
});

describe("isCronListCommand", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = "992297288";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("matches /cron list", () => {
    expect(isCronListCommand(update("/cron list"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCronListCommand(update("/CRON LIST"))).toBe(true);
  });

  it("matches a bot-mention between /cron and list", () => {
    expect(isCronListCommand(update("/cron@IssebyaBot list"))).toBe(true);
  });

  it("returns false when there's no text message", () => {
    expect(isCronListCommand(update(undefined))).toBe(false);
  });

  it("returns false when the message isn't from the configured chat", () => {
    expect(isCronListCommand(update("/cron list", 1))).toBe(false);
  });

  it("returns false when TELEGRAM_CHAT_ID isn't configured", () => {
    delete process.env.TELEGRAM_CHAT_ID;
    expect(isCronListCommand(update("/cron list"))).toBe(false);
  });

  it("returns false for /cron without list", () => {
    expect(isCronListCommand(update("/cron"))).toBe(false);
  });

  it("returns false for unrelated text", () => {
    expect(isCronListCommand(update("hello there"))).toBe(false);
  });
});

describe("isHeartbeatCommand", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = "992297288";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("matches /heartbeat", () => {
    expect(isHeartbeatCommand(update("/heartbeat"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHeartbeatCommand(update("/HEARTBEAT"))).toBe(true);
  });

  it("matches a bot-mention suffix", () => {
    expect(isHeartbeatCommand(update("/heartbeat@IssebyaBot"))).toBe(true);
  });

  it("returns false when there's no text message", () => {
    expect(isHeartbeatCommand(update(undefined))).toBe(false);
  });

  it("returns false when the message isn't from the configured chat", () => {
    expect(isHeartbeatCommand(update("/heartbeat", 1))).toBe(false);
  });

  it("returns false when TELEGRAM_CHAT_ID isn't configured", () => {
    delete process.env.TELEGRAM_CHAT_ID;
    expect(isHeartbeatCommand(update("/heartbeat"))).toBe(false);
  });

  it("returns false for /heartbeat with trailing text", () => {
    expect(isHeartbeatCommand(update("/heartbeat now"))).toBe(false);
  });

  it("returns false for unrelated text", () => {
    expect(isHeartbeatCommand(update("hello there"))).toBe(false);
  });

  it("does not match /digest", () => {
    expect(isHeartbeatCommand(update("/digest"))).toBe(false);
  });
});
