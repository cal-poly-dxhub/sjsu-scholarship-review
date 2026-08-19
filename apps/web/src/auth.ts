import { config } from "@/config";

/**
 * Sign-in against the Cognito hosted page: redirect with a PKCE challenge, swap the code for
 * tokens, hold them, refresh before expiry. No password is typed in this app and no token is
 * verified here — the hosted page collects the one, the API's edge checks the other.
 */

type Tokens = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  /** Epoch ms the access token stops being accepted. */
  expiresAt: number;
};

const TOKENS_KEY = "sjsu.tokens";
const VERIFIER_KEY = "sjsu.pkce-verifier";
const STATE_KEY = "sjsu.oauth-state";
const RETURN_KEY = "sjsu.return-to";

const SCOPES = "openid email profile";

// Refresh this far ahead of expiry, so a call already in flight cannot land on a dead token.
const REFRESH_MARGIN_MS = 120_000;

let held: Tokens | null = null;
let refreshing: Promise<Tokens | null> | null = null;

/** Cognito matches this against the app client's callback list exactly, so no trailing slash. */
function redirectUri(): string {
  return window.location.origin;
}

function load(): Tokens | null {
  if (held) return held;
  const raw = sessionStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    held = JSON.parse(raw) as Tokens;
  } catch {
    sessionStorage.removeItem(TOKENS_KEY);
  }
  return held;
}

// sessionStorage, not localStorage: the tokens die with the tab. A new tab redirects through the
// hosted page, which is silent while the directory's own session is alive.
function store(next: Tokens): void {
  held = next;
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(next));
}

function forget(): void {
  held = null;
  sessionStorage.removeItem(TOKENS_KEY);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

async function exchange(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`https://${config.signInDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.userPoolClientId, ...body }),
  });
  if (!res.ok) throw new Error(`Token request refused: ${res.status} ${res.statusText}`);
  const payload = (await res.json()) as {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: payload.access_token,
    idToken: payload.id_token,
    // A refresh reply leaves the refresh token out, so the one we already hold stands.
    refreshToken: payload.refresh_token ?? load()?.refreshToken ?? "",
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

/** Drops the code and state from the address bar and lands on the page that was asked for. */
function landOnRequestedPage(): void {
  const target = sessionStorage.getItem(RETURN_KEY) ?? "/";
  sessionStorage.removeItem(RETURN_KEY);
  window.history.replaceState(null, "", target);
}

/** Sends the visitor to the hosted sign-in page. The page navigates away, so nothing follows. */
export async function signIn(): Promise<void> {
  forget();
  const verifier = randomValue();
  const state = randomValue();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  // So a deep link survives the round trip: the callback URL is the origin, not the path asked for.
  sessionStorage.setItem(
    RETURN_KEY,
    window.location.pathname + window.location.search + window.location.hash,
  );

  const params = new URLSearchParams({
    client_id: config.userPoolClientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
  });
  window.location.assign(`https://${config.signInDomain}/oauth2/authorize?${params}`);
}

/** Ends the session in the browser and in the directory, so the refresh token is spent. */
export function signOut(): void {
  forget();
  const params = new URLSearchParams({
    client_id: config.userPoolClientId,
    logout_uri: redirectUri(),
  });
  window.location.assign(`https://${config.signInDomain}/logout?${params}`);
}

async function refresh(current: Tokens): Promise<Tokens | null> {
  if (!current.refreshToken) {
    forget();
    return null;
  }
  // One refresh at a time. Several calls hitting an expiring token would each spend the refresh
  // token, and every reply but one would be a refused request.
  refreshing ??= exchange({ grant_type: "refresh_token", refresh_token: current.refreshToken })
    .then((next) => {
      store(next);
      return next;
    })
    .catch(() => {
      forget();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * The token to send to the API, refreshed if it is close to expiry. `null` means sign in again.
 *
 * The ID token, not the access token: publishing a rubric version records the caller's email, and
 * only the ID token carries that claim. The authorizer accepts either.
 */
export async function getApiToken(): Promise<string | null> {
  const current = load();
  if (!current) return null;
  if (current.expiresAt - Date.now() > REFRESH_MARGIN_MS) return current.idToken;
  return (await refresh(current))?.idToken ?? null;
}

/**
 * Finishes a return from the hosted page, or reports whether the tokens already held are
 * usable. Call once before anything renders, so no application data shows to a signed-out
 * visitor.
 */
export async function restoreSession(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  if (!code) {
    // The hosted page can also come back with an error — a cancelled sign-in, say.
    if (url.searchParams.get("error")) landOnRequestedPage();
    return (await getApiToken()) !== null;
  }

  // A code that arrived without the state we sent is not ours to spend.
  if (!verifier || !expectedState || url.searchParams.get("state") !== expectedState) {
    landOnRequestedPage();
    return false;
  }

  try {
    store(
      await exchange({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier,
      }),
    );
    return true;
  } catch {
    return false;
  } finally {
    landOnRequestedPage();
  }
}
