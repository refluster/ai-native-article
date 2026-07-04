// wf-credentials-api Lambda handler.
//
// Operator-only write-side credentials API. Closes Epic-010 Story 2-C (#91).
//
// Routes (all gated by AWS_IAM at the HTTP API Gateway boundary):
//   GET    /projects/{slug}/credentials/{type}   metadata only — NEVER value
//   PUT    /projects/{slug}/credentials/{type}   create or rotate
//   DELETE /projects/{slug}/credentials/{type}   schedule for deletion (7-day recovery)
//
// Canonical path in Secrets Manager (from Story 2-B): `wf/projects/{project_id}/{type}`.
// `{type}` may carry a variant suffix (`notion.integration_token@editorial`);
// the variant is opaque to this module and passed through to Secrets Manager
// unchanged (Secrets Manager allows `@` in names).
//
// ─── Why a new Lambda (Option A vs B) ──────────────────────────────────
//
// Story 2-C splits the credentials API out of `agents-api` so its IAM scope
// (`secretsmanager:CreateSecret/PutSecretValue/DescribeSecret/DeleteSecret`
// on `wf/projects/*`) doesn't widen the agents-api Lambda's policy. Per
// R-N3 + W-2: the secret-write surface is narrow on purpose — one Lambda,
// one set of secret-write IAM verbs.
//
// ─── Audit (EXEC row) ──────────────────────────────────────────────────
//
// Every successful PUT / DELETE appends an EXEC row to the project's
// ledger via `appendExecution(...)`, attributed to `_operator`. (The
// membership concept — and the `_operator` MEMBER auto-add that lived
// here — was removed 2026-07-03; every registered agent participates in
// every project, so an EXEC row needs no roster row to accompany it.)
//
// ─── Read-side leak prevention (test-locked) ───────────────────────────
//
// `GET` returns ONLY metadata (`{credential_type, project_id,
// last_rotated_at, last_changed_at, secret_arn, name}`). The handler
// NEVER calls `GetSecretValue`. The integration test in
// `handler-tests.ts` asserts the response body never contains the secret
// value — that's the canonical "secret-leak" guard.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  CREDENTIAL_TYPES,
  parseCredentialKey,
} from "../shared/credential-injector.js";
import {
  appendExecution,
  asProjectId,
  getProject,
  type ProjectId,
} from "../shared/project.js";
import { newUlid } from "../shared/task.js";

const sm = new SecretsManagerClient({});

/** 7-day recovery window — operator can undo via `secretsmanager:RestoreSecret`. */
const RECOVERY_WINDOW_DAYS = 7;

/** Marker `agent_slug` used for operator-authored audit rows. Mirrors the
 *  `owner_agent: AgentSlug | "_operator"` discriminator already in
 *  project.ts ProjectMetaRow. */
const OPERATOR_SLUG = "_operator";

/** Skill names attached to the operator's EXEC rows. Reserved namespace —
 *  no Lambda-runner skill shares these names. */
const SKILL_CREDENTIALS_WRITE = "credentials-write";
const SKILL_CREDENTIALS_DELETE = "credentials-delete";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const routeKey = event.routeKey;
    const slug = event.pathParameters?.slug;
    const credentialType = event.pathParameters?.type;

    if (!slug || !credentialType) {
      return reply(400, { error: "missing_path_param", routeKey });
    }

    if (routeKey === "GET /projects/{slug}/credentials/{type}") {
      return await getMetadata(slug, credentialType);
    }
    if (routeKey === "PUT /projects/{slug}/credentials/{type}") {
      return await putCredential(slug, credentialType, event.body);
    }
    if (routeKey === "DELETE /projects/{slug}/credentials/{type}") {
      return await deleteCredential(slug, credentialType);
    }

    return reply(404, { error: "route_not_found", routeKey });
  } catch (err) {
    // W-4: fail loud. The full message is logged for the operator; the
    // response body carries the same string so curl-debugging the API
    // doesn't require a parallel CloudWatch tab.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event: "credentials_api_error", message }),
    );
    return reply(500, { error: "internal", message });
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────

