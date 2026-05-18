// wf-agent-runner Lambda handler.
//
// Invoked async by the orchestrator (PR6c) with a payload identifying
// one agent and one task. Composes the shared libs into the v1 run loop:
//
//   1. Load agent META (identity + operational) from DDB.
//   2. Refuse if archived or paused.
//   3. Read memory INDEX + the latest chunk from S3.
//   4. Pre-flight budget guard (W-3).
//   5. Build prompt from system.md + memory + task brief.
//   6. Call Anthropic. Throws on stop_reason=max_tokens (W-1 / W-4).
//   7. Write the artefact to S3 (workforce SoT). For type=article also
//      insert into Notion (existing GAS L4 picks it up).
//   8. Append a memory chunk (memver conditional).
//   9. Record RUN + DELIV rows and roll up BUDGET.
//
// Failure modes throw and the alarm fires; partial state is acceptable
// per W-4 (caller / DLQ logic in PR6c handles retry vs report).

import type { Context } from "aws-lambda";
import {
  agentPk,
  type AgentMetaRow,
  type AgentOperational,
} from "../shared/agent.js";
import { getItem, putItem, updateOperational } from "../shared/ddb.js";
import { complete } from "../shared/llm-anthropic.js";
import { assertWithinBudget, recordSpend } from "../shared/budget.js";
import { readIndex, readChunk, appendChunk } from "../shared/memory.js";
import { insertArticle } from "../shared/notion.js";
import { deliverableTargetFor, writeDeliverableArtefact } from "../shared/deliverable.js";
import { dispatchEngineer } from "../shared/github.js";
import {
  newUlid,
  type DelivRow,
  type RunRow,
  type TaskKind,
} from "../shared/task.js";

