// wf-agent-runner Lambda handler.
//
// Invoked async by the orchestrator with a payload identifying one
// agent and one binding index. The binding names the skill; the skill's
// meta.executor selects the runtime path:
//
//   llm-prose            LLM call → S3 artefact → (optional) Notion publish
//   claude-code-routine  LLM brief → GHA workflow_dispatch → pending DELIV
//   deterministic        Registered handler → S3 audit artefact (no LLM)
//
// All three paths land:
//   - one RUN row with output_s3_key + summary + timing + status
//   - one memory chunk appended to S3 (the agent's narrative)
//   - a DELIV row only when there is a queryable external resource
//     (Notion page / pending GitHub PR)

import type { Context } from "aws-lambda";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { agentPk, bindingCron, type AgentBinding, type AgentMetaRow, type AgentOperational } from "../shared/agent.js";
import { getItem, putItem, updateOperational } from "../shared/ddb.js";
import { complete } from "../shared/llm-anthropic.js";
import { assertWithinBudget, recordSpend } from "../shared/budget.js";
import {
  injectCredentials,
  type CredentialBag,
  type CredentialKey,
} from "../shared/credential-injector.js";
import {
  appendExecution,
  asProjectId,
  selfProjectId,
  type ExecStatus,
  type ProjectId,
} from "../shared/project.js";
import { readIndex, readChunk, appendChunk } from "../shared/memory.js";
import { insertArticle } from "../shared/notion.js";
import {
  deliverableTargetFor,
  writeDeliverableArtefact,
  writeRunArtefact,
} from "../shared/deliverable.js";
import { dispatchEngineer } from "../shared/github.js";
import { composeSystemPrompt, loadSkill, type LoadedSkill } from "../shared/skill.js";
import { getDeterministicHandler } from "../shared/skill-registry.js";
import { newUlid, type DelivRow, type RunRow } from "../shared/task.js";

export interface RunnerEvent {
  /** Agent slug to run. */
  agent: string;
  /** Which entry in agent.bindings[] fired. */
  binding_idx: number;
  /** Optional operator brief — only the llm-prose path consumes it. */
  brief?: string;
  /** When true, do everything except the LLM call + side effects. */
  dryRun?: boolean;
  /** Project to attribute this execution to (Epic-010 Story 1-B).
   *  Defaults to `self/{agent}` if not provided. Forward-compat for the
   *  TASK.project_id flow that future Stories wire through — orchestrator
   *  is unchanged in Story 1-B (still sends `{agent, binding_idx}` only).
   *  Validated via `asProjectId()` inside `resolveProjectId()` at the
   *  dual-write seam (wire format is raw string; brand applies after). */
  project_id?: string;
}

export interface RunnerResult {
  status: "ok" | "skipped" | "throw";
  run_id: string;
  deliv_id?: string;
  notion_page_url?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  skip_reason?: string;
  error_message?: string;
}

const MAX_OUTPUT_TOKENS = 8000;
const PROJECTED_RUN_COST_USD = 0.50;

