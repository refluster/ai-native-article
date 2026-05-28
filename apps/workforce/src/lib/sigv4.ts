// SigV4 brokering for AWS_IAM-protected API Gateway routes.
//
// Project CRUD UI gating infrastructure (PR-α of the issue series).
// workstream. The SPA holds an OIDC ID token from the Cognito User Pool
// (lib/auth.ts); this module exchanges that token for temporary AWS
// credentials via the Identity Pool and SigV4-signs subsequent API
// Gateway requests.
//
// Architecture:
//
//   1. lib/auth.ts handles the OIDC dance with the User Pool.
//      `getCurrentUser()` returns a User whose `id_token` is the JWT.
//
//   2. `getAwsCredentials()` (below) calls:
//        - cognito-identity:GetId       (User Pool token → IdentityId)
//        - cognito-identity:GetCredentialsForIdentity
//                                       (IdentityId → AccessKey/Secret/
//                                        SessionToken, ~1h lifetime)
//      and caches the result in-memory until expiry.
//
//   3. `signedFetch(url, init)` wraps `fetch()` with `aws4fetch.AwsClient`
//      which performs the SigV4 signing transparently. Caller passes a
//      regular `RequestInfo` + optional `RequestInit`; gets back a
//      `Response` with the API Gateway result.
//
// Why aws4fetch vs the full @aws-sdk/signature-v4?
//   - aws4fetch is ~10 KB minified; the SDK signer pulls in ~120 KB
//     of HTTP-protocol abstractions for the same outcome.
//   - aws4fetch's API matches the global `fetch()` — easier for the
//     UI code to consume without bespoke ergonomics.
//   - @aws-sdk/client-cognito-identity is still needed for step 2
//     because Cognito Identity uses AWS JSON-RPC with `X-Amz-Target`
//     headers + an unpublished error schema; rolling our own would
//     double the surface area for marginal bundle savings.
//
// Threat model (operator):
//   - Temp creds live only in the browser tab's JS heap. No persistence.
//   - On tab close they evaporate; on token expiry (~1h) the next call
//     triggers a fresh exchange transparently.
//   - The bound IAM role is scoped to `execute-api:Invoke` on the two
//     workforce HTTP APIs (sam-web template `WfWorkforceOperatorRole`).
//     A stolen SessionToken cannot escalate to S3 / DDB / other APIs.

import { AwsClient } from 'aws4fetch';
import {
  CognitoIdentityClient,
  GetCredentialsForIdentityCommand,
  GetIdCommand,
} from '@aws-sdk/client-cognito-identity';
import {
  AUTH_IDENTITY_POOL_ID,
  AUTH_ISSUER_URL,
  AUTH_REGION,
  AUTH_USER_POOL_ID,
  SIGV4_IS_CONFIGURED,
} from '../config/auth';
import { getCurrentUser } from './auth';

interface AwsTempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ms-since-epoch when these credentials expire. We refresh ≥30s before. */
  expiresAt: number;
}

// In-memory cache. The browser tab IS the trust boundary; on tab close
// the credentials evaporate naturally. Refresh happens on demand when
// `signedFetch` finds the cached creds within 30s of expiry.
let cached: AwsTempCredentials | null = null;
const REFRESH_MARGIN_MS = 30_000;

/**
 * Public guard. Throws with a developer-readable message when the SPA
 * build is missing `VITE_COGNITO_IDENTITY_POOL_ID` or the base Cognito
 * config — the broker is useless without both.
 */
export function assertSigv4Configured(): void {
  if (!SIGV4_IS_CONFIGURED) {
    throw new Error(
      'SigV4 broker is not configured. The deployment must set ' +
        'VITE_COGNITO_IDENTITY_POOL_ID alongside the existing ' +
        'VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID / VITE_COGNITO_DOMAIN.',
    );
  }
}

/**
 * Return temporary AWS credentials, refreshing from the Identity Pool
 * if the cache is empty or about to expire. Throws when:
 *
 *   - The SPA build is missing VITE_COGNITO_IDENTITY_POOL_ID.
 *   - The operator is not signed in (id_token missing / expired).
 *   - Cognito returns an error (federated session revoked, IAM role
 *     not assumable, etc.) — the error bubbles to the caller so the UI
 *     can decide whether to retry or re-auth.
 */
