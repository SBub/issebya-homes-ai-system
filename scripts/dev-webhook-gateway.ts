/**
 * Single local entry point for every inbound webhook this repo receives, so
 * one ngrok tunnel (one public hostname) can front all of them instead of
 * needing one tunnel per app.
 *
 * The problem this solves: this repo's one reserved ngrok domain
 * (kerchief-coveted-remorse.ngrok-free.dev) can only forward to one local
 * port at a time on this plan (confirmed: a second simultaneous tunnel on
 * the same domain fails with ERR_NGROK_334). Twilio's WhatsApp webhook needs
 * to reach apps/guest-communication-agent (port 3005), Telegram's bot webhook
 * needs to reach apps/telegram-router (port 3003), and GitHub's issue webhook
 * needs to reach the ADW trigger (port 8001) — three different local
 * services, one shared public hostname. Manually re-pointing the
 * tunnel back and forth between them whenever you need another one is
 * exactly the kind of thing that's easy to forget mid-session and silently
 * breaks whichever webhook isn't currently pointed at — this file exists so
 * that never has to happen again.
 *
 * How it works: a plain byte-for-byte HTTP proxy (no body parsing, no new
 * dependency — just node:http) listening on GATEWAY_PORT, routing by URL
 * path prefix to the right upstream app. Twilio's request signature
 * (X-Twilio-Signature) and GitHub's HMAC (X-Hub-Signature-256) are both
 * computed over the exact raw request body, so this must never
 * parse/reserialize it — req.pipe(proxyReq) forwards the original bytes
 * untouched, and `headers: req.headers` forwards
 * X-Twilio-Signature/X-Telegram-Bot-Api-Secret-Token/X-Hub-Signature-256 and
 * X-GitHub-Event as-is so each app's own signature/secret check still passes.
 * Anything added here that reads or rewrites the body breaks all three
 * verifications at once, and the resulting 401s look like wrong secrets
 * rather than a proxy bug.
 *
 * Usage: point ngrok at GATEWAY_PORT instead of any individual app's port
 * (`ngrok http 3010`, same reserved domain as always) — Twilio's
 * TWILIO_WEBHOOK_URL and Telegram's registered webhook URL both stay
 * exactly what they already are (same hostname, same paths); only which
 * local port ngrok forwards to changes. Start whichever upstreams you need
 * first — `yarn dev` for the two apps, `uv run adws/adw_triggers/trigger_webhook.py`
 * for the ADW trigger — then `yarn dev:webhook-gateway` from the repo root.
 * An upstream that is not running answers 502; the others keep working.
 *
 * Adding a fourth inbound webhook later: add one more entry to ROUTES below.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpRequest } from "node:http";

const GATEWAY_PORT = 3010;

const ROUTES: { prefix: string; host: string; port: number; label: string }[] = [
  {
    prefix: "/api/webhook/whatsapp",
    host: "localhost",
    port: 3005,
    label: "Twilio -> guest-communication-agent",
  },
  {
    prefix: "/api/telegram/webhook",
    host: "localhost",
    port: 3003,
    label: "Telegram -> telegram-router",
  },
  {
    prefix: "/gh-webhook",
    host: "localhost",
    port: 8001,
    label: "GitHub -> ADW webhook trigger",
  },
];

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const route = ROUTES.find((r) => req.url?.startsWith(r.prefix));
  if (!route) {
    console.error(`[webhook-gateway] no route configured for ${req.method} ${req.url}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No route configured for this path" }));
    return;
  }

  const proxyReq = httpRequest(
    { host: route.host, port: route.port, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error(
      `[webhook-gateway] upstream ${route.host}:${route.port} (${route.label}) unreachable:`,
      err.message,
    );
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: `Upstream unreachable: ${route.label}` }));
  });

  req.pipe(proxyReq);
}

createServer(handleRequest).listen(GATEWAY_PORT, () => {
  console.log(`[webhook-gateway] listening on :${GATEWAY_PORT}`);
  for (const r of ROUTES) {
    console.log(`  ${r.prefix}* -> http://${r.host}:${r.port} (${r.label})`);
  }
});
