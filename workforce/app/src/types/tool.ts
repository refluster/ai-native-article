// Interactive project tools (ADR-0027, Epic-025).
//
// A tool is a *declarative registry entry*, not a React component: the
// console renders its form, run button, and result from the JSON Schemas
// below, so a new tool ships by committing a registry entry rather than
// by editing the SPA.
//
// ADR-0027 §3 also reserves a custom-renderer carve-out for the two tools
// whose interaction is genuinely bespoke (the Task Process chat panel,
// the Insight Foundry source picker). That field is deliberately NOT
// declared here: nothing branches on it yet, so a Phase-2 entry setting
// it would silently render the default form. It lands in the phase that
// implements the dispatch, together with an exhaustive switch.
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

/** Model configuration. Non-secret; the deployment name is operator-chosen. */
export interface ToolModelConfig {
  /** Overrides the project credential's deployment. Usually absent. */
  deployment?: string;
  /** Completion-token cap. Exhausting it throws server-side (W-1/W-4). */
  max_tokens: number;
  temperature?: number;
}

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
  model: ToolModelConfig;
  /** Renders the input form. */
  input: JsonSchema;
  /** Forced structured output — carried here rather than in a foreign
   *  GPT record, so it is reviewable in a PR (ADR-0027 §5). */
  output: JsonSchema;
}

/** Successful response from `POST /projects/{id}/tools/{toolId}/run`. */
export interface ToolRunResult {
  tool_id: string;
  version: string;
  exec_ulid: string;
  /** Matches the tool's `output` schema. */
  data: unknown;
  usage: {
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    deployment: string;
  };
}
