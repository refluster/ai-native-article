// Client-side helpers for the workforce credentials API surface.
//
// Three operations on the canonical credential types (CREDENTIAL_TYPES
// below is the count of record — no prose copy of it here, which is how
// the vault's "/ 5" denominator went stale):
//
//   - LIST   (GET)     — public via the agents-api base; metadata only.
//   - PUT    (write)   — SigV4-protected via the credentials-api base.
//   - DELETE (write)   — SigV4-protected via the credentials-api base.
//
// LIST is intentionally exposed on agents-api because it returns no
// secret material (just metadata: type, name, secret_arn, timestamps).
// Writes pierce the AWS_IAM gate on credentials-api and the SPA brokers
// the SigV4 signature via lib/sigv4.ts.
//
// MIRROR: workforce/lambdas/shared/credential-injector.ts CREDENTIAL_TYPES.
// No build-time codegen exists between the lambdas tree and the SPA; when a
// new type lands there, copy it here too. (Deferred follow-up issue 7 would
// consolidate via codegen.)

import { WORKFORCE_CREDENTIALS_API_BASE } from '../config/api';
import { assertSigv4Configured, signedFetch } from './sigv4';
import type {
  CredentialMetadata,
  DeleteCredentialResponse,
  PutCredentialResponse,
} from '../types/project';

/** Canonical credential types — declaration order = SPA render order. */
export const CREDENTIAL_TYPES = [
  'anthropic.api_key',
  'azure.openai',
  'discord.bot_token',
  'github.token',
  'notion.integration_token',
  'voyage.api_key',
] as const;

export type CredentialTypeId = (typeof CREDENTIAL_TYPES)[number];

/**
 * Returns true when the SPA build was given a credentials-api base. The
 * LIST endpoint flows through the agents-api base instead, so listing
 * still works on builds where this is unset — only PUT/DELETE go dark.
 *
 * Mirrors the apiConfigured() precedent in lib/projects.ts.
 */
export const credentialsApiConfigured = (): boolean =>
  WORKFORCE_CREDENTIALS_API_BASE.length > 0;

/**
 * Encode a project id for use in a URL path. Project ids may contain
 * `/` (e.g. `self/ren`); percent-encoding keeps the whole id as one
 * path parameter.
 */
function encode(id: string): string {
  return encodeURIComponent(id);
}

/**
 * LIST credentials for a project. Flows through agents-api (public — the
 * metadata view is non-sensitive). A 404 is mapped to an empty list so
 * "project has no credentials yet" doesn't look like an error.
 *
 * `agentsApiBase` is taken as a parameter so tests can inject a fixed
 * value without mocking the config module.
 */
export async function fetchCredentials(
  projectId: string,
  agentsApiBase: string,
): Promise<CredentialMetadata[]> {
  const url = `${agentsApiBase}/projects/${encode(projectId)}/credentials`;
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const data = (await res.json()) as { items: CredentialMetadata[] };
  return data.items;
}

/**
 * PUT (create-or-rotate) a credential value. The backend infers the
 * shape from the credential_type — anthropic / voyage / notion take
 * {apiKey}, discord / github take {token}. (Notion's database ids are
 * non-secret constants in the skill, not part of the credential.)
 *
 * Pre-flight asserts the SigV4 broker is configured; throws with a
 * developer-readable message before any network I/O when not.
 *
 * `credsApiBase` is taken as a parameter so tests can inject a fixed
 * value without mocking the config module.
 */
export async function putCredential(
  projectId: string,
  credentialType: CredentialTypeId,
  value: Record<string, string>,
  credsApiBase: string = WORKFORCE_CREDENTIALS_API_BASE,
): Promise<PutCredentialResponse> {
  assertSigv4Configured();
  const url = `${credsApiBase}/projects/${encode(projectId)}/credentials/${encodeURIComponent(credentialType)}`;
  const res = await signedFetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new Error(`credentials-api ${res.status}${detail ? ` · ${detail}` : ''}`);
  }
  return (await res.json()) as PutCredentialResponse;
}

/**
 * DELETE a credential. Soft-deletes through AWS Secrets Manager's
 * recovery window (7 days by default — see workforce/lambdas/credentials-api).
 *
 * `credsApiBase` is taken as a parameter so tests can inject a fixed
 * value without mocking the config module.
 */
export async function deleteCredential(
  projectId: string,
  credentialType: CredentialTypeId,
  credsApiBase: string = WORKFORCE_CREDENTIALS_API_BASE,
): Promise<DeleteCredentialResponse> {
  assertSigv4Configured();
  const url = `${credsApiBase}/projects/${encode(projectId)}/credentials/${encodeURIComponent(credentialType)}`;
  const res = await signedFetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new Error(`credentials-api ${res.status}${detail ? ` · ${detail}` : ''}`);
  }
  return (await res.json()) as DeleteCredentialResponse;
}

/**
 * Best-effort error-body reader. The credentials-api Lambda returns
 * `{error: "ResourceExistsException", ...}` on conflict — we surface
 * just enough text for the operator banner without making JSON parsing
 * a separate failure mode.
 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === 'object') {
      const err = (body as { error?: unknown }).error;
      if (typeof err === 'string') return err;
    }
    return '';
  } catch {
    try {
      return (await res.text()).slice(0, 120);
    } catch {
      return '';
    }
  }
}
