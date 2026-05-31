// CCR `/fire` dispatch helper.
//
// When the orchestrator-tick scans agent bindings and finds CCR-bound
// matches (executor=claude-code-routine, scheduler=external,
// invoked_by=api), it collects them into a single tasks[] batch and
// makes ONE POST to the CCR routine's /fire URL. The CCR session
// iterates the tasks and executes each (agent, skill, project) tuple
// in sequence — see workforce/docs/routines/agent-runner.md.
//
// Internal batch envelope (the structured shape this module emits):
//
//   { tasks: [
//       { agent_slug, binding_idx, project_id, ticked_at, credentials },
//       ...
//     ]
//   }
//
// Wire shape (what /fire actually accepts):
//
//   POST { "text": "<JSON-encoded batch envelope above>" }
//
// The CCR /fire endpoint accepts ONLY a `text` string at the top level
// — custom keys like `tasks` are rejected with HTTP 400. We serialize
// the structured envelope into `text` and the routine session
// (workforce/docs/routines/agent-runner.md) parses it back. Required
// headers per Anthropic docs:
//   - Authorization: Bearer <token>
//   - Content-Type: application/json
//   - anthropic-beta: experimental-cc-routine-2026-04-01
//   - anthropic-version: 2023-06-01
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
  /** CCR session id returned by /fire (e.g. `session_01HJKL...`). */
  session_id?: string;
  /** CCR session URL — operator can open this to watch the run. */
  session_url?: string;
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
/** Beta header version for the CCR `/fire` API. Per Anthropic docs:
 *  "Breaking changes ship behind new dated beta header versions, and the
 *  two most recent previous header versions continue to work so that
 *  callers have time to migrate." Bump this when the docs publish a
 *  newer version; the previous two stay valid during migration windows. */
const CCR_FIRE_BETA = "experimental-cc-routine-2026-04-01";
const ANTHROPIC_API_VERSION = "2023-06-01";

export async function fireCcrRoutine(routineId: string, payload: CcrFirePayload): Promise<CcrFireResult> {
  const secret = await loadCcrSecret(routineId);

  // The CCR /fire endpoint accepts ONLY a `text` field (per Anthropic
  // docs: "The request body accepts an optional `text` field ... if you
  // send JSON or another structured payload, the routine receives it as
  // a literal string"). Custom top-level keys like `tasks` are rejected
  // with HTTP 400 "Extra inputs are not permitted" — locked observation
  // from the 2026-05-31T23:25 tick. We serialize our structured envelope
  // to a string and let the routine session parse it back; the contract
  // for the routine side lives in workforce/docs/routines/agent-runner.md.
  const apiBody = { text: JSON.stringify(payload) };

  const res = await fetch(secret.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret.token}`,
      "anthropic-beta": CCR_FIRE_BETA,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(apiBody),
  });

  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `fireCcrRoutine: ${routineId} → HTTP ${res.status}: ${text.slice(0, 256)}`,
    );
  }

  // Per docs, success response shape:
  //   { type: "routine_fire", claude_code_session_id, claude_code_session_url }
  let session_id: string | undefined;
  let session_url: string | undefined;
  try {
    const body = (await res.json()) as {
      claude_code_session_id?: unknown;
      claude_code_session_url?: unknown;
    };
    if (typeof body?.claude_code_session_id === "string") session_id = body.claude_code_session_id;
    if (typeof body?.claude_code_session_url === "string") session_url = body.claude_code_session_url;
  } catch {
    // Non-JSON body is fine — 2xx is the contract.
  }

  return { status: res.status, session_id, session_url };
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
