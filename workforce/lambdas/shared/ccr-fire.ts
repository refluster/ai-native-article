// CCR `/fire` dispatch helper.
//
// When the orchestrator-tick encounters a binding with
//   executor=claude-code-routine, scheduler=external, invoked_by=api
// whose cron matches the current tick window, it calls `fireCcrRoutine()`
// instead of async-invoking wf-agent-runner. The bearer token + URL for
// each CCR routine live in AWS Secrets Manager at `wf/ccr/{routine_id}`,
// where `routine_id` is the basename of the binding's `routine_spec`
// path (e.g. `workforce/docs/routines/agent-runner.md` → "agent-runner").
//
// Bindings that share a `routine_spec` share the secret. The current
// design uses one shared `agent-runner` routine for every CCR-by-API
// binding regardless of skill; per-skill routines remain possible
// (different `routine_spec`) but require the operator to instantiate
// a separate claude.ai routine + store a separate token.
//
// The secret payload is the JSON shape established in ccr-bootstrap.md:
//
//   { "url":   "https://api.anthropic.com/v1/claude_code/routines/trig_XXX/fire",
//     "token": "sk-ant-oat01-XXX" }
//
// W-4 (fail loud): missing secret, malformed JSON, non-2xx response — all
// throw. The orchestrator-tick converts the throw into a `skipped` entry
// with a clear reason and emits a CloudWatch metric.

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

export interface CcrFirePayload {
  agent_slug: string;
  binding_idx: number;
  ticked_at: string;
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
