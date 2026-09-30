import { describe, expect, it } from "vitest";
import { formatComment, formatEvent } from "../frame";

describe("formatEvent", () => {
  it("writes id, event and data lines and a closing blank line", () => {
    expect(formatEvent({ id: 3, event: "progress", data: { percent: 70 } })).toBe(
      'id: 3\nevent: progress\ndata: {"percent":70}\n\n',
    );
  });

  it("omits the id line when there is no id", () => {
    expect(formatEvent({ event: "done", data: { lastId: 5 } })).toBe(
      'event: done\ndata: {"lastId":5}\n\n',
    );
  });

  it("omits the event line when there is no event name", () => {
    expect(formatEvent({ data: "hi" })).toBe('data: "hi"\n\n');
  });

  it("keeps a newline inside data on one data line", () => {
    expect(formatEvent({ data: "two\nlines" })).toBe('data: "two\\nlines"\n\n');
  });
});

describe("formatComment", () => {
  it("writes a comment line and a blank line", () => {
    expect(formatComment("ping")).toBe(": ping\n\n");
  });
});
