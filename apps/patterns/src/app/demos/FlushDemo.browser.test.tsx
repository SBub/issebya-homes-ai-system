import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { FlushDemo } from "./FlushDemo";

async function setup() {
  const screen = await render(<FlushDemo delayMs={200} />);
  return {
    screen,
    send: screen.getByRole("button", { name: "Send a request" }),
    flush: screen.getByRole("combobox", { name: "Flush" }),
    backend: screen.getByLabelText("Backend").getByRole("listitem"),
    requests: screen.getByLabelText("Requests").getByRole("listitem"),
  };
}

test("with no flush the freeze drops every span and nothing reaches the backend", async () => {
  const { screen, send, requests } = await setup();
  await send.click();

  await expect
    .element(requests.nth(0))
    .toHaveTextContent(/none: 200 in \d+ ms, then 0 exported, 3 dropped/);
  await expect.element(screen.getByText("Nothing arrived.")).toBeVisible();
  await expect
    .element(screen.getByText(/0 exported in 0 flushes, 3 dropped by a freeze/))
    .toBeVisible();
});

test("a flush in after() lands every span and the response does not wait for the round trip", async () => {
  const { screen, send, flush, backend, requests } = await setup();
  await flush.selectOptions("after");
  await send.click();

  await expect
    .element(requests.nth(0))
    .toHaveTextContent(/after: 200 in \d+ ms, then 3 exported, 0 dropped/);
  await expect.element(backend.nth(2)).toHaveTextContent("handle-request");
  expect(backend.elements().map((element) => element.textContent)).toEqual([
    "load-item",
    "render",
    "handle-request",
  ]);
  const text = requests.nth(0).element().textContent ?? "";
  const ms = Number(/in (\d+) ms/.exec(text)?.[1]);
  expect(ms).toBeLessThan(200);
  await expect.element(screen.getByText(/3 exported in 1 flush, 0 dropped/)).toBeVisible();
});

test("a flush before the response lands every span and the response waits for the round trip", async () => {
  const { send, flush, requests } = await setup();
  await flush.selectOptions("before-response");
  await send.click();

  await expect
    .element(requests.nth(0))
    .toHaveTextContent(/before-response: 200 in \d+ ms, then 3 exported, 0 dropped/);
  const text = requests.nth(0).element().textContent ?? "";
  const ms = Number(/in (\d+) ms/.exec(text)?.[1]);
  expect(ms).toBeGreaterThanOrEqual(200);
});

test("the toggle changes what the next request does, and the backend keeps what landed", async () => {
  const { screen, send, flush, requests } = await setup();
  await send.click();
  await expect.element(requests.nth(0)).toBeVisible();
  await flush.selectOptions("after");
  await send.click();

  await expect
    .element(requests.nth(1))
    .toHaveTextContent(/after: 200 in \d+ ms, then 3 exported, 3 dropped/);
  await expect
    .element(screen.getByText(/3 exported in 1 flush, 3 dropped by a freeze/))
    .toBeVisible();
});
