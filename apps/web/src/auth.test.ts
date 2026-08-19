import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The refresh, which is the only part of sign-in with state worth testing. Everything else in
 * `auth.ts` navigates the browser away.
 */

const TOKENS_KEY = "sjsu.tokens";

function fakeStorage(): Storage {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    get length() {
      return held.size;
    },
  };
}

/** A fresh copy of the module, because it holds the tokens and the in-flight refresh itself. */
async function auth(expiringIn: number, refreshToken = "a-refresh-token") {
  vi.resetModules();
  const storage = fakeStorage();
  storage.setItem(
    TOKENS_KEY,
    JSON.stringify({
      accessToken: "the-old-one",
      idToken: "an-id-token",
      refreshToken,
      expiresAt: Date.now() + expiringIn,
    }),
  );
  vi.stubGlobal("sessionStorage", storage);
  return { module: await import("./auth"), storage };
}

function refusedOnce() {
  return vi.fn(async () => ({ ok: false, status: 400, statusText: "Bad Request" }) as Response);
}

function granting() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      access_token: "the-new-one",
      id_token: "a-new-id-token",
      expires_in: 3600,
    }),
  }) as unknown as Response);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("getApiToken", () => {
  it("shares one refresh between calls that overlap", async () => {
    // Each call spending the refresh token separately logs everyone out mid-session, and it only
    // happens when calls overlap.
    const fetch = granting();
    vi.stubGlobal("fetch", fetch);
    const { module } = await auth(30_000);

    const tokens = await Promise.all([
      module.getApiToken(),
      module.getApiToken(),
      module.getApiToken(),
    ]);

    expect(tokens).toEqual(["a-new-id-token", "a-new-id-token", "a-new-id-token"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a token with time left on it", async () => {
    const fetch = granting();
    vi.stubGlobal("fetch", fetch);
    const { module } = await auth(30 * 60_000);

    // The ID token, not the access token: the access token carries no email claim, so a publish
    // sent with it records nobody.
    expect(await module.getApiToken()).toBe("an-id-token");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the person to sign-in when the refresh is refused", async () => {
    const fetch = refusedOnce();
    vi.stubGlobal("fetch", fetch);
    const { module, storage } = await auth(30_000);

    expect(await module.getApiToken()).toBeNull();
    // The held tokens go with it, so the next call asks for sign-in rather than retrying a
    // refresh the directory has already refused.
    expect(storage.getItem(TOKENS_KEY)).toBeNull();
    expect(await module.getApiToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks for sign-in when there is no refresh token to spend", async () => {
    const fetch = granting();
    vi.stubGlobal("fetch", fetch);
    const { module } = await auth(30_000, "");

    expect(await module.getApiToken()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