export interface RunnerEvent {
  /** Agent slug to run. */
  agent: string;
  /** Task kind drives prompt + deliverable type. */
  task_kind: TaskKind;
  /** Optional TASK#{ulid} reference. Orchestrator-created tasks set this. */
  task_id?: string;
  /** Optional brief overriding the default task description for this kind. */
  brief?: string;
  /** When true, do everything except the LLM call + side effects. For smoke tests. */
  dryRun?: boolean;
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

const MAX_OUTPUT_TOKENS = 8000;        // floor per docs/azure-budget-rules.md analogue
const PROJECTED_RUN_COST_USD = 0.50;   // conservative pre-flight ceiling; per-model below

export async function handler(event: RunnerEvent, context: Context): Promise<RunnerResult> {
  const startedAt = new Date().toISOString();
  const runId = newUlid();

  // 1. Load agent META.
  const agent = await getItem<AgentMetaRow>(agentPk(event.agent), "META");
  if (!agent) {
    return await failRun(event.agent, runId, startedAt, "agent_not_found");
  }

  // 2. Refuse if archived or paused.
  if (agent.archived) {
    return await skipRun(event.agent, runId, startedAt, "archived");
  }
  if (agent.paused) {
    return await skipRun(event.agent, runId, startedAt, "paused");
  }

  // 3. Memory.
  const index = await readIndex(event.agent);
  const memver = index?.memver ?? 0;
  const previousChunk =
    index?.latest_chunk_key ? await readChunk(index.latest_chunk_key) : "";

  // 4. Budget pre-flight.
  const cap = effectiveBudgetCap(agent);
  await assertWithinBudget(event.agent, cap, PROJECTED_RUN_COST_USD);

  // 5. Build prompt.
  const system = await loadSystemMd(event.agent);
  const userPrompt = buildUserPrompt(event, previousChunk);

  if (event.dryRun) {
    return {
      status: "ok",
      run_id: runId,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
    };
  }

  // 6. LLM call. W-1 / W-4 enforced inside complete().
  let llm;
  try {
    llm = await complete({
      model: agent.model,
      system,
      user: userPrompt,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    return await throwRun(event.agent, runId, startedAt, err);
  }

  // 7. Deliverable.
  // - article/plan/design-doc/launch-plan: write artefact body to S3 (SoT),
  //   article also publishes to Notion (GAS L4 picks up).
  // - pr (Ren): R-N1 exception. LLM produces a *brief* (not code). Lambda
  //   writes the brief to S3 + dispatches GHA workflow_dispatch. The
  //   eventual PR is found asynchronously by the orchestrator's poll step.
  const delivId = newUlid();
  let delivRow: DelivRow;
  let notionUrl: string | undefined;

  if (agent.code_execution === "claude-code-routine-on-gha" && agent.primary_deliverable_type === "pr") {
    delivRow = await dispatchPrPath(event.agent, agent, delivId, startedAt, event.task_kind, llm.text);
  } else {
    const target = deliverableTargetFor(event.agent, agent.primary_deliverable_type, delivId);
    await writeDeliverableArtefact(target, llm.text);

    let notionPageId: string | undefined;
    if (target.hasExternalPublish && agent.primary_deliverable_type === "article") {
      const title = extractTitle(llm.text) ?? `${agent.first_name} ${agent.last_name} — ${event.task_kind} ${startedAt}`;
      const notion = await insertArticle({
        title,
        bodyMarkdown: llm.text,
        author: event.agent,
        kind: agent.primary_deliverable_kind,
        provenance: `${event.agent}-${event.task_kind}`,
      });
      notionUrl = notion.url;
      notionPageId = notion.pageId;
    }

    delivRow = {
      pk: agentPk(event.agent),
      sk: `DELIV#${delivId}`,
      type: agent.primary_deliverable_type,
      kind: agent.primary_deliverable_kind,
      project_id: agent.default_project,
      s3_key: target.s3Key,
      notion_page_id: notionPageId,
      created_at: startedAt,
      published_at: notionPageId ? new Date().toISOString() : undefined,
    };
    await putItem(delivRow);
  }

  // 8. Append memory chunk.
  const chunkBody = buildMemoryChunk(event.agent, runId, llm.text, previousChunk);
  await appendChunk(event.agent, chunkBody, summaryOf(llm.text), memver);

  // 9. RUN row + BUDGET roll-up.
  const endedAt = new Date().toISOString();
  const runRow: RunRow = {
    pk: agentPk(event.agent),
    sk: `RUN#${runId}`,
    task_id: event.task_id,
    status: "ok",
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
    started_at: startedAt,
    ended_at: endedAt,
  };
  await putItem(runRow);
  await recordSpend(event.agent, llm.tokens_in, llm.tokens_out, llm.cost_usd);
  await updateLastRun(event.agent, endedAt, "ok");

  return {
    status: "ok",
    run_id: runId,
    deliv_id: delivId,
    notion_page_url: notionUrl,
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
  };
}

function effectiveBudgetCap(agent: AgentMetaRow): number {
  return agent.budget_monthly_usd_override ?? agent.budget_monthly_usd_default;
}

/**
 * Ren's R-N1 exception path. The LLM has already produced a *brief*
 * (governed by Ren's system.md). We:
 *   1. Persist the brief to S3 (workforce SoT).
 *   2. workflow_dispatch -> wf-engineer.yml on the target repo, passing
 *      the brief + dispatch_branch in the workflow inputs.
 *   3. Write a pending DELIV row. The orchestrator's poll step will
 *      promote it to ok when the PR appears, or to timeout after 24h.
 *
 * Env vars (set on the agent-runner Lambda by SAM):
 *   ENGINEER_OWNER     GitHub org/user (default "refluster")
 *   ENGINEER_REPO      Repo name (default "ai-native-article")
 *   ENGINEER_WORKFLOW  Workflow filename (default "wf-engineer.yml")
 *   ENGINEER_REF       Ref to dispatch from (default "main")
 */
async function dispatchPrPath(
  slug: string,
  agent: AgentMetaRow,
  delivId: string,
  startedAt: string,
  taskKind: TaskKind,
  briefBody: string,
): Promise<DelivRow> {
  const owner = process.env.ENGINEER_OWNER ?? "refluster";
  const repo = process.env.ENGINEER_REPO ?? "ai-native-article";
  const workflow = process.env.ENGINEER_WORKFLOW ?? "wf-engineer.yml";
  const ref = process.env.ENGINEER_REF ?? "main";

  // Persist the brief. Note: deliverableTargetFor throws for pr; we use a
  // dedicated pr-briefs/{slug}/{deliv-id}.md key here, in keeping with the
  // data-model.md prefix layout (one prefix per artefact-kind).
  const briefKey = `pr-briefs/${slug}/${delivId}.md`;
  await writeDeliverableArtefact(
    { type: "pr", s3Key: briefKey, hasExternalPublish: true },
    briefBody,
  );

  const dispatchBranch = `${slug}/${delivId}`;

  await dispatchEngineer({
    owner,
    repo,
    workflow,
    ref,
    inputs: {
      brief: briefBody,
      task_id: delivId,
      branch: dispatchBranch,
    },
  });

  const row: DelivRow = {
    pk: agentPk(slug),
    sk: `DELIV#${delivId}`,
    type: "pr",
    kind: agent.primary_deliverable_kind,
    project_id: agent.default_project,
    s3_key: briefKey,
    status: "pending",
    dispatched_at: new Date().toISOString(),
    dispatch_branch: dispatchBranch,
    created_at: startedAt,
    // pr_url + published_at set when the orchestrator's poll step finds the PR.
  };
  await putItem(row);
  void taskKind; // recorded via the RUN row's task_id; deliv row doesn't carry it
  return row;
}

async function loadSystemMd(slug: string): Promise<string> {
  // The runner Lambda's Makefile (PR6b SAM addition) copies
  // workforce/agents/{slug}/system.md into the bundle alongside
  // handler.mjs. Same pattern as seed-agents.
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  return await readFile(join(here, "agents", slug, "system.md"), "utf8");
}

function buildUserPrompt(event: RunnerEvent, previousChunk: string): string {
  const brief = event.brief ?? defaultBriefFor(event.task_kind);
  const memorySection = previousChunk
    ? `\n## Your memory from the previous run\n\n${previousChunk}\n`
    : "";
  return `# Task: ${event.task_kind}\n\n${brief}${memorySection}\n\nProduce the deliverable. Begin with a clear title on the first line.`;
}

function defaultBriefFor(kind: TaskKind): string {
  switch (kind) {
    case "l0-to-l1":
      return "Pick one pending L0 source entry that is most worth covering. Produce one 400-800 word L1 article in Japanese with one observation, one inference, and one disclosure per paragraph. Append the bias disclosure footer.";
    case "weekly-synthesis":
      return "Integrate the week's external signals you have memory of into one 800-1500 word synthesis article in Japanese with a falsifiable position.";
    case "hypothesis":
      return "State one hypothesis, why now, what would falsify it, and the next step if false. 600-1200 words.";
    case "tech-note":
      return "Explain one technical decision or bug fix in 400-1000 words.";
    case "design":
      return "Produce one design note: intent, IA, components, acceptance criteria.";
    case "launch":
      return "Produce one launch artefact: positioning, audience, channel, success metric, retraction trigger.";
    case "pr":
      return "Produce a task brief for the engineer routine: what to change, why, and acceptance criteria. (R-N1 exception path.)";
    default:
      return "Produce the deliverable appropriate to your role.";
  }
}

function extractTitle(markdown: string): string | undefined {
  const first = markdown.split("\n", 1)[0]?.trim() ?? "";
  if (!first) return undefined;
  // Strip a leading `# ` if present.
  return first.replace(/^#+\s*/, "").slice(0, 200);
}

function buildMemoryChunk(
  slug: string,
  runId: string,
  body: string,
  previousChunk: string,
): string {
  const now = new Date().toISOString();
  const previousNote = previousChunk ? "\n\n## Previous chunk pointer\n(see latest_chunk_key in INDEX)\n" : "";
  return `---
slug: ${slug}
run_id: ${runId}
created_at: ${now}
---

## What I produced this run

${body.slice(0, 4000)}${previousNote}
`;
}

function summaryOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 480);
}

async function skipRun(
  slug: string,
  runId: string,
  startedAt: string,
  reason: string,
): Promise<RunnerResult> {
  const row: RunRow = {
    pk: agentPk(slug),
    sk: `RUN#${runId}`,
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
  reason: string,
): Promise<RunnerResult> {
  const row: RunRow = {
    pk: agentPk(slug),
    sk: `RUN#${runId}`,
    status: "throw",
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    error_message: reason,
  };
  await putItem(row);
  // Don't silently succeed — surface the failure to the caller / alarm.
  throw new Error(`runner failed for ${slug}: ${reason}`);
}

async function throwRun(
  slug: string,
  runId: string,
  startedAt: string,
  err: unknown,
): Promise<RunnerResult> {
  const msg = err instanceof Error ? err.message : String(err);
  const row: RunRow = {
    pk: agentPk(slug),
    sk: `RUN#${runId}`,
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
  // Best-effort; we don't fail the run if META update fails.
  try {
    await updateOperational(agentPk(slug), "META", {
      last_run_at: ts,
      last_run_status: status,
    });
  } catch (err) {
    console.warn(`updateLastRun(${slug}) failed:`, err);
  }
}