async function getMetadata(
  slug: string,
  credentialType: string,
): Promise<APIGatewayProxyResultV2> {
  const validation = validateInputs(slug, credentialType);
  if (validation.kind === "error") return validation.response;
  const { projectId } = validation;

  const project = await getProject(projectId);
  if (!project) return reply(404, { error: "project_not_found", project_id: projectId });

  const secretId = secretPath(projectId, credentialType);

  let describe;
  try {
    describe = await sm.send(new DescribeSecretCommand({ SecretId: secretId }));
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return reply(404, {
        error: "credential_not_found",
        project_id: projectId,
        credential_type: credentialType,
      });
    }
    throw err;
  }

  // SAFETY: DescribeSecret returns metadata only — NOT the secret value.
  // The integration test in handler-tests.ts re-asserts this by
  // grep-ing the response body for the secret value and failing if found.
  return reply(200, {
    project_id: projectId,
    credential_type: credentialType,
    name: describe.Name,
    secret_arn: describe.ARN,
    // ISO-8601 strings normalised from the SDK's Date fields. `last_rotated_at`
    // mirrors the issue's named field; we also surface `last_changed_at`
    // because rotation triggered via this API uses PutSecretValue, which
    // updates `LastChangedDate` but not `LastRotatedDate` (the latter is
    // only set by Secrets Manager's own rotation lambdas). The handler
    // therefore returns BOTH so the operator can rely on `last_changed_at`
    // as the canonical "when did the operator last bump this" timestamp.
    last_rotated_at: toIso(describe.LastRotatedDate),
    last_changed_at: toIso(describe.LastChangedDate),
    created_date: toIso(describe.CreatedDate),
  });
}

async function putCredential(
  slug: string,
  credentialType: string,
  body: string | undefined,
): Promise<APIGatewayProxyResultV2> {
  const validation = validateInputs(slug, credentialType);
  if (validation.kind === "error") return validation.response;
  const { projectId } = validation;

  if (!body) return reply(400, { error: "missing_body" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reply(400, { error: "invalid_json" });
  }
  // The body shape is `{ value: <SecretString> }`. The value MAY be a
  // JSON object (e.g. NotionSecret has {apiKey, databaseId}) or a string;
  // we re-stringify so Secrets Manager always sees a string.
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("value" in parsed) ||
    (parsed as { value: unknown }).value === undefined
  ) {
    return reply(400, {
      error: "missing_value",
      detail: "request body must be {value: <secret-string-or-object>}",
    });
  }
  const valueRaw = (parsed as { value: unknown }).value;
  const secretString =
    typeof valueRaw === "string" ? valueRaw : JSON.stringify(valueRaw);

  const project = await getProject(projectId);
  if (!project) return reply(404, { error: "project_not_found", project_id: projectId });

  const secretId = secretPath(projectId, credentialType);

  // Idempotent create-or-rotate. CreateSecret on a fresh key wins; on a
  // ResourceExistsException we fall back to PutSecretValue, which both
  // overwrites the value AND bumps LastChangedDate.
  const started = new Date().toISOString();
  let outcome: "created" | "rotated";
  try {
    await sm.send(
      new CreateSecretCommand({
        Name: secretId,
        SecretString: secretString,
        Description:
          `Operator-managed credential for project=${projectId} type=${credentialType}. ` +
          "Managed by wf-credentials-api. See workforce/docs/epics/epic-010 §5.",
      }),
    );
    outcome = "created";
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err;
    await sm.send(
      new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: secretString,
      }),
    );
    outcome = "rotated";
  }

  // Read back the new metadata so the response can include the canonical
  // `last_changed_at` Secrets Manager just wrote.
  const meta = await sm.send(new DescribeSecretCommand({ SecretId: secretId }));

  await writeOperatorExec({
    projectId,
    credentialType,
    skill: SKILL_CREDENTIALS_WRITE,
    startedAt: started,
  });

  return reply(200, {
    project_id: projectId,
    credential_type: credentialType,
    name: meta.Name,
    secret_arn: meta.ARN,
    outcome,
    last_changed_at: toIso(meta.LastChangedDate),
    last_rotated_at: toIso(meta.LastRotatedDate),
  });
}

