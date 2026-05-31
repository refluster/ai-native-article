// CCR `/fire` dispatch helper.
//
// When the orchestrator-tick scans agent bindings and finds CCR-bound
// matches (executor=claude-code-routine, scheduler=external,
// invoked_by=api), it collects them into a single tasks[] batch and
// makes ONE POST to the CCR routine's /fire URL. The CCR session
// iterates the tasks and executes each (agent, skill, project) tuple
// in sequence — see workforce/docs/routines/agent-runner.md.
//
// Batch shape (post-PR-β):
//
//   POST { tasks: [
//     { agent_slug, binding_idx, project_id, ticked_at, credentials },
//     ...
//   ] }
//
// `credentials` is a map keyed by credential type (resolved per the
// skill's `meta.json:requires[]`) and pre-resolved by orchestrator-tick
// from `wf/projects/{project_id}/{type}`. CCR receives the credential
// values inline; CCR itself never reads Secrets Manager. This keeps the
// trust boundary narrow: AWS resources are accessed only by AWS
// principals (orchestrator-tick Lambda).
//
// The CCR routine token + URL live in AWS Secrets Manager at
// `wf/ccr/{routine_id}` where `routine_id` is the basename of the
// binding's `routine_spec` path (e.g.
// `workforce/docs/routines/agent-runner.md` → "agent-runner"). Bindings
// that share a `routine_spec` share the secret + the same CCR routine.
// The current design uses ONE shared `agent-runner` routine for every
// CCR-by-API binding regardless of (agent, skill) — see PR #176 for the
// generalization rationale.
//
// Routine secret payload shape (workforce/docs/runbooks/ccr-bootstrap.md):
//
//   { "url":   "https://api.anthropic.com/v1/claude_code/routines/trig_XXX/fire",
//     "token": "sk-ant-oat01-XXX" }
//
// W-4 (fail loud): missing secret, malformed JSON, non-2xx response —
// all throw. The orchestrator-tick converts the throw into per-task
// `skipped` entries (so the failed batch's tasks all show up in the
// tick log with a clear reason).

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

/** Credential map shipped inline to CCR for one task. Keys are the
 *  credential types declared in the skill's `meta.json:requires[]`
 *  (e.g. `"discord.webhook_url"`); values are the parsed secret shape
 *  (e.g. `{ url: "..." }`). Type-untyped at this layer because the
 *  cross-skill set is open-ended; CCR receives them as opaque JSON. */
export type CcrTaskCredentials = Record<string, unknown>;

export interface CcrFireTask {
  agent_slug: string;
  binding_idx: number;
  project_id: string;
  ticked_at: string;
  credentials: CcrTaskCredentials;
}

export interface CcrFirePayload {
  tasks: CcrFireTask[];
}

export interface CcrFireResult {
  /** HTTP status from the /fire endpoint. 2xx is success. */
  status: number;
  /** Routine execution id if the response body included one (best-effort). */
  execution_id?: string;
}

interface CcrSecret {
  url: string;
  token: string;
}

/**
 * Derive the secret/routine id from a binding's `routine_spec` path.
 * Returns the basename without the `.md` extension.
 *
 *   "workforce/docs/routines/agent-runner.md" → "agent-runner"
 *
 * Throws on an empty / missing input — the binding validator already
 * guarantees `routine_spec` is set for executor=claude-code-routine, so
 * a throw here means the orchestrator called us with the wrong binding.
 */
export function routineIdFromSpec(routineSpec: string): string {
  if (!routineSpec) {
    throw new Error("routineIdFromSpec: routine_spec is required");
  }
  const slash = routineSpec.lastIndexOf("/");
  const base = slash >= 0 ? routineSpec.slice(slash + 1) : routineSpec;
  const dot = base.lastIndexOf(".");
  const id = dot > 0 ? base.slice(0, dot) : base;
  if (!id) {
    throw new Error(`routineIdFromSpec: cannot derive id from "${routineSpec}"`);
  }
  return id;
}

/**
 * POSTs the fire payload to the CCR routine identified by `routineId`
 * (which picks the secret at `wf/ccr/{routineId}`). Returns on 2xx;
 * throws on any other outcome.
 *
 * The caller is responsible for ensuring `payload.tasks` is non-empty —
 * an empty batch is a no-op the orchestrator handles by simply not
 * calling this function. (Passing an empty batch here would still POST
 * to Discord, which is wasteful but not a correctness issue.)
 */
export async function fireCcrRoutine(routineId: string, payload: CcrFirePayload): Promise<CcrFireResult> {
  const secret = await loadCcrSecret(routineId);
  const res = await fetch(secret.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret.token}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `fireCcrRoutine: ${routineId} → HTTP ${res.status}: ${text.slice(0, 256)}`,
    );
  }

  // The CCR /fire response shape isn't formally documented; try to pull
  // an execution_id but don't fail if it's absent.
  let execution_id: string | undefined;
  try {
    const body = (await res.json()) as { execution_id?: unknown };
    if (typeof body?.execution_id === "string") execution_id = body.execution_id;
  } catch {
    // Non-JSON body is fine — 2xx is the contract.
  }

  return { status: res.status, execution_id };
}

async function loadCcrSecret(routineId: string): Promise<CcrSecret> {
  const secretId = `wf/ccr/${routineId}`;
  const out = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!out.SecretString) {
    throw new Error(`loadCcrSecret: ${secretId} has no SecretString`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.SecretString);
  } catch (err) {
    throw new Error(
      `loadCcrSecret: ${secretId} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as CcrSecret).url !== "string" ||
    typeof (parsed as CcrSecret).token !== "string"
  ) {
    throw new Error(`loadCcrSecret: ${secretId} missing url/token fields`);
  }
  return parsed as CcrSecret;
}
