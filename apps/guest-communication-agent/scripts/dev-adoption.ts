import net from "node:net";

// Probes for the two repo-level processes `yarn dev` shares with
// `yarn dev:adw` (the webhook gateway and the ngrok tunnel), kept out of
// dev.ts because dev.ts calls main() at module scope — importing it from a
// test would start Supabase, three dev servers and a tunnel.

export type AdoptableTunnel = { publicUrl: string; addr: string | undefined };

/**
 * The one tunnel that is safe to adopt is the one whose public host equals
 * the TWILIO_WEBHOOK_URL host: Twilio's signature (route.ts's
 * verifyTwilioSignature) is computed against that exact public URL, so a
 * tunnel on any other domain would leave every inbound webhook failing its
 * signature check instead of failing loudly here.
 */
export function findAdoptableTunnel(payload: unknown, host: string): AdoptableTunnel | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { tunnels } = payload as { tunnels?: unknown };
  if (!Array.isArray(tunnels)) return undefined;

  for (const entry of tunnels) {
    if (typeof entry !== "object" || entry === null) continue;
    const { public_url: publicUrl, config } = entry as { public_url?: unknown; config?: unknown };
    if (typeof publicUrl !== "string") continue;

    let entryHost: string;
    try {
      entryHost = new URL(publicUrl).host;
    } catch {
      continue;
    }
    if (entryHost !== host) continue;

    const addr =
      typeof config === "object" && config !== null
        ? (config as { addr?: unknown }).addr
        : undefined;
    return { publicUrl, addr: typeof addr === "string" ? addr : undefined };
  }

  return undefined;
}

/**
 * ngrok's local agent API. No agent running is the common case, so every
 * failure resolves `undefined` silently rather than warning.
 */
export async function fetchNgrokTunnels(timeoutMs = 1000): Promise<unknown> {
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function isPortListening(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}
