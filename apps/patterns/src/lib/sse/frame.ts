/**
 * Server-Sent Events wire format. A frame is a few `field: value` lines ended
 * by a blank line; the browser dispatches nothing until it sees that blank
 * line, and silently drops a malformed frame.
 */

/**
 * One event frame. `data` is JSON-encoded, and JSON never contains a raw
 * newline (it escapes them as `\n`), so one `data:` line is always enough.
 */
export function formatEvent({
  id,
  event,
  data,
}: {
  id?: number | string;
  event?: string;
  data: unknown;
}): string {
  let frame = "";
  if (id !== undefined) frame += `id: ${id}\n`;
  if (event !== undefined) frame += `event: ${event}\n`;
  frame += `data: ${JSON.stringify(data)}\n`;
  return `${frame}\n`;
}

/** A comment line. `EventSource` ignores it; proxies see traffic. */
export function formatComment(text: string): string {
  return `: ${text}\n\n`;
}
