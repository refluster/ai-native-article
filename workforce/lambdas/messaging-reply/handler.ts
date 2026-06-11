// wf-messaging-reply — the real-time talent reply path (Epic-013 Story 3).
//
// Architecture (ADR-0006): this is a deliberate, narrow *second* execution
// surface alongside the batch CCR runner (ADR-0005). The operator↔talent
// messaging UX needs a reply within seconds, not on the 2-hour orchestrator
// tick, so `POST /threads/{id}/messages` async-invokes this Lambda, which:
//
//   1. loads the thread transcript (shared/messaging.ts, direct DDB),
//   2. composes the addressed agent's persona (`agents/{slug}/system.md`,
//      bundled into this artefact) + a tight reply prompt,
//   3. calls Claude once (shared/llm-anthropic.ts — same `wf/anthropic`
//      secret every other agent uses; no new credential),
//   4. enforces the W-1 editorial guards (finish_reason==='length' throw via
//      `complete()`, LLM-artefact head regex, empty-body throw),
//   5. writes the talent MSG# row via shared sendMessage() — same trust
//      domain as the operator route, so no bearer endpoint is needed.
//
// Loop safety (the property that bounds cost — Epic §6): a reply is caused
// ONLY by an inbound operator/peer message, and an agent never replies to
// its own last message. This Lambda writes via the shared module, not the
// HTTP route, so a reply never re-invokes this function — the chain
// terminates by construction. A per-thread daily budget is the backstop.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

import { complete } from "../shared/llm-anthropic.js";
import {
  MESSAGING_OPERATOR_ID,
  getThreadDetail,
  sendMessage,
} from "../shared/messaging.js";
import { buildRecallBlock } from "../shared/recall-prompt.js";
import { readIndex, readChunk } from "../shared/memory.js";
import type { ProjectId } from "../shared/project.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_ROOT = process.env.AGENTS_ROOT ?? join(HERE, "agents");
const STAGE = process.env.STAGE ?? "dev";

/** Bumped when the reply prompt/guard contract changes (lands on MSG rows
 *  as `skill_version`, mirroring the cadence skills' versioning).
 *  0.2.0: recall packet (EXEC recall + latest memory summary) grounding. */
const SKILL_VERSION = "0.2.0";

/** Cap on the memory-summary excerpt folded into the system prompt. The
 *  rolling summary can grow; a reply needs the gist, not the archive. */
const MEMORY_EXCERPT_CHARS = 1200;

const NO_REPLY_TOKEN = "__NO_REPLY_NEEDED__";

// A work-register reply is 1–4 sentences; 400 visible tokens is generous.
// reasoningBudgetTokens is the thinking on-switch + max_tokens headroom
// (complete() sends ADAPTIVE thinking on supported models, omits it on
// Haiku) — keep it ≥ the visible cap so reasoning cannot starve the prose
// budget (same class of bug as the L2 truncation; see llm-anthropic.ts).
// History: 1000 (< the legacy 1024 budget floor) 400'd every call, and the
// legacy enabled+budget_tokens shape itself 400'd on opus-4-7 (Maya) —
// both now guarded/handled in complete().
const REPLY_MAX_TOKENS = 400;
const REPLY_REASONING_TOKENS = 2048;

/** Per-thread reply budget per UTC day. Never trips in normal single-operator
 *  use; it's the seatbelt against a bug that re-fires (Epic §6). */
const REPLIES_PER_THREAD_PER_DAY = Number(process.env.WF_MSG_REPLY_BUDGET ?? "50");

// Mirrors workforce/lambdas/shared/post.ts LLM_ARTEFACT_PATTERNS by design:
// each W-1 enforcer self-contains its guard rather than trusting an upstream
// caller. Checked over the first 50 chars of the trimmed reply body.
const LLM_ARTEFACT_PATTERNS: readonly RegExp[] = [
  /^as an ai/i,
  /^here is the/i,
  /^here's the/i,
  /^i apologi[sz]e/i,
  /^certainly[!,]/i,
  /^sure[!,]/i,
  /^of course[!,]/i,
];

