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
 * Which of a tool's required credentials the project has not provisioned.
 *
 * The console gates the run on this rather than letting the request fail
 * at the API boundary (Epic-025 AC4) — an unprovisioned credential is an
 * operator to-do with a known remedy, not an error.
 *
 * Matching is exact, including any `@variant` suffix: a variant is a
 * separate secret at a separate Secrets Manager path, so
 * `notion.integration_token@tools` does not satisfy a requirement for
 * `notion.integration_token` (or the reverse).
 */
export function missingCredentials(
  tool: ToolDefinition,
  provisioned: readonly CredentialMetadata[],
): CredentialTypeId[] {
  const have = new Set(provisioned.map((c) => c.credential_type));
  return tool.requires.filter((r) => !have.has(r));
}
