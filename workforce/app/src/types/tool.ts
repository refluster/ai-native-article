// Interactive project tools (ADR-0027, Epic-025).
//
// A tool is a *declarative registry entry*, not a React component: the
// console renders its form, run button, and result from the JSON Schemas
// below, so a new tool ships by committing a registry entry rather than
// by editing the SPA. The two tools whose interaction is genuinely
// bespoke (the Task Process chat panel, the Insight Foundry source
// picker) opt into a custom renderer via `renderer`, while still running
// through the same registry prompts and the same `/run` endpoint —
// ADR-0027 §3's declared carve-out.
//
// MIRROR: workforce/tools/{tool_id}/tool.json is the authoritative
// declaration; this file is the shape the console reads it through. The
// generator that turns the tool tree into a bundled registry lands with
// the tools-api in Phase 2 (Epic-025) — until then lib/tools.ts serves
// an empty registry and every consumer here is exercised by its tests.

import type { CredentialTypeId } from '../lib/credentials';

/** JSON Schema fragment. Kept deliberately loose — the authority is the
 *  schema file the Lambda validates against, not this type. */
export type JsonSchema = Record<string, unknown>;

/** Custom-renderer keys. `undefined` means the schema-driven default. */
export type ToolRenderer = 'chat' | 'sources';

export interface ToolDefinition {
  /** Immutable id; the last path segment of `/projects/{id}/tools/{toolId}`. */
  tool_id: string;
  /** Renameable label. */
  display_name: string;
  /** One line, shown on the tools index card. */
  summary: string;
  version: string;
  /** Credential types the run needs. Missing ones gate the run with an
   *  advisory rather than an opaque API error (Epic-025 AC4). */
  requires: CredentialTypeId[];
  /** Renders the input form. */
  input: JsonSchema;
  /** Forced structured output — carried here rather than in a foreign
   *  GPT record, so it is reviewable in a PR (ADR-0027 §5). */
  output: JsonSchema;
  renderer?: ToolRenderer;
}
