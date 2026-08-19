/**
 * The environment this bundle was built for. `vite.config.ts` refuses to build without these
 * three, so they are strings here and not `string | undefined`.
 *
 * There is no API base URL: the front door serves the app and routes `/api/` to the API, so
 * every call is same-origin and relative.
 */
export const config = {
  /** Which directory the tokens come from. Sign-in needs the client and the domain, not this. */
  userPoolId: import.meta.env.VITE_USER_POOL_ID,
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
  /** Hosted sign-in host, no scheme. */
  signInDomain: import.meta.env.VITE_SIGN_IN_DOMAIN,
} as const;