// The voice work is done by the agent's system.md; this only sets the
// channel contract (Epic §4). Kept terse so the persona dominates.
const REPLY_INSTRUCTIONS = [
  "You are replying inside a direct-message thread. The transcript below is the",
  "primary material, most recent message last. Messages from the human operator",
  "are labelled `Operator`; your own past messages are labelled `You`.",
  "",
  "Write ONE reply, in your own voice (first-person, work-register). 1–4",
  "sentences. No headers, no bullet lists, no greeting boilerplate — this is a",
  "message, not a document. Answer from your actual work; do not invent facts.",
  "When a 'Relevant past work' or 'Your memory' section is present below, treat",
  "it as your own private notes: ground your answer in it, but never quote it",
  "verbatim or mention that you were given notes.",
  "",
  `If the last message needs no reply — an acknowledgement ("Nice. Ship it."),`,
  "a closing, or a message clearly addressed to someone else in a group — output",
  `the literal token ${NO_REPLY_TOKEN} and nothing else.`,
  "",
  "Never address yourself, never start a new topic, never reply to your own message.",
].join("\n");

const cw = new CloudWatchClient({});

/** Fire-and-forget metric. Never awaited, never throws — a metric failure
 *  must not mask the reply outcome (same discipline as project.ts). */
function emitMetric(name: string, dims: Record<string, string> = {}): void {
  cw.send(
    new PutMetricDataCommand({
      Namespace: "Workforce/Messaging",
      MetricData: [
        {
          MetricName: name,
          Value: 1,
          Unit: "Count",
          Dimensions: [
            { Name: "Stage", Value: STAGE },
            ...Object.entries(dims).map(([Name, Value]) => ({ Name, Value })),
          ],
        },
      ],
    }),
  ).catch((err) => {
    console.warn(JSON.stringify({ event: "messaging_reply_metric_emit_failed", name, error: String(err) }));
  });
}

export interface MessagingReplyEvent {
  thread_id: string;
  addressed_slug: string;
}

interface AgentCard {
  model: string;
  systemMd: string;
}

async function loadAgent(slug: string): Promise<AgentCard> {
  const cfg = JSON.parse(await readFile(join(AGENTS_ROOT, slug, "agent.json"), "utf8")) as { model: string };
  const systemMd = await readFile(join(AGENTS_ROOT, slug, "system.md"), "utf8");
  return { model: cfg.model, systemMd };
}

/** Assemble the grounding packet (Epic-013 §4: "answer *from your work*, not
 *  from invention"): semantic recall over the agent's own EXEC ledger keyed
 *  on the inbound message, plus the tail of the latest rolling memory
 *  summary. Both legs fail-soft — a missing Voyage key, an un-embedded
 *  ledger or an absent memory index yields a smaller packet, never a failed
 *  reply (buildRecallBlock carries the same contract internally). */
async function assembleWorkContext(slug: string, inbound: string): Promise<string> {
  const sections: string[] = [];

  // renderRecallBlock supplies its own "## Relevant past work" header and
  // enforces RECALL_BLOCK_CHAR_CAP; empty ledger → "".
  const recallBlock = await buildRecallBlock({
    caller_agent_slug: slug,
    brief: inbound.slice(0, 300),
    skillName: "messaging-reply",
    projectId: `self/${slug}` as ProjectId,
  });
  if (recallBlock) sections.push(recallBlock.trim());

  try {
    const idx = await readIndex(slug);
    const key = idx?.latest_summary_key ?? idx?.latest_chunk_key ?? undefined;
    if (key) {
      const chunk = await readChunk(key);
      const excerpt =
        chunk.length > MEMORY_EXCERPT_CHARS
          ? `${chunk.slice(0, MEMORY_EXCERPT_CHARS)}\n…(older memory omitted)`
          : chunk;
      sections.push(`## Your memory (latest summary)\n\n${excerpt.trim()}`);
    }
  } catch (err) {
    console.warn(
      JSON.stringify({ event: "messaging_reply_memory_skipped", slug, error: String(err) }),
    );
  }

  return sections.join("\n\n");
}

function buildTranscript(
  messages: ReadonlyArray<{ from: string; body: string }>,
  selfSlug: string,
): string {
  return messages
    .slice(-20)
    .map((m) => {
      const who = m.from === MESSAGING_OPERATOR_ID ? "Operator" : m.from === selfSlug ? "You" : m.from;
      return `${who}: ${m.body}`;
    })
    .join("\n\n");
}

