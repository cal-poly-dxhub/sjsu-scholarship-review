import { getApiToken, signIn } from "@/auth";

// Same origin: the front door serves the app and routes /api/ to the API, so paths are relative,
// there is no base URL to configure, and no preflight to answer.
const API_PREFIX = "/api";

// thin fetch wrapper for the api. pair with react-query in components:
// useQuery({ queryKey: ["health"], queryFn: () => api("/health") })
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getApiToken();
  if (!token) {
    await signIn();
    throw new Error("You are signed out, so nothing was loaded. Sign in again.");
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_PREFIX}${path}`, { ...init, headers });

  // A refused token after a refresh attempt means refreshing is no longer possible, so the
  // reviewer goes back through sign-in rather than watching calls fail.
  if (res.status === 401) {
    await signIn();
    throw new Error("Your sign-in expired. Sign in again to carry on.");
  }
  if (!res.ok) throw new Error(await refusal(res));
  return res.json() as Promise<T>;
}

/**
 * What to show for a refused call. Every handler answers with a `message` saying what was wrong
 * and what to do about it, and a status line on its own tells a person nothing.
 */
async function refusal(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message !== "") return body.message;
  } catch {
    // No JSON body, so the status code is all there is to go on.
  }
  return `Something went wrong (${res.status}). Try again.`;
}
