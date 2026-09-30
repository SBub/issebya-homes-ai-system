import { createProgressStream, parseResumeId, SSE_HEADERS } from "@/lib/sse/progress-stream";

/**
 * GET /api/demo/progress: the live stream behind the `sse-route-handler` doc.
 * No env vars, no database. Reading `request` makes the handler dynamic, so
 * there is no `export const dynamic` (Cache Components rejects it).
 */
export function GET(request: Request) {
  // `EventSource` sends `Last-Event-ID` itself only on its own automatic
  // reconnect. A new `EventSource` after a manual `close()` starts clean, so
  // the demo passes the id it last saw as `?lastEventId=`. The query param
  // wins when both are present.
  const fromId = parseResumeId(
    new URL(request.url).searchParams.get("lastEventId") ?? request.headers.get("last-event-id"),
  );

  return new Response(createProgressStream({ fromId, delayMs: 500, signal: request.signal }), {
    headers: SSE_HEADERS,
  });
}
