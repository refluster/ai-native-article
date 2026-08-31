// Tool-registry access for the console (ADR-0027, Epic-025 Phase 1).
//
// The registry is a static, build-time list: tools are declared in
// `workforce/tools/{id}/tool.json` and bundled here, the same way the
// skill registry is generated from the skill tree. Phase 1 lands the
// surface with an EMPTY registry on purpose — the Tools tab, the route
// parsing, and the credential gating are all exercisable before a single
// tool exists, which keeps every later phase a small PR.
//
// Phase 2 (Epic-025) replaces the empty literal with the generated
// import; nothing else in this module changes.

import type { ToolDefinition } from '../types/tool';
import type { CredentialMetadata } from '../types/project';
import type { CredentialTypeId } from './credentials';

/** Every declared tool, in display order. Empty until Phase 2. */
export const TOOL_REGISTRY: readonly ToolDefinition[] = [];

/** Look up one tool by its immutable id. */
export function findTool(toolId: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.tool_id === toolId);
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
