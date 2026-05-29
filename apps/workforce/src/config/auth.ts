// Cognito auth config — supplied at build time via the CI workflow's
// VITE_COGNITO_* secrets, which the operator populates from the
// `sam deploy` outputs of wf-web-prod. See
// workforce/infra/sam-web/README.md §6.
//
// When ANY of the three required values is missing, the SPA renders a
// "not configured" banner instead of attempting the OIDC redirect.
// That lets `npm run dev` work locally without a real Cognito pool;
// every protected page just shows the "configure auth" message.

const REGION = 'us-west-2';

const USER_POOL_ID = (import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '').trim();
const CLIENT_ID = (import.meta.env.VITE_COGNITO_CLIENT_ID ?? '').trim();
const DOMAIN_PREFIX = (import.meta.env.VITE_COGNITO_DOMAIN ?? '').trim();

export const AUTH_REGION = REGION;
export const AUTH_USER_POOL_ID = USER_POOL_ID;
export const AUTH_CLIENT_ID = CLIENT_ID;
export const AUTH_DOMAIN_PREFIX = DOMAIN_PREFIX;

/** Full Hosted UI base URL, or '' when unset. */
export const AUTH_HOSTED_UI_URL = DOMAIN_PREFIX
  ? `https://${DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com`
  : '';

/** OIDC issuer URL Cognito publishes its discovery doc at. */
export const AUTH_ISSUER_URL = USER_POOL_ID
  ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`
  : '';

/** Redirect target for both authorize() and the OAuth callback. */
export const AUTH_REDIRECT_URI =
  typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : '';

/** Post-logout return target. */
export const AUTH_POST_LOGOUT_URI =
  typeof window !== 'undefined' ? `${window.location.origin}/` : '';

export const AUTH_IS_CONFIGURED = Boolean(
  AUTH_USER_POOL_ID && AUTH_CLIENT_ID && AUTH_DOMAIN_PREFIX,
);

// ─── Identity Pool for SigV4 brokering (Project CRUD UI PR-α) ─────────────────
//
// Optional — when missing, `signedFetch` (lib/sigv4.ts) throws on first
// invocation. The basic Hosted-UI flow above works without this; only
// AWS_IAM-protected API calls need it.

const IDENTITY_POOL_ID = (
  import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID ?? ''
).trim();

export const AUTH_IDENTITY_POOL_ID = IDENTITY_POOL_ID;

/** True iff the Identity Pool is configured AND base auth is configured —
 *  the broker is useless without the User Pool tokens to federate. */
export const SIGV4_IS_CONFIGURED = Boolean(
  AUTH_IS_CONFIGURED && AUTH_IDENTITY_POOL_ID,
);

/** Cognito Identity service endpoint for the configured region. The
 *  AWS SDK derives this from region; we expose it for `aws4fetch` calls
 *  that bypass the SDK on the SigV4 hot path. */
export const AUTH_COGNITO_IDENTITY_ENDPOINT = `https://cognito-identity.${REGION}.amazonaws.com`;