export async function handler(event: RunnerEvent, context: Context): Promise<RunnerResult> {
  const startedAt = new Date().toISOString();
  const runId = newUlid();

  const agent = await getItem<AgentMetaRow>(agentPk(event.agent), "META");
  if (!agent) {
    return await failRun(event.agent, runId, startedAt, "anywhere", "agent_not_found");
  }
  if (agent.archived) return await skipRun(event.agent, runId, startedAt, "archived");
  if (agent.paused) return await skipRun(event.agent, runId, startedAt, "paused");

  const binding = agent.bindings[event.binding_idx];
  if (!binding) {
    return await failRun(event.agent, runId, startedAt, "anywhere", `binding_idx ${event.binding_idx} not found`);
  }

  let skill: LoadedSkill;
  try {
    skill = await loadSkill(binding.skill);
  } catch (err) {
    return await failRun(
      event.agent,
      runId,
      startedAt,
      binding.skill,
      `skill_load_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Memory + budget pre-flight are common to all executors; deterministic
  // skills cost ~0 but a budget breach should still throw.
  const index = await readIndex(event.agent);
  const memver = index?.memver ?? 0;
  const previousChunk = index?.latest_chunk_key ? await readChunk(index.latest_chunk_key) : "";
  await assertWithinBudget(event.agent, effectiveBudgetCap(agent), PROJECTED_RUN_COST_USD);

  if (event.dryRun) {
    return { status: "ok", run_id: runId, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  }

  // Build the sealed credential bag BEFORE entering the executor switch,
  // so a missing-credential failure flows through the normal throwRun
  // path (logged + dual-write-emit + propagated). Empty `requires`
  // yields a bag with no readable keys; the skill still receives it on
  // ctx.credentials but any read throws (W-2 trust boundary).
  // Story 2-B (#91): injection happens at the runner seam, NOT inside
  // each executor, so all three paths use identical resolution rules.
  let result: RunnerResult;
  try {
    const credentials = await buildCredentialBag(event, skill);
    switch (skill.meta.executor) {
      case "deterministic":
        result = await runDeterministic(event, agent, binding, skill, runId, startedAt, credentials);
        break;
      case "claude-code-routine":
        result = await runClaudeCodeRoutine(event, agent, binding, skill, runId, startedAt, previousChunk, credentials);
        break;
      case "llm-prose":
      default:
        result = await runLlmProse(event, agent, binding, skill, runId, startedAt, previousChunk, credentials);
        break;
    }
  } catch (err) {
    return await throwRun(event.agent, runId, startedAt, binding, skill, err);
  }

  // Memory chunk for self-reference: every run feeds the agent's narrative.
  const chunkBody = buildMemoryChunk(event.agent, runId, binding, skill, result, previousChunk);
  await appendChunk(event.agent, chunkBody, summaryOf(result.error_message ?? result.notion_page_url ?? runId), memver);

  await recordSpend(event.agent, result.tokens_in ?? 0, result.tokens_out ?? 0, result.cost_usd ?? 0);
  await updateLastRun(event.agent, new Date().toISOString(), "ok");
  return result;
}

function effectiveBudgetCap(agent: AgentMetaRow): number {
  return agent.budget_monthly_usd_override ?? agent.budget_monthly_usd_default;
}

// --- deterministic executor ----------------------------------------------

async function runDeterministic(
  event: RunnerEvent,
  agent: AgentMetaRow,
  binding: AgentBinding,
  skill: LoadedSkill,
  runId: string,
  startedAt: string,
  credentials: CredentialBag,
): Promise<RunnerResult> {
  const handler = getDeterministicHandler(skill.meta.name);
  const result = await handler({ slug: event.agent, startedAt, credentials });

  const s3Key = await writeRunArtefact(event.agent, runId, result.outputExt, result.output);
  const endedAt = new Date().toISOString();

  const runRow: RunRow = {
    pk: agentPk(event.agent),
    sk: `RUN#${runId}`,
    binding_idx: event.binding_idx,
    skill_name: skill.meta.name,
    skill_version: skill.meta.version,
    cron: bindingCron(binding) ?? "",
    status: "ok",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    started_at: startedAt,
    ended_at: endedAt,
    output_s3_key: s3Key,
    output_summary: result.summary.slice(0, 240),
  };
  await writeRunAndExec(runRow, event, skill);

  return { status: "ok", run_id: runId, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
}

// --- llm-prose executor --------------------------------------------------

async function runLlmProse(
  event: RunnerEvent,
  agent: AgentMetaRow,
  binding: AgentBinding,
  skill: LoadedSkill,
  runId: string,
  startedAt: string,
  previousChunk: string,
  _credentials: CredentialBag,
): Promise<RunnerResult> {
  // _credentials: built + validated at the runner seam so a missing
  // declared credential fails the run loudly even though llm-prose
  // skills currently consume secrets indirectly (helpers in
  // shared/notion.ts, shared/llm-anthropic.ts read their own paths).
  // Future skills that thread credentials through the prompt will
  // accept the bag here.
  if (!skill.meta.deliverable) {
    throw new Error(`skill "${skill.meta.name}" is llm-prose but has no deliverable in meta.json`);
  }

  const baseSystem = await loadSystemMd(event.agent);
  const system = composeSystemPrompt(baseSystem, skill);
  const userPrompt = buildUserPrompt(event, previousChunk);

  const llm = await complete({
    model: agent.model,
    system,
    user: userPrompt,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  const delivId = newUlid();
  const target = deliverableTargetFor(event.agent, skill.meta.deliverable.type, delivId);
  await writeDeliverableArtefact(target, llm.text);
  const runArtefactKey = await writeRunArtefact(event.agent, runId, "md", llm.text);

  let notionPageId: string | undefined;
  let notionPageUrl: string | undefined;
  if (skill.meta.deliverable.publish_notion) {
    const title = extractTitle(llm.text) ?? `${agent.first_name} ${agent.last_name} — ${skill.meta.name} ${startedAt}`;
    const notion = await insertArticle({
      title,
      bodyMarkdown: llm.text,
      author: event.agent,
      kind: skill.meta.deliverable.type,
      provenance: `${event.agent}-${skill.meta.name}`,
    });
    notionPageUrl = notion.url;
    notionPageId = notion.pageId;
  }

  const endedAt = new Date().toISOString();

  const runRow: RunRow = {
    pk: agentPk(event.agent),
    sk: `RUN#${runId}`,
    binding_idx: event.binding_idx,
    skill_name: skill.meta.name,
    skill_version: skill.meta.version,
    cron: bindingCron(binding) ?? "",
    status: "ok",
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
    started_at: startedAt,
    ended_at: endedAt,
    output_s3_key: runArtefactKey,
    output_summary: summaryOf(llm.text),
  };
  await writeRunAndExec(runRow, event, skill);

  const delivRow: DelivRow = {
    pk: agentPk(event.agent),
    sk: `DELIV#${delivId}`,
    run_id: runId,
    type: skill.meta.deliverable.type,
    project_id: agent.default_project,
    notion_page_id: notionPageId,
    notion_page_url: notionPageUrl,
    created_at: startedAt,
    published_at: notionPageId ? endedAt : undefined,
  };
  await putItem(delivRow);

  return {
    status: "ok",
    run_id: runId,
    deliv_id: delivId,
    notion_page_url: notionPageUrl,
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
  };
}

// --- claude-code-routine executor ----------------------------------------

async function runClaudeCodeRoutine(
  event: RunnerEvent,
  agent: AgentMetaRow,
  binding: AgentBinding,
  skill: LoadedSkill,
  runId: string,
  startedAt: string,
  previousChunk: string,
  _credentials: CredentialBag,
): Promise<RunnerResult> {
  const baseSystem = await loadSystemMd(event.agent);
  const system = composeSystemPrompt(baseSystem, skill);
  const userPrompt = buildUserPrompt(event, previousChunk);

  const llm = await complete({
    model: agent.model,
    system,
    user: userPrompt,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  const delivId = newUlid();
  const owner = process.env.ENGINEER_OWNER ?? "refluster";
  // _credentials: see comment in runLlmProse — bag is built at the
  // runner seam for trust-boundary enforcement; the brief generator
  // currently does not thread it into the GHA workflow_dispatch payload.
  const repo = process.env.ENGINEER_REPO ?? "ai-native-article";
  const workflow = process.env.ENGINEER_WORKFLOW ?? "workforce-engineer-routine.yml";
  const ref = process.env.ENGINEER_REF ?? "main";

  const briefKey = `pr-briefs/${event.agent}/${delivId}.md`;
  await writeDeliverableArtefact(
    { type: "pr", s3Key: briefKey, hasExternalPublish: true } as never,
    llm.text,
  );
  const runArtefactKey = await writeRunArtefact(event.agent, runId, "md", llm.text);

  const dispatchBranch = `${event.agent}/${delivId}`;
  await dispatchEngineer({
    owner,
    repo,
    workflow,
    ref,
    inputs: { brief: llm.text, task_id: delivId, branch: dispatchBranch },
  });

  const endedAt = new Date().toISOString();

  const runRow: RunRow = {
    pk: agentPk(event.agent),
    sk: `RUN#${runId}`,
    binding_idx: event.binding_idx,
    skill_name: skill.meta.name,
    skill_version: skill.meta.version,
    cron: bindingCron(binding) ?? "",
    status: "ok",
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
    started_at: startedAt,
    ended_at: endedAt,
    output_s3_key: runArtefactKey,
    output_summary: summaryOf(llm.text),
  };
  await writeRunAndExec(runRow, event, skill);

  const delivRow: DelivRow = {
    pk: agentPk(event.agent),
    sk: `DELIV#${delivId}`,
    run_id: runId,
    type: "pr",
    project_id: agent.default_project,
    status: "pending",
    dispatched_at: endedAt,
    dispatch_branch: dispatchBranch,
    created_at: startedAt,
  };
  await putItem(delivRow);

  return {
    status: "ok",
    run_id: runId,
    deliv_id: delivId,
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
  };
}

// --- prompt + memory helpers ---------------------------------------------

async function loadSystemMd(slug: string): Promise<string> {
  // The Makefile bundles workforce/agents/{slug}/system.md alongside handler.mjs.
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  return await readFile(join(here, "agents", slug, "system.md"), "utf8");
}

function buildUserPrompt(event: RunnerEvent, previousChunk: string): string {
  const memorySection = previousChunk
    ? `\n## Your memory from the previous run\n\n${previousChunk}\n`
    : "";
  const operatorBrief = event.brief ? `\n\n## Operator brief\n\n${event.brief}\n` : "";
  return `# Active skill\n\nApply the active skill described in your system prompt and produce the deliverable.${operatorBrief}${memorySection}`;
}

function extractTitle(markdown: string): string | undefined {
  const first = markdown.split("\n", 1)[0]?.trim() ?? "";
  if (!first) return undefined;
  return first.replace(/^#+\s*/, "").slice(0, 200);
}

function buildMemoryChunk(
  slug: string,
  runId: string,
  binding: AgentBinding,
  skill: LoadedSkill,
  result: RunnerResult,
  previousChunk: string,
): string {
  const now = new Date().toISOString();
  const previousNote = previousChunk ? "\n\n## Previous chunk pointer\n(see latest_chunk_key in INDEX)\n" : "";
  return `---
slug: ${slug}
run_id: ${runId}
skill: ${skill.meta.name}@${skill.meta.version}
cron: ${bindingCron(binding) ?? ""}
created_at: ${now}
---

## What I did this run

skill=${skill.meta.name} status=${result.status} cost_usd=${result.cost_usd ?? 0}${previousNote}
`;
}

function summaryOf(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

// --- Epic-010 Story 1-B: dual-write execution ledger ---------------------
//
// Convention (enforced by absence-test in dual-write-tests.ts): the
// runner NEVER writes a RUN row via a raw `putItem(runRow)` call.
// Every RUN-row write goes through `writeRunAndExec(runRow, event, skill)`,
// which puts the RUN row AND attempts the dual-write EXEC row. New
// executor paths MUST follow this shape.
//
// Dual-write semantics:
//   - The legacy `AGENT#{slug}/RUN#{ulid}` row remains canonical until
//     Story 6 (#95) migrates the front-end.
//   - The new `PROJECT#{project_id}/EXEC#{ulid}` row is forward-canonical
//     but currently best-effort: failures log + emit a CloudWatch metric
//     (`Workforce/Runner / WfExecDualWriteFailed`) and DO NOT fail the
//     run. W-4 is preserved at the RUN-row level — the run still throws
//     or succeeds on its primary intent.
//   - Story 6 cutover prerequisite (#95): drain orphan-RUN backlog
//     (RUN rows whose EXEC sibling never landed) BEFORE flipping EXEC
//     to canonical, or audit rows are lost on the flip.
//
// Project resolution: event.project_id (forward-compat for the TASK
// path that future Stories wire through) wins; otherwise defaults to
// selfProjectId(agent). Cross-project denial inside appendExecution
// throws when the agent is not a member; that path also logs + emits
// the failure metric + continues.

const STAGE = process.env.STAGE ?? "dev";
const cw = new CloudWatchClient({});

function resolveProjectId(event: RunnerEvent): ProjectId {
  return event.project_id ? asProjectId(event.project_id) : selfProjectId(event.agent);
}

/**
 * Build the per-invocation sealed credential bag (Epic-010 Story 2-B).
 *
 * `requires` is read from skill.meta — Story 2-A's schema extension. An
 * absent / empty list produces a bag with no readable keys (correct for
 * every skill in the repo today; the wire-up is meaningful when skills
 * start declaring `requires` in follow-up PRs).
 *
 * Throws on any failure — missing project, undeclared key in `requires`,
 * missing Secrets Manager value. The outer try/catch in `handler()`
 * turns the throw into a normal RUN row with status="throw" and an
 * error_message, matching the existing skill-load / executor-error
 * handling shape.
 */
async function buildCredentialBag(
  event: RunnerEvent,
  skill: LoadedSkill,
): Promise<CredentialBag> {
  const projectId = resolveProjectId(event);
  const requires = (skill.meta.requires ?? []) as readonly CredentialKey[];
  return await injectCredentials(requires, projectId, {
    skillName: skill.meta.name,
  });
}

/** Single seam for RUN+EXEC dual-write. See the comment above for the
 *  rationale + the absence test that enforces this is the only path. */
async function writeRunAndExec(
  runRow: RunRow,
  event: RunnerEvent,
  skill: LoadedSkill,
): Promise<void> {
  await putItem(runRow);
  await dualWriteExec({
    event,
    runId: runRow.sk.replace(/^RUN#/, ""),
    skill,
    startedAt: runRow.started_at,
    endedAt: runRow.ended_at,
    status: runRow.status === "throw" ? "throw" : runRow.status === "skipped" ? "skipped" : "ok",
    error: runRow.error_message,
  });
}

interface DualWriteExecArgs {
  event: RunnerEvent;
  runId: string;
  skill: LoadedSkill;
  startedAt: string;
  endedAt: string;
  status: ExecStatus;
  error?: string;
}

async function dualWriteExec(args: DualWriteExecArgs): Promise<void> {
  const { event, runId, skill, startedAt, endedAt, status, error } = args;
  let projectId: ProjectId;
  try {
    projectId = resolveProjectId(event);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "exec-dual-write-skipped",
        reason: "invalid_project_id",
        run_id: runId,
        agent: event.agent,
        attempted_project_id: event.project_id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    await emitExecDualWriteFailedMetric("invalid_project_id");
    return;
  }
  try {
    await appendExecution({
      project_id: projectId,
      agent_slug: event.agent,
      exec_ulid: runId,
      skill_name: skill.meta.name,
      skill_version: skill.meta.version,
      started_at: startedAt,
      ended_at: endedAt,
      status,
      error,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "exec-dual-write-failed",
        run_id: runId,
        project_id: projectId,
        agent: event.agent,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    await emitExecDualWriteFailedMetric("append_execution_threw");
  }
}

async function emitExecDualWriteFailedMetric(reason: string): Promise<void> {
  // Best-effort: never fail the run on metric emission. The dual-write
  // failure itself has already been logged structurally above.
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Runner",
        MetricData: [
          {
            MetricName: "WfExecDualWriteFailed",
            Value: 1,
            Unit: "Count",
            Dimensions: [
              { Name: "Stage", Value: STAGE },
              { Name: "Reason", Value: reason },
            ],
          },
        ],
      }),
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "exec_dual_write_metric_emit_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// --- failure handling ----------------------------------------------------

async function skipRun(
  slug: string,
  runId: string,
  startedAt: string,
  reason: string,
): Promise<RunnerResult> {
  const row: RunRow = {
    pk: agentPk(slug),
    sk: `RUN#${runId}`,
    binding_idx: -1,
    skill_name: "",
    skill_version: "",
    cron: "",
    status: "skipped",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    skip_reason: reason,
  };
  await putItem(row);
  return { status: "skipped", run_id: runId, skip_reason: reason };
}

async function failRun(
  slug: string,
  runId: string,
  startedAt: string,
  skillName: string,
  reason: string,
): Promise<RunnerResult> {
  const row: RunRow = {
    pk: agentPk(slug),
    sk: `RUN#${runId}`,
    binding_idx: -1,
    skill_name: skillName,
    skill_version: "",
    cron: "",
    status: "throw",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    error_message: reason,
  };
  await putItem(row);
  throw new Error(`runner failed for ${slug}: ${reason}`);
}

async function throwRun(
  slug: string,
  runId: string,
  startedAt: string,
  binding: AgentBinding,
  skill: LoadedSkill,
  err: unknown,
): Promise<RunnerResult> {
  const msg = err instanceof Error ? err.message : String(err);
  const row: RunRow = {
    pk: agentPk(slug),
    sk: `RUN#${runId}`,
    binding_idx: -1,
    skill_name: skill.meta.name,
    skill_version: skill.meta.version,
    cron: bindingCron(binding) ?? "",
    status: "throw",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    error_message: msg.slice(0, 1024),
  };
  await putItem(row);
  await updateLastRun(slug, row.ended_at, "throw");
  throw err;
}

async function updateLastRun(
  slug: string,
  ts: string,
  status: AgentOperational["last_run_status"],
): Promise<void> {
  try {
    await updateOperational(agentPk(slug), "META", {
      last_run_at: ts,
      last_run_status: status,
    });
  } catch (err) {
    console.warn(`updateLastRun(${slug}) failed:`, err);
  }
}
