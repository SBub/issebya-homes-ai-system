import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ActionStateDemo } from "./ActionStateDemo";

const SLOW = 5000;

async function setup(delayMs: number) {
  const screen = await render(<ActionStateDemo delayMs={delayMs} />);
  const stepper = (mode: string) => {
    const section = screen.getByRole("region", { name: `${mode} stepper` });
    return {
      add: section.getByRole("button", { name: "Add" }),
      quantity: section.getByLabelText(`${mode} quantity`),
      calls: section.getByRole("listitem"),
      status: section.getByText(/^(Pending|Idle)$/),
    };
  };
  return { screen, stepper };
}

async function clickTimes(button: { click: () => Promise<void> }, times: number) {
  for (let index = 0; index < times; index += 1) await button.click();
}

test("queued: five fast clicks run the reducer five times in order and end at 5", async () => {
  const { stepper } = await setup(200);
  const queued = stepper("queued");

  await clickTimes(queued.add, 5);

  await expect.element(queued.status).toHaveTextContent("Pending");
  await expect.element(queued.quantity, { timeout: SLOW }).toHaveTextContent("5");
  await expect.element(queued.status).toHaveTextContent("Idle");
  await expect.element(queued.calls.nth(4)).toBeVisible();
  const lines = await Promise.all(
    [0, 1, 2, 3, 4].map((index) => queued.calls.nth(index).element().textContent),
  );
  expect(lines.map((line) => line?.replace(/ \(.*\)$/, ""))).toEqual([
    "#1 ADD: saved 1",
    "#2 ADD: saved 2",
    "#3 ADD: saved 3",
    "#4 ADD: saved 4",
    "#5 ADD: saved 5",
  ]);
});

test("queued: the count only moves when a call finishes", async () => {
  const { stepper } = await setup(800);
  const queued = stepper("queued");

  await queued.add.click();

  await expect.element(queued.status).toHaveTextContent("Pending");
  await expect.element(queued.quantity, { timeout: SLOW }).toHaveTextContent("1");
  await expect.element(queued.quantity).toHaveTextContent("1");
});

test("optimistic: the count moves at once, before any reducer call has finished", async () => {
  const { stepper } = await setup(800);
  const optimistic = stepper("optimistic");

  await optimistic.add.click();
  await optimistic.add.click();

  await expect.element(optimistic.quantity).toHaveTextContent("2");
  await expect.element(optimistic.status).toHaveTextContent("Pending");
  expect(optimistic.calls.elements()).toHaveLength(0);
  await expect.element(optimistic.calls.nth(1), { timeout: SLOW }).toBeVisible();
  await expect.element(optimistic.quantity).toHaveTextContent("2");
});

test("cancelling: five fast clicks abort four calls and only the last one is saved", async () => {
  const { stepper } = await setup(800);
  const cancelling = stepper("cancelling");

  await clickTimes(cancelling.add, 5);

  await expect.element(cancelling.quantity).toHaveTextContent("5");
  await expect.element(cancelling.status, { timeout: SLOW }).toHaveTextContent("Idle");
  const lines = await Promise.all(
    [0, 1, 2, 3, 4].map((index) => cancelling.calls.nth(index).element().textContent),
  );
  expect(lines.map((line) => line?.replace(/ (at|\().*$/, ""))).toEqual([
    "#1 ADD: aborted, returned 1",
    "#2 ADD: aborted, returned 2",
    "#3 ADD: aborted, returned 3",
    "#4 ADD: aborted, returned 4",
    "#5 ADD: saved 5",
  ]);
  await expect.element(cancelling.quantity).toHaveTextContent("5");
});

test("form: submitting Add runs the server-side reducer and shows the new quantity", async () => {
  const { screen } = await setup(200);
  const form = screen.getByRole("form", { name: "form stepper" });

  await form.getByRole("button", { name: "Add" }).click();

  await expect
    .element(form.getByLabelText("form quantity"), { timeout: SLOW })
    .toHaveTextContent("1");
  await expect.element(form.getByText(/^Saved at /)).toBeVisible();
});
