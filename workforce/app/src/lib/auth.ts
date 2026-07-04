// OIDC client wrapper around oidc-client-ts, configured against the
// Cognito User Pool's discovery doc. Single shared UserManager instance
// per browser tab. Tokens live in sessionStorage so they evaporate on
// tab close — the operator does not stay signed in across browser
// restarts. Refresh token still works inside the active tab via Cognito's
// silent-renew flow.

import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import {
  AUTH_CLIENT_ID,
  AUTH_HOSTED_UI_URL,
  AUTH_IS_CONFIGURED,
  AUTH_ISSUER_URL,
  AUTH_POST_LOGOUT_URI,
  AUTH_REDIRECT_URI,
} from '../config/auth';

let manager: UserManager | null = null;

export function getUserManager(): UserManager | null {
  if (!AUTH_IS_CONFIGURED) return null;
  if (manager) return manager;

  manager = new UserManager({
    authority: AUTH_ISSUER_URL,
    client_id: AUTH_CLIENT_ID,
    redirect_uri: AUTH_REDIRECT_URI,
    post_logout_redirect_uri: AUTH_POST_LOGOUT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // Cognito treats unknown extra_query_params as a hint to skip its
    // own login screen and jump straight to the federated provider.
    // identity_provider=Google means the user lands on Google's
    // consent screen with no Cognito branding in between.
    extraQueryParams: { identity_provider: 'Google' },
  });

  // Sign out properly via Cognito's /logout endpoint so the federated
  // session also clears. oidc-client-ts only knows about end_session;
  // Cognito's discovery doc doesn't advertise it, so we override the
  // signoutRedirect URL ourselves at call time.
  return manager;
}

export async function getCurrentUser(): Promise<User | null> {
  const m = getUserManager();
  if (!m) return null;
  const u = await m.getUser();
  if (!u || u.expired) return null;
  return u;
}

// The deep link the operator was on when the token expired. Carried
// through the OIDC round-trip TWO ways (belt and suspenders): as the
// oidc-client-ts `state` (returned on the User object at the callback)
// AND in sessionStorage (survives an oidc state-entry miss). Without
// this, every token refresh dumped the operator back at "/" — losing
// the /agents/:slug or /projects/:id they were reading.
const RETURN_TO_KEY = 'wf.auth.returnTo';

/** The ONE definition of "safe to navigate back to": an in-app absolute
 *  path — never a foreign origin, never protocol-relative (`//evil.com`),
 *  never back into the auth flow. Both the writer (signIn) and the reader
 *  (consumeReturnTo) apply this same predicate, so a future caller of
 *  signIn() can't reintroduce an asymmetry (Dario review on #430). The
 *  reader still re-validates because both carriers (OIDC state,
 *  sessionStorage) are attacker-influenceable — the read is the trust
 *  boundary. */
export function isSafeReturnTo(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' &&
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    !candidate.startsWith('/auth/')
  );
}

export async function signIn(returnTo?: string): Promise<void> {
  const m = getUserManager();
  if (!m) {
    console.warn('auth not configured; cannot sign in');
    return;
  }
  if (isSafeReturnTo(returnTo)) {
    try {
      window.sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    } catch {
      // storage full/blocked — the state param below still carries it
    }
    await m.signinRedirect({ state: { returnTo } });
    return;
  }
  await m.signinRedirect();
}

/** The path to restore after the callback. Prefers the OIDC state echoed
 *  on the signed-in User; falls back to the sessionStorage copy. Returns
 *  an in-app path only (never a foreign origin — the value is validated
 *  to start with "/" and to not point back at /auth/). */
export function consumeReturnTo(user: User | null): string {
  let candidate: string | undefined;
  const st = user?.state as { returnTo?: unknown } | undefined;
  if (st && typeof st.returnTo === 'string') candidate = st.returnTo;
  if (!candidate) {
    try {
      candidate = window.sessionStorage.getItem(RETURN_TO_KEY) ?? undefined;
    } catch {
      // ignore
    }
  }
  try {
    window.sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // ignore
  }
  return isSafeReturnTo(candidate) ? candidate : '/';
}

/** Cognito-specific sign-out: hits /logout so the User Pool session ends too. */
export async function signOut(): Promise<void> {
  const m = getUserManager();
  if (!m) return;
  await m.removeUser();
  if (!AUTH_HOSTED_UI_URL) return;
  const params = new URLSearchParams({
    client_id: AUTH_CLIENT_ID,
    logout_uri: AUTH_POST_LOGOUT_URI,
  });
  window.location.assign(`${AUTH_HOSTED_UI_URL}/logout?${params.toString()}`);
}

/** Exchange the authorization code at /auth/callback for tokens. */
export async function completeSignIn(): Promise<User | null> {
  const m = getUserManager();
  if (!m) return null;
  return m.signinRedirectCallback();
}
