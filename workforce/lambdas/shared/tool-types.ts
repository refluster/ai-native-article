// Shape of one interactive-tool registry entry, server side (ADR-0027 §3).
//
// MIRROR: workforce/app/src/types/tool.ts carries the console's view of
// the same shape, minus `system` — the prompt never enters the browser
// bundle. Both are generated into from workforce/tools/*/ by
// workforce/scripts/build-tool-registry.mjs; the authority on what is
// valid is workforce/scripts/schemas/tool.schema.json, enforced by
// validate-tools.mjs in CI.

export interface ToolModelConfig {
  /** Overrides the project credential's deployment. Usually absent. */
  deployment?: string;
  /** Completion-token cap; exhausting it throws (W-1/W-4). */
  max_tokens: number;
  temperature?: number;
}

export interface ToolDefinition {
  tool_id: string;
  display_name: string;
  summary: string;
  version: string;
  requires: string[];
  model: ToolModelConfig;
  /** JSON Schema for the operator's form. */
  input: Record<string, unknown>;
  /** JSON Schema the model is forced to answer with. */
  output: Record<string, unknown>;
  /** The system prompt. Absent from the console's copy. */
  system: string;
}
