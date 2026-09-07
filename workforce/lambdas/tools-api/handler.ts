// wf-tools-api — the synchronous run surface for interactive project
// tools (ADR-0027 §2, Epic-025 Phase 2).
//
//   POST /projects/{slug}/tools/{tool_id}/run
//
// This is the workforce's first SYNCHRONOUS LLM path. Everything else
// (agents, cadences) runs asynchronously through the CCR model of
// ADR-0005 and lands a deliverable; a tool run has an operator waiting on
// the other end of the request. ADR-0027 §2 declares that boundary
// explicitly: a tool run has NO schedule, NO persona byline, and NO
// deliverable, and the moment a tool wants to recur it stops being a tool
// and becomes a Cadence with a binding (R-N4).
//
// What is shared with every other execution path, deliberately:
//   - Credentials resolve through injectCredentials(), project-scoped.
//   - Spend goes through shared/budget.ts. W-3 does not care which
//     provider or which surface spent the money.
//   - Every run — success or failure — appends an EXEC row to
//     PROJECT#{id}, so a tool's activity shows up on the project's
//     existing ledger rather than in a private log.
//
// Attribution: a tool run has no agent, so rows carry `_operator`, the
// same convention the credentials-api writes use.
//
// Auth: AWS_IAM at the API Gateway (see infra/sam/template.yaml). C-3 —
// single operator, no per-user model. The SPA signs with SigV4 through
// the same broker it uses for credential writes.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { TOOL_REGISTRY } from "../shared/tool-registry-generated.js";
import type { ToolDefinition } from "../shared/tool-types.js";
import { injectCredentials, type CredentialKey } from "../shared/credential-injector.js";
import { complete } from "../shared/llm-azure.js";
import type { AzureOpenAISecret } from "../shared/secrets.js";
import { appendExecution, getProject, type ProjectId } from "../shared/project.js";
import { assertWithinBudget, recordSpend } from "../shared/budget.js";
import { W3_BUDGET_CAP_USD } from "../shared/agent-config.js";
import { newUlid } from "../shared/task.js";

/** A tool run has no agent; the operator is the actor. */
const OPERATOR_SLUG = "_operator";

/**
 * Worst-case USD a single run may add, used for the pre-flight W-3 check
 * before the tokens are actually known. Deliberately generous relative to
 * a real run (a 32k-token completion at the priciest listed rate is well
 * under this) — the guard exists to stop a runaway month, not to price a
 * request. The post-run recordSpend is the accurate number.
 */
const PLANNED_COST_CEILING_USD = 1.0;