export interface MessagingReplyResult {
  status: "ok" | "skipped";
  reason?: string;
  message_id?: string;
}

export async function handler(event: MessagingReplyEvent): Promise<MessagingReplyResult> {
  const { thread_id, addressed_slug } = event ?? {};
  // Structured entry log: with async fire-and-forget dispatch, "was the
  // Lambda even invoked?" is the first triage question — answer it in one
  // log line rather than by inference.
  console.log(JSON.stringify({ event: "messaging_reply_invoked", thread_id, addressed_slug }));
  if (!thread_id || !addressed_slug) {
    throw new Error("messaging-reply: missing thread_id or addressed_slug");
  }
  if (addressed_slug === MESSAGING_OPERATOR_ID) {
    // The operator never gets a generated reply — only talents do.
    throw new Error("messaging-reply: addressed_slug must be a talent, not the operator");
  }

  const detail = await getThreadDetail(thread_id);
  if (!detail) throw new Error(`messaging-reply: thread ${thread_id} not found`);
  if (!detail.participants.includes(addressed_slug)) {
    throw new Error(`messaging-reply: ${addressed_slug} is not a participant of ${thread_id}`);
  }

  // Loop safety: reply only to an inbound message. If the last message is
  // already ours, there is nothing to answer — a stale/duplicate invoke.
  const last = detail.messages[detail.messages.length - 1];
  if (!last || last.from === addressed_slug) {
    emitMetric("WfMsgReplySkipped", { Reason: "no_inbound" });
    return { status: "skipped", reason: "no_inbound" };
  }

  // Cost backstop: cap replies per thread per UTC day.
  const today = new Date().toISOString().slice(0, 10);
  const repliesToday = detail.messages.filter(
    (m) => m.from === addressed_slug && m.at.slice(0, 10) === today,
  ).length;
  if (repliesToday >= REPLIES_PER_THREAD_PER_DAY) {
    emitMetric("WfMsgBudgetExceeded", { Slug: addressed_slug });
    throw new Error(
      `messaging-reply: per-thread daily reply budget exhausted (${repliesToday}/${REPLIES_PER_THREAD_PER_DAY}) for ${thread_id}`,
    );
  }

  const agent = await loadAgent(addressed_slug);
  const transcript = buildTranscript(detail.messages, addressed_slug);
  const workContext = await assembleWorkContext(addressed_slug, last.body);

  // complete() throws on stop_reason==='max_tokens' — that IS the W-1
  // finish_reason==='length' guard (a 1–4 sentence reply that truncates is a
  // real signal, not an expected case). We let it propagate.
  const out = await complete({
    model: agent.model,
    system: [agent.systemMd, REPLY_INSTRUCTIONS, workContext]
      .filter((s) => s.length > 0)
      .join("\n\n---\n\n"),
    user: transcript,
    maxTokens: REPLY_MAX_TOKENS,
    reasoningBudgetTokens: REPLY_REASONING_TOKENS,
  });

  const body = out.text.trim();

  // The W-4 fail-loud path against a fabricated reply to a non-question.
  if (body === NO_REPLY_TOKEN || body.startsWith(NO_REPLY_TOKEN)) {
    emitMetric("WfMsgNoReply", { Slug: addressed_slug });
    return { status: "skipped", reason: "no_reply_needed" };
  }
  if (body.length === 0) {
    emitMetric("WfMsgReplyThrow", { Reason: "empty_body" });
    throw new Error("messaging-reply: empty reply body after trim");
  }
  const head = body.slice(0, 50);
  for (const re of LLM_ARTEFACT_PATTERNS) {
    if (re.test(head)) {
      emitMetric("WfMsgReplyThrow", { Reason: "llm_artefact" });
      throw new Error(`messaging-reply: llm_artefact_in_head: ${re.source}`);
    }
  }

  const { message_id } = await sendMessage({
    thread_id,
    from: addressed_slug,
    body,
    finish_reason: out.stop_reason,
    tokens_in: out.tokens_in,
    tokens_out: out.tokens_out,
    skill_version: SKILL_VERSION,
  });

  emitMetric("WfMsgReply", { Slug: addressed_slug });
  return { status: "ok", message_id };
}
