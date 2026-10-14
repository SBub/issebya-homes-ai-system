import { describe, expect, test, vi } from "vitest";
import {
  type AnalyticsBrowser,
  type AnalyticsClient,
  type AnalyticsEnv,
  internalTagAction,
  startAnalytics,
} from "../analytics";

const PRODUCTION: AnalyticsEnv = {
  vercelEnv: "production",
  projectToken: "phc_test",
  host: "https://eu.i.posthog.com",
};

const BROWSER: AnalyticsBrowser = { webdriver: false, search: "" };

// `init` runs `onLoaded` synchronously, as posthog-js does from `_loaded`.
function fakeClient() {
  const client = {
    init: vi.fn<AnalyticsClient["init"]>((_token, _host, onLoaded) => onLoaded()),
    register: vi.fn<AnalyticsClient["register"]>(),
    unregister: vi.fn<AnalyticsClient["unregister"]>(),
  };
  return client;
}

describe("startAnalytics init gate", () => {
  test("initialises on production with both variables set", () => {
    const client = fakeClient();

    expect(startAnalytics(PRODUCTION, BROWSER, client)).toBe(true);
    expect(client.init).toHaveBeenCalledOnce();
    expect(client.init).toHaveBeenCalledWith(
      "phc_test",
      "https://eu.i.posthog.com",
      expect.any(Function),
    );
  });

  test.each(["preview", "development", undefined])(
    "skips silently when vercelEnv is %s",
    (vercelEnv) => {
      const client = fakeClient();
      let started: boolean | undefined;

      expect(() => {
        started = startAnalytics({ ...PRODUCTION, vercelEnv }, BROWSER, client);
      }).not.toThrow();
      expect(started).toBe(false);
      expect(client.init).not.toHaveBeenCalled();
    },
  );

  test("skips when the project token is missing", () => {
    const client = fakeClient();

    expect(startAnalytics({ ...PRODUCTION, projectToken: undefined }, BROWSER, client)).toBe(false);
    expect(startAnalytics({ ...PRODUCTION, projectToken: "" }, BROWSER, client)).toBe(false);
    expect(client.init).not.toHaveBeenCalled();
  });

  test("skips when the host is missing", () => {
    const client = fakeClient();

    expect(startAnalytics({ ...PRODUCTION, host: undefined }, BROWSER, client)).toBe(false);
    expect(client.init).not.toHaveBeenCalled();
  });

  test("skips when there is no browser", () => {
    const client = fakeClient();

    expect(startAnalytics(PRODUCTION, undefined, client)).toBe(false);
    expect(client.init).not.toHaveBeenCalled();
  });
});

describe("internalTagAction", () => {
  test.each([
    ["?internal=1", "tag"],
    ["?internal=0", "untag"],
    ["?internal=yes", null],
    ["?internal=", null],
    ["?INTERNAL=1", null],
    ["?internal=1&internal=0", "tag"],
    ["", null],
  ])("%j is %s", (search, expected) => {
    expect(internalTagAction(search)).toBe(expected);
  });
});

describe("startAnalytics tags", () => {
  test("?internal=1 registers internal", () => {
    const client = fakeClient();

    startAnalytics(PRODUCTION, { ...BROWSER, search: "?internal=1" }, client);

    expect(client.register).toHaveBeenCalledExactlyOnceWith({ internal: true });
    expect(client.unregister).not.toHaveBeenCalled();
  });

  test("?internal=0 unregisters internal", () => {
    const client = fakeClient();

    startAnalytics(PRODUCTION, { ...BROWSER, search: "?internal=0" }, client);

    expect(client.unregister).toHaveBeenCalledExactlyOnceWith("internal");
    expect(client.register).not.toHaveBeenCalled();
  });

  test.each(["?internal=yes", ""])("%j neither tags nor untags", (search) => {
    const client = fakeClient();

    startAnalytics(PRODUCTION, { ...BROWSER, search }, client);

    expect(client.init).toHaveBeenCalledOnce();
    expect(client.register).not.toHaveBeenCalled();
    expect(client.unregister).not.toHaveBeenCalled();
  });

  test("an automated browser is still initialised and tagged automated", () => {
    const client = fakeClient();

    expect(startAnalytics(PRODUCTION, { ...BROWSER, webdriver: true }, client)).toBe(true);
    expect(client.init).toHaveBeenCalledOnce();
    expect(client.register).toHaveBeenCalledExactlyOnceWith({ automated: true });
  });

  test.each([false, undefined])("webdriver %s is not tagged automated", (webdriver) => {
    const client = fakeClient();

    startAnalytics(PRODUCTION, { ...BROWSER, webdriver }, client);

    expect(client.register).not.toHaveBeenCalled();
  });

  test("an automated browser with ?internal=1 gets both tags", () => {
    const client = fakeClient();

    startAnalytics(PRODUCTION, { webdriver: true, search: "?internal=1" }, client);

    expect(client.register).toHaveBeenCalledTimes(2);
    expect(client.register).toHaveBeenCalledWith({ automated: true });
    expect(client.register).toHaveBeenCalledWith({ internal: true });
  });

  test("tags are applied only once PostHog has loaded", () => {
    const client = fakeClient();
    let onLoaded: (() => void) | undefined;
    client.init.mockImplementation((_token, _host, loaded) => {
      onLoaded = loaded;
    });

    startAnalytics(PRODUCTION, { webdriver: true, search: "?internal=1" }, client);
    expect(client.register).not.toHaveBeenCalled();

    onLoaded?.();
    expect(client.register).toHaveBeenCalledTimes(2);
  });

  test("never calls anything but init, register and unregister", () => {
    const calls: string[] = [];
    const client = new Proxy(fakeClient(), {
      get(target, prop, receiver) {
        calls.push(String(prop));
        return Reflect.get(target, prop, receiver);
      },
    });

    startAnalytics(PRODUCTION, { webdriver: true, search: "?internal=0" }, client);

    expect(new Set(calls)).toEqual(new Set(["init", "register", "unregister"]));
  });
});