/** Cap on the JSON request body, before parsing. */
const MAX_BODY_BYTES = 64 * 1024;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (event.routeKey !== "POST /projects/{slug}/tools/{tool_id}/run") {
      return reply(404, { error: "unknown_route", route: event.routeKey });
    }
    return await runTool(event);
  } catch (err) {
    // Unexpected failures are logged and reported as 500 without echoing
    // internals to the caller.
    console.error(
      JSON.stringify({
        event: "tools_api_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return reply(500, { error: "internal_error" });
  }
};

async function runTool(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const rawSlug = event.pathParameters?.slug;
  const rawToolId = event.pathParameters?.tool_id;
  if (!rawSlug || !rawToolId) {
    return reply(400, { error: "missing_path_parameters" });
  }

  // Project ids may contain `/` (`self/ren`), so the SPA percent-encodes
  // the whole id into one path parameter.
  let projectId: string;
  try {
    projectId = decodeURIComponent(rawSlug);
  } catch {
    return reply(400, { error: "invalid_project_id", detail: "malformed percent-encoding" });
  }

  const tool = TOOL_REGISTRY.find((t) => t.tool_id === rawToolId);
  if (!tool) {
    return reply(404, {
      error: "unknown_tool",
      tool_id: rawToolId,
      known: TOOL_REGISTRY.map((t) => t.tool_id),
    });
  }

  if (!event.body) return reply(400, { error: "missing_body" });
  if (Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return reply(413, { error: "body_too_large", max_bytes: MAX_BODY_BYTES });
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(event.body);
  } catch {
    return reply(400, { error: "invalid_json" });
  }
  const rawInput = (parsedBody as { input?: unknown } | null)?.input;
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    return reply(400, {
      error: "missing_input",
      detail: "request body must be {input: {...}} matching the tool's input schema",
    });
  }

  const inputErrors = validateInput(tool, rawInput as Record<string, unknown>);
  if (inputErrors.length > 0) {
    return reply(400, { error: "invalid_input", detail: inputErrors });
  }

  const project = await getProject(projectId as ProjectId);
  if (!project) return reply(404, { error: "project_not_found", project_id: projectId });

  const startedAt = new Date().toISOString();
  const execUlid = newUlid();

  try {
    // W-3 pre-flight. Tool spend is attributed to the project's operator
    // rather than to an agent (a tool run has no persona), but it is the
    // same monthly ledger and the same cap.
    await assertWithinBudget(OPERATOR_SLUG, W3_BUDGET_CAP_USD, PLANNED_COST_CEILING_USD);

    const credentials = await injectCredentials(
      tool.requires as CredentialKey[],
      projectId as ProjectId,
      { skillName: `tool:${tool.tool_id}` },
    );
    const azure = credentials["azure.openai" as CredentialKey] as unknown as AzureOpenAISecret;

    const result = await complete({
      credential: azure,
      system: tool.system,
      user: renderUserMessage(tool, rawInput as Record<string, unknown>),
      maxTokens: tool.model.max_tokens,
      deployment: tool.model.deployment,
      // No temperature: the registry cannot declare one (validate-tools
      // T13) because gpt-5.4 400s on any non-default value, so there is
      // nothing to forward and the key stays off the wire.
      outputSchema: { name: `emit_${tool.tool_id.replace(/-/g, "_")}`, schema: tool.output },
    });

    await recordSpend(OPERATOR_SLUG, result.tokens_in, result.tokens_out, result.cost_usd);
    await appendExecution({
      project_id: projectId as ProjectId,
      agent_slug: OPERATOR_SLUG,
      exec_ulid: execUlid,
      skill_name: `tool:${tool.tool_id}`,
      skill_version: tool.version,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      status: "ok",
      used_credential_types: [...tool.requires],
      summary: `${tool.display_name} run (${result.tokens_out} output tokens)`.slice(0, 512),
    });

    return reply(200, {
      tool_id: tool.tool_id,
      version: tool.version,
      exec_ulid: execUlid,
      data: result.data,
      usage: {
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        cost_usd: result.cost_usd,
        deployment: result.deployment,
      },
    });
  } catch (err) {
    // A failed run is still a run: the EXEC row lands with status "throw"
    // so the project ledger shows the attempt (C-4 — a failure that
    // leaves no trace is a silent failure).
    const message = err instanceof Error ? err.message : String(err);
    await appendExecution({
      project_id: projectId as ProjectId,
      agent_slug: OPERATOR_SLUG,
      exec_ulid: execUlid,
      skill_name: `tool:${tool.tool_id}`,
      skill_version: tool.version,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      status: "throw",
      used_credential_types: [...tool.requires],
      error: message.slice(0, 1000),
    }).catch((ledgerErr) => {
      console.error(
        JSON.stringify({
          event: "tools_api_ledger_write_failed",
          message: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
        }),
      );
    });

    console.error(
      JSON.stringify({ event: "tools_api_run_failed", tool_id: tool.tool_id, message }),
    );
    // The message is surfaced to the operator on purpose: "the deployment
    // is not provisioned", "the completion was truncated", "the budget cap
    // would be exceeded" are all actionable, and hiding them behind a
    // generic 502 is what made the original mini-apps hard to run.
    return reply(502, { error: "tool_run_failed", detail: message.slice(0, 1000) });
  }
}

/**
 * Check the submitted values against the tool's `input` JSON Schema.
 *
 * A deliberately small subset — required, type, enum, maxLength — matching
 * exactly what validate-tools.mjs permits a tool to declare and what the
 * console can draw. Anything richer would be a second schema engine with
 * its own drift; the tool schema stays narrow so this can stay narrow.
 * Exported for tests.
 */
export function validateInput(
  tool: Pick<ToolDefinition, "input">,
  input: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const schema = tool.input as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const props = schema.properties ?? {};

  for (const name of schema.required ?? []) {
    const value = input[name];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      errors.push(`${name} is required`);
    }
  }
  for (const [name, value] of Object.entries(input)) {
    const field = props[name];
    if (!field) {
      // Undeclared keys are rejected rather than ignored: silently
      // dropping one means the operator's typo'd field never reaches the
      // model and the result looks fine.
      errors.push(`${name} is not an input of this tool`);
      continue;
    }
    if (value === undefined || value === null) continue;
    const expected = field.type as string;
    const actual = Array.isArray(value) ? "array" : typeof value;
    const typeOk =
      (expected === "string" && actual === "string") ||
      (expected === "boolean" && actual === "boolean") ||
      ((expected === "integer" || expected === "number") && actual === "number");
    if (!typeOk) {
      errors.push(`${name} must be a ${expected} (got ${actual})`);
      continue;
    }
    if (expected === "integer" && !Number.isInteger(value)) {
      errors.push(`${name} must be an integer`);
    }
    if (Array.isArray(field.enum) && !field.enum.includes(value as never)) {
      errors.push(`${name} must be one of: ${(field.enum as unknown[]).join(", ")}`);
    }
    if (
      typeof field.maxLength === "number" &&
      typeof value === "string" &&
      value.length > field.maxLength
    ) {
      errors.push(`${name} is ${value.length} characters; the maximum is ${field.maxLength}`);
    }
  }
  return errors;
}

/**
 * Build the user message from the submitted fields.
 *
 * Field values are operator-supplied free text, so they are labelled and
 * fenced rather than interpolated into instructions — the system prompt
 * carries the instructions, and this carries data. Exported for tests.
 */
export function renderUserMessage(
  tool: Pick<ToolDefinition, "input">,
  input: Record<string, unknown>,
): string {
  const props =
    (tool.input as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};
  const parts: string[] = [];
  // Declaration order, not submission order, so the prompt is stable
  // across callers.
  for (const [name, field] of Object.entries(props)) {
    const value = input[name];
    if (value === undefined || value === null || value === "") continue;
    const label = (field.title as string) ?? name;
    parts.push(`## ${label}\n\n${String(value).trim()}`);
  }
  return parts.join("\n\n");
}

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