async function deleteCredential(
  slug: string,
  credentialType: string,
): Promise<APIGatewayProxyResultV2> {
  const validation = validateInputs(slug, credentialType);
  if (validation.kind === "error") return validation.response;
  const { projectId } = validation;

  const project = await getProject(projectId);
  if (!project) return reply(404, { error: "project_not_found", project_id: projectId });

  const secretId = secretPath(projectId, credentialType);
  const started = new Date().toISOString();

  let deleted;
  try {
    deleted = await sm.send(
      new DeleteSecretCommand({
        SecretId: secretId,
        // ForceDeleteWithoutRecovery=false (the default; spelled out
        // for the operator reading the code) — Secrets Manager schedules
        // deletion after RecoveryWindowInDays days. `secretsmanager:
        // RestoreSecret` can undo this until then. AC requirement.
        RecoveryWindowInDays: RECOVERY_WINDOW_DAYS,
        ForceDeleteWithoutRecovery: false,
      }),
    );
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return reply(404, {
        error: "credential_not_found",
        project_id: projectId,
        credential_type: credentialType,
      });
    }
    throw err;
  }

  await writeOperatorExec({
    projectId,
    credentialType,
    skill: SKILL_CREDENTIALS_DELETE,
    startedAt: started,
  });

  return reply(200, {
    project_id: projectId,
    credential_type: credentialType,
    name: deleted.Name,
    secret_arn: deleted.ARN,
    deletion_date: toIso(deleted.DeletionDate),
    recovery_window_days: RECOVERY_WINDOW_DAYS,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

type Validated =
  | { kind: "ok"; projectId: ProjectId }
  | { kind: "error"; response: APIGatewayProxyResultV2 };

function validateInputs(slug: string, credentialType: string): Validated {
  let projectId: ProjectId;
  try {
    projectId = asProjectId(slug);
  } catch (err) {
    return {
      kind: "error",
      response: reply(400, {
        error: "invalid_project_slug",
        slug,
        detail: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  // The credential-type allowlist is owned by credential-injector.ts;
  // re-validating here is defense-in-depth (the runner enforces the same
  // gate; this API gates the WRITE so a bad type can never enter the
  // store at all).
  //
  // The variant tail (`type@variant`) is opaque — its base type is
  // checked against CREDENTIAL_TYPES; the variant body is checked
  // against the same /^[a-z][a-z0-9_-]*$/ pattern enforced inside
  // injectCredentials() so the WRITE side can't introduce a key the
  // READ side would later reject at runtime.
  const { baseType, variant } = parseCredentialKey(credentialType);
  if (!(CREDENTIAL_TYPES as ReadonlySet<string>).has(baseType)) {
    return {
      kind: "error",
      response: reply(400, {
        error: "unknown_credential_type",
        credential_type: credentialType,
        allowed: [...CREDENTIAL_TYPES].sort(),
      }),
    };
  }
  if (variant !== null) {
    if (variant.length === 0) {
      return {
        kind: "error",
        response: reply(400, {
          error: "invalid_variant",
          credential_type: credentialType,
          detail: "variant after '@' must not be empty",
        }),
      };
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(variant)) {
      return {
        kind: "error",
        response: reply(400, {
          error: "invalid_variant",
          credential_type: credentialType,
          detail: "variant must match /^[a-z][a-z0-9_-]*$/",
        }),
      };
    }
  }

  return { kind: "ok", projectId };
}

function secretPath(projectId: ProjectId, credentialType: string): string {
  return `wf/projects/${projectId}/${credentialType}`;
}

function toIso(d: Date | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

/**
 * Append an EXEC row attributed to `_operator` for the credentials-write
 * or credentials-delete skill. (The `_operator` MEMBER auto-add that used
 * to precede this write was removed with the membership concept,
 * 2026-07-03 — every registered agent participates in every project.)
 *
 * Mutates DDB after the Secrets Manager write has already succeeded —
 * if the audit append throws, the secret change persists (loud thrown
 * 500 + CloudWatch). The alternative (audit-first) would risk a
 * dangling EXEC row pointing at a never-mutated secret, which is the
 * worse audit failure.
 */
async function writeOperatorExec(input: {
  projectId: ProjectId;
  credentialType: string;
  skill: typeof SKILL_CREDENTIALS_WRITE | typeof SKILL_CREDENTIALS_DELETE;
  startedAt: string;
}): Promise<void> {
  await appendExecution({
    project_id: input.projectId,
    agent_slug: OPERATOR_SLUG,
    exec_ulid: newUlid(),
    skill_name: input.skill,
    skill_version: "1",
    started_at: input.startedAt,
    ended_at: new Date().toISOString(),
    status: "ok",
    used_credential_types: [input.credentialType],
  });
}

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}
