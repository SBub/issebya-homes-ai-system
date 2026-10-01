import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { IdempotentWriteDemo } from "./IdempotentWriteDemo";

async function setup() {
  const screen = await render(<IdempotentWriteDemo />);
  return {
    screen,
    record: screen.getByRole("button", { name: "Record reply" }),
    retry: screen.getByRole("button", { name: "Retry the write" }),
    another: screen.getByRole("button", { name: "Reply in another conversation" }),
    zero: screen.getByRole("checkbox", { name: /all-zero trace id/ }),
    accept: screen.getByRole("checkbox", { name: /Accept the zero id/ }),
    noConflict: screen.getByRole("checkbox", { name: /without conflict handling/ }),
    rows: screen.getByLabelText("Messages table").getByRole("row"),
  };
}

test("a retried write returns the existing row and the table keeps one row", async () => {
  const { screen, record, retry, rows } = await setup();
  await record.click();
  await expect.element(screen.getByText(/conversation-1: inserted row 1\./)).toBeVisible();

  await retry.click();
  await expect
    .element(screen.getByText(/conflict on the key, selected existing row 1\./))
    .toBeVisible();
  await expect.element(screen.getByText(/\(1 rows\)/)).toBeVisible();
  // The header row plus one data row.
  expect(rows.elements()).toHaveLength(2);
});

test("another conversation is another trace id and another row", async () => {
  const { screen, record, another } = await setup();
  await record.click();
  await another.click();

  await expect.element(screen.getByText(/conversation-2: inserted row 2\./)).toBeVisible();
  await expect.element(screen.getByText(/\(2 rows\)/)).toBeVisible();
});

test("without conflict handling the retry fails with the unique violation", async () => {
  const { screen, record, retry, noConflict } = await setup();
  await noConflict.click();
  await record.click();
  await retry.click();

  await expect
    .element(screen.getByText(/insert failed: duplicate key value violates unique constraint/))
    .toBeVisible();
});

test("the all-zero trace id is rejected as a key: stored null, reported, no collision", async () => {
  const { screen, record, another, zero } = await setup();
  await zero.click();
  await record.click();

  await expect.element(screen.getByText(/Guard: invalid trace id/)).toBeVisible();
  await another.click();
  await expect.element(screen.getByText(/conversation-2: inserted row 2\./)).toBeVisible();
  const cells = screen.getByLabelText("Messages table").getByRole("cell");
  expect(cells.elements().filter((cell) => cell.textContent === "null")).toHaveLength(2);
});

test("accepting the zero id makes another conversation's reply come back as row 1", async () => {
  const { screen, record, another, zero, accept } = await setup();
  await zero.click();
  await accept.click();
  await record.click();
  await another.click();

  await expect
    .element(screen.getByText(/conversation-2: conflict on the key, selected existing row 1\./))
    .toBeVisible();
  await expect.element(screen.getByText(/\(1 rows\)/)).toBeVisible();
});
