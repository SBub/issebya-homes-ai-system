import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const URL_BASE = "http://localhost/api/demo/progress";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Reads the whole body, advancing fake time between chunks. */
async function readAll(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(500);
    const { done, value } = await pending;
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

const progress = (id: number, percent: number, step: string) =>
  `id: ${id}\nevent: progress\ndata: {"percent":${percent},"step":"${step}"}\n\n`;

const ping = ": ping\n\n";

const ids = (body: string) => [...body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));

describe("GET /api/demo/progress", () => {
  it("emits the exact frames", async () => {
    const body = await readAll(GET(new Request(URL_BASE)));

    expect(body).toBe(
      progress(1, 10, "Request received") +
        ping +
        progress(2, 30, "Checking dates") +
        ping +
        progress(3, 70, "Holding the room") +
        ping +
        progress(4, 90, "Taking payment") +
        ping +
        progress(5, 100, "Confirmed") +
        'event: done\ndata: {"lastId":5}\n\n',
    );
  });

  it("sets the SSE headers", () => {
    const response = GET(new Request(URL_BASE));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("ends with done and ids increase 1..5", async () => {
    const body = await readAll(GET(new Request(URL_BASE)));

    expect(ids(body)).toEqual([1, 2, 3, 4, 5]);
    expect(body.endsWith('event: done\ndata: {"lastId":5}\n\n')).toBe(true);
  });

  it("resumes after ?lastEventId=2", async () => {
    const body = await readAll(GET(new Request(`${URL_BASE}?lastEventId=2`)));

    expect(ids(body)).toEqual([3, 4, 5]);
    expect(body).toContain("event: done");
  });

  it("honours the Last-Event-ID header when there is no query param", async () => {
    const body = await readAll(GET(new Request(URL_BASE, { headers: { "Last-Event-ID": "4" } })));

    expect(ids(body)).toEqual([5]);
  });

  it("prefers the query param over the header", async () => {
    const body = await readAll(
      GET(new Request(`${URL_BASE}?lastEventId=1`, { headers: { "Last-Event-ID": "4" } })),
    );

    expect(ids(body)).toEqual([2, 3, 4, 5]);
  });

  it.each(["abc", "-1", ""])("ignores a garbage resume id %j", async (value) => {
    const body = await readAll(GET(new Request(`${URL_BASE}?lastEventId=${value}`)));

    expect(ids(body)).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(["5", "99"])("sends only done after lastEventId=%s", async (value) => {
    const body = await readAll(GET(new Request(`${URL_BASE}?lastEventId=${value}`)));

    expect(body).toBe('event: done\ndata: {"lastId":5}\n\n');
  });

  it("stops emitting on abort", async () => {
    const controller = new AbortController();
    const response = GET(new Request(URL_BASE, { signal: controller.signal }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = reader.read();
    await vi.advanceTimersByTimeAsync(500);
    let text = decoder.decode((await first).value);

    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text.match(/event: progress/g)).toHaveLength(1);
    expect(text).not.toContain("event: done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer when the reader cancels", async () => {
    const reader = GET(new Request(URL_BASE)).body!.getReader();

    await reader.cancel();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not throw when aborted after done", async () => {
    const controller = new AbortController();
    const body = await readAll(GET(new Request(URL_BASE, { signal: controller.signal })));

    expect(() => controller.abort()).not.toThrow();
    expect(body).toContain("event: done");
  });

  it("closes at once when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const body = await readAll(GET(new Request(URL_BASE, { signal: controller.signal })));

    expect(body).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});