export async function getAwsCredentials(): Promise<AwsTempCredentials> {
  assertSigv4Configured();

  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached;
  }

  const user = await getCurrentUser();
  if (!user || !user.id_token) {
    throw new Error(
      'Cognito session missing or expired. Sign in via the Hosted UI before invoking SigV4-protected routes.',
    );
  }

  const issuer = AUTH_ISSUER_URL.replace(/^https?:\/\//, ''); // host only
  const logins = { [issuer]: user.id_token };

  const cognito = new CognitoIdentityClient({ region: AUTH_REGION });

  // Step 1: User Pool ID token → IdentityId. Pool ID is the SPA-side
  // env var; the Logins map carries the JWT keyed by issuer host.
  const idRes = await cognito.send(
    new GetIdCommand({
      IdentityPoolId: AUTH_IDENTITY_POOL_ID,
      Logins: logins,
    }),
  );
  if (!idRes.IdentityId) {
    throw new Error(
      'Cognito Identity Pool returned no IdentityId — pool may not be configured for this User Pool, or token validation failed.',
    );
  }

  // Step 2: IdentityId + JWT → AWS temp creds. The IAM role is
  // attached on the pool side (sam-web `WfWorkforceIdentityPoolRoleAttachment`);
  // we don't pass a RoleArn here.
  const credRes = await cognito.send(
    new GetCredentialsForIdentityCommand({
      IdentityId: idRes.IdentityId,
      Logins: logins,
    }),
  );
  const c = credRes.Credentials;
  if (!c || !c.AccessKeyId || !c.SecretKey || !c.SessionToken || !c.Expiration) {
    throw new Error(
      'Cognito Identity Pool returned incomplete credentials. Likely the operator role is not attached or the IAM trust policy mismatches the Identity Pool id.',
    );
  }

  cached = {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretKey,
    sessionToken: c.SessionToken,
    expiresAt: c.Expiration.getTime(),
  };
  return cached;
}

/**
 * SigV4-signed wrapper around `fetch()`. Use this for every call to an
 * AWS_IAM-protected API Gateway route — PATCH/DELETE on agents-api,
 * PUT/DELETE/GET on credentials-api.
 *
 * Caller signature matches `fetch()` for drop-in use:
 *
 *   const res = await signedFetch(
 *     `${AGENTS_API_URL}/projects/workforce-meta`,
 *     {
 *       method: 'PATCH',
 *       headers: { 'content-type': 'application/json' },
 *       body: JSON.stringify({ status: 'archived' }),
 *     },
 *   );
 *
 * The `service` defaults to `execute-api` (the only target this PR
 * exposes). Future broker users (e.g. direct DDB scans, which this PR
 * does NOT enable) would override.
 *
 * The wrapper resolves a fresh AwsClient per call rather than caching
 * one — the SessionToken lives in the AwsClient constructor and creating
 * a new client per request avoids the "creds got stale between calls"
 * footgun without measurable overhead.
 */
export async function signedFetch(
  input: RequestInfo | URL,
  init: RequestInit & { service?: string } = {},
): Promise<Response> {
  const { service = 'execute-api', ...rest } = init;
  const creds = await getAwsCredentials();
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
    service,
    region: AUTH_REGION,
  });
  return await client.fetch(input as RequestInfo, rest);
}

/**
 * Smoke-test helper exposed for the operator's browser console + future
 * UI work. Calls `PATCH /agents/{slug}` with an empty patch — the
 * agents-api handler returns 400 `empty_patch` on success, which
 * confirms SigV4 reached the AWS_IAM gate AND the role was assumable
 * AND the policy allowed the route. A 403 from API Gateway indicates
 * the role / policy / pool wiring is broken; a network error indicates
 * a build-config gap.
 *
 * Wired only behind a feature flag (`window.__wfSigv4Smoke = true`)
 * because firing it from production page-load would be noisy.
 *
 * The console usage is:
 *
 *   window.__wfSigv4Smoke = true;
 *   await window.wfSigv4Smoke('ren');
 *
 * Audit logging: the agents-api handler does not write an EXEC row on a
 * 400; the smoke is invisible to the project ledger.
 */
export async function sigv4SmokeAgentsApi(
  slug: string,
  agentsApiBase: string,
): Promise<{ status: number; body: unknown }> {
  if (!AUTH_USER_POOL_ID) {
    throw new Error('SigV4 smoke needs the SPA build to be Cognito-configured.');
  }
  const url = `${agentsApiBase}/agents/${encodeURIComponent(slug)}`;
  const res = await signedFetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}
