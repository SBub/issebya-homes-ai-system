import { describe, expect, it } from "vitest";

import { findAdoptableTunnel } from "../../scripts/dev-adoption";

// Fixtures match the real shape of ngrok's local agent API
// (GET http://127.0.0.1:4040/api/tunnels). findAdoptableTunnel is pure, so
// these are the whole proof: the match rule is what keeps `yarn dev` from
// spawning a second tunnel for a domain `yarn dev:adw` already holds, and
// from adopting a tunnel Twilio's signature check would then reject.

const HOST = "kerchief-coveted-remorse.ngrok-free.dev";

function tunnel(publicUrl: string, addr = "http://localhost:3010") {
  return {
    name: "command_line",
    proto: "https",
    public_url: publicUrl,
    config: { addr, inspect: true },
  };
}

describe("findAdoptableTunnel", () => {
  it("adopts a tunnel whose public host matches, carrying its addr through", () => {
    const payload = { tunnels: [tunnel(`https://${HOST}`)] };

    expect(findAdoptableTunnel(payload, HOST)).toEqual({
      publicUrl: `https://${HOST}`,
      addr: "http://localhost:3010",
    });
  });

  it("does not adopt a tunnel on a different ngrok domain", () => {
    const payload = { tunnels: [tunnel("https://some-other-domain.ngrok-free.dev")] };

    expect(findAdoptableTunnel(payload, HOST)).toBeUndefined();
  });

  it("returns undefined when the agent is up with no tunnels", () => {
    expect(findAdoptableTunnel({ tunnels: [] }, HOST)).toBeUndefined();
  });

  it("returns undefined when the payload is undefined (4040 unreachable)", () => {
    expect(findAdoptableTunnel(undefined, HOST)).toBeUndefined();
  });

  it("skips malformed entries without throwing", () => {
    const payload = {
      tunnels: [
        null,
        { name: "no-public-url", proto: "https" },
        { public_url: "not a url", proto: "https" },
        tunnel(`https://${HOST}`),
      ],
    };

    expect(findAdoptableTunnel(payload, HOST)).toEqual({
      publicUrl: `https://${HOST}`,
      addr: "http://localhost:3010",
    });
  });

  it("returns undefined when every entry is malformed", () => {
    expect(findAdoptableTunnel({ tunnels: [{ public_url: 42 }] }, HOST)).toBeUndefined();
    expect(findAdoptableTunnel({ tunnels: "not-an-array" }, HOST)).toBeUndefined();
  });

  // A host match pointed at the wrong local port is the one adoption case
  // that looks healthy and is not — dev.ts warns on it rather than silently
  // trusting it.
  it("adopts a host match pointed elsewhere, so dev.ts can warn on its addr", () => {
    const payload = { tunnels: [tunnel(`https://${HOST}`, "http://localhost:3005")] };

    expect(findAdoptableTunnel(payload, HOST)).toEqual({
      publicUrl: `https://${HOST}`,
      addr: "http://localhost:3005",
    });
  });

  it("reports addr as undefined when the entry has no config.addr", () => {
    const payload = {
      tunnels: [{ name: "command_line", proto: "https", public_url: `https://${HOST}` }],
    };

    expect(findAdoptableTunnel(payload, HOST)).toEqual({
      publicUrl: `https://${HOST}`,
      addr: undefined,
    });
  });
});
