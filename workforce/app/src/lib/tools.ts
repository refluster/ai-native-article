// Tool-registry access for the console (ADR-0027, Epic-025 Phase 1).
//
// The registry is a static, build-time list: tools are declared in
// `workforce/tools/{id}/{tool.json,system.md}` and generated into
// `tool-registry-generated.ts` by workforce/scripts/build-tool-registry.mjs,
// the same way the skill registry is generated from the skill tree.
//
// The generated console copy carries everything needed to draw a form and
// a result and NOT the system prompts, which stay in the Lambda's copy —
// a browser bundle is a publication, and the console has no use for them.
//
// Running a tool is `runTool()` below: a SigV4-signed POST to the
// AWS_IAM-protected tools-api (ADR-0027 §2). The console never talks to a
// model directly; it has no credential to do so, which is the point.

import { WORKFORCE_TOOLS_API_BASE } from '../config/api';
import { assertSigv4Configured, signedFetch } from './sigv4';
import { TOOL_REGISTRY as GENERATED } from './tool-registry-generated';
import type { ToolDefinition, ToolRunResult } from '../types/tool';
import type { CredentialMetadata } from '../types/project';
import type { CredentialTypeId } from './credentials';

/** Every declared tool, in directory order. */
export const TOOL_REGISTRY: readonly ToolDefinition[] = GENERATED;

/**
 * Returns true when the SPA build was given a tools-api base. When it is
 * unset the Tools tab still renders in full — registry, schemas,
 * credential advisories — and only the run action goes dark, mirroring
 * the credentialsApiConfigured() precedent.
 */
export const toolsApiConfigured = (): boolean => WORKFORCE_TOOLS_API_BASE.length > 0;

/**
 * Run one tool against one project.
 *
 * The project id may contain `/` (`self/ren`), so it is percent-encoded
 * into a single path parameter — the Lambda decodes it back.
 *
 * A failed run's server-side detail is surfaced to the operator rather
 * than flattened into "something went wrong": "the deployment is not
 * provisioned", "the completion was truncated" and "the budget cap would
 * be exceeded" are each actionable, and hiding them is what made the
 * original mini-apps hard to operate.
 */
export async function runTool(
  projectId: string,
  toolId: string,
  input: Record<string, unknown>,
  toolsApiBase: string = WORKFORCE_TOOLS_API_BASE,
): Promise<ToolRunResult> {
  if (!toolsApiBase) {
    throw new Error(
      'tool runs are not configured in this build (VITE_WORKFORCE_TOOLS_API_BASE is unset)',
    );
  }
  assertSigv4Configured();
  const url = `${toolsApiBase}/projects/${encode(projectId)}/tools/${encodeURIComponent(toolId)}/run`;
  const res = await signedFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`tools-api ${res.status}${(await readRunError(res)) || ''}`);
  }
  return (await res.json()) as ToolRunResult;
}

/** Pull the actionable part out of a tools-api error body, best-effort. */
async function readRunError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown };
    const detail = Array.isArray(body.detail)
      ? body.detail.join('; ')
      : typeof body.detail === 'string'
        ? body.detail
        : '';
    const error = typeof body.error === 'string' ? body.error : '';
    const text = [error, detail].filter(Boolean).join(' · ');
    return text ? ` · ${text}` : '';
  } catch {
    return '';
  }
}

/** Percent-encode a project id so a slash-bearing id stays one segment. */
function encode(id: string): string {
  return encodeURIComponent(id);
}

/**
 * Look up one tool by its immutable id.
 *
 * `registry` is a parameter so the lookup is exercised against real
 * entries today rather than only against the empty Phase-1 literal — a
 * test that asserts an empty array finds nothing verifies nothing.
 */
export function findTool(
  toolId: string,
  registry: readonly ToolDefinition[] = TOOL_REGISTRY,
): ToolDefinition | undefined {
  return registry.find((t) => t.tool_id === toolId);
}

/**
 * Tool ids that appear more than once. Duplicate ids would make
 * `findTool` order-dependent and `/tools/{id}` ambiguous, so the
 * invariant is checked rather than assumed — and checkable now, before
 * Phase 2 adds the entries that could violate it.
 */
export function duplicateToolIds(
  registry: readonly ToolDefinition[] = TOOL_REGISTRY,
): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { tool_id } of registry) {
    if (seen.has(tool_id)) dupes.add(tool_id);
    seen.add(tool_id);
  }
  return [...dupes];
}

/**
 * Which of a tool's required credentials are absent from the project's
 * OWN credential list — an advisory, not a verdict on whether the run
 * will resolve.
 *
 * The distinction is load-bearing. `getCredential` (lambdas/shared/
 * project.ts) resolves in three tiers: `wf/projects/{id}/{type}`, then
 * the shared `wf/projects/_default/{type}`, then legacy `wf/{type}`. The
 * console's LIST only sees the first, so an org-wide credential
 * provisioned at `_default` — the documented pattern for
 * `voyage.api_key` — is invisible here and would be reported "missing"
 * on every project even though every run resolves it.
 *
 * So the console words this as "not provisioned on this project" and
 * never as "this tool cannot run", and never hard-blocks on it: the
 * authoritative answer lives server-side, where the injector fails loud
 * (W-4) if all three tiers miss. Epic-025 AC4 asks for a legible
 * advisory with a remedy, which this gives, rather than for a client-side
 * gate the client lacks the information to close.
 *
 * A second known gap, same direction: a secret inside its Secrets Manager
 * recovery window still answers `DescribeSecret`, so it stays in the LIST
 * and reads as present while `GetSecretValue` would fail. Both gaps make
 * the advisory over-optimistic or over-pessimistic, never authoritative —
 * which is exactly why it does not gate.
 *
 * Matching is exact, including any `@variant` suffix: a variant is a
 * separate secret at a separate path, so `notion.integration_token@tools`
 * does not satisfy a requirement for `notion.integration_token`.
 */
export function unprovisionedOnProject(
  tool: ToolDefinition,
  projectCredentials: readonly CredentialMetadata[],
): CredentialTypeId[] {
  const have = new Set(projectCredentials.map((c) => c.credential_type));
  return tool.requires.filter((r) => !have.has(r));
}
