import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ToolFilesDemo } from "./ToolFilesDemo";

async function setup() {
  const screen = await render(<ToolFilesDemo />);
  return {
    screen,
    free: screen.getByRole("button", { name: "check_dates, free" }),
    past: screen.getByRole("button", { name: "check_dates, in the past" }),
    rate: screen.getByRole("button", { name: "lookup_rate", exact: true }),
    badInput: screen.getByRole("button", { name: "lookup_rate, bad input" }),
    unknown: screen.getByRole("button", { name: "book_dates, no such tool" }),
    throwSoft: screen.getByRole("checkbox", { name: /soft failure/ }),
    throwUnknown: screen.getByRole("checkbox", { name: /unknown tool name/ }),
    calls: screen.getByLabelText("Tool calls").getByRole("listitem"),
  };
}

test("a plain call returns the compute result and an ok span", async () => {
  const { free, rate, calls } = await setup();
  await free.click();
  await rate.click();

  await expect
    .element(calls.nth(0))
    .toHaveTextContent('returned {"ok":true,"free":true,"from":"2026-10-06","to":"2026-10-08"}');
  await expect.element(calls.nth(0)).toHaveTextContent("span tool-check_dates: ok");
  await expect
    .element(calls.nth(1))
    .toHaveTextContent('returned {"room":"small","nightly":95,"currency":"EUR"}');
  await expect.element(calls.nth(1)).toHaveTextContent("span tool-lookup_rate: ok");
});

test("a soft failure is returned to the model and the span is marked failed", async () => {
  const { past, badInput, calls } = await setup();
  await past.click();
  await badInput.click();

  await expect
    .element(calls.nth(0))
    .toHaveTextContent('returned {"ok":false,"reason":"past_date","today":"2026-10-01"}');
  await expect.element(calls.nth(0)).toHaveTextContent("span tool-check_dates: error (past_date)");
  await expect
    .element(calls.nth(1))
    .toHaveTextContent('returned {"error":"Invalid input for lookup_rate');
  await expect.element(calls.nth(1)).toHaveTextContent("span tool-lookup_rate: error");
});

test("an unknown tool name comes back as an error object from the dispatcher", async () => {
  const { unknown, calls } = await setup();
  await unknown.click();

  await expect
    .element(calls.nth(0))
    .toHaveTextContent(
      'returned {"error":"Unknown tool name: \\"book_dates\\". Valid tools are: check_dates, lookup_rate."}',
    );
  await expect.element(calls.nth(0)).toHaveTextContent("span tool-book_dates: error");
});

test("the wrong variants end the run and the model gets nothing", async () => {
  const { past, unknown, throwSoft, throwUnknown, calls } = await setup();
  await throwSoft.click();
  await throwUnknown.click();
  await past.click();
  await unknown.click();

  await expect
    .element(calls.nth(0))
    .toHaveTextContent("the run failed: past_date. No tool result reaches the model.");
  await expect
    .element(calls.nth(1))
    .toHaveTextContent(
      'the run failed: Unknown tool "book_dates". No tool result reaches the model.',
    );
  await expect.element(calls.nth(1)).toHaveTextContent("span: none");
});
