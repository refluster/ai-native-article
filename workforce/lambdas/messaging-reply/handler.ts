// wf-messaging-reply — the real-time talent reply path (Epic-013 Story 3).
//
// Architecture (ADR-0006): this is a deliberate, narrow *second* execution
// surface alongside the batch CCR runner (ADR-0005). The operator↔talent
// messaging UX needs a reply within seconds, not on the 2-hour orchestrator
// tick, so `POST /threads/{id}/messages` async-invokes this Lambda, which:
//
//   1. loads the thread transcript (shared/messaging.ts, direct DDB),
//   2. composes the addressed agent's persona from the AGENT#{slug}/META
//      row (`model` + inline `system_prompt` — the single source per
//      ADR-0007; the bundled-file fallback retired with step 6b) + a
//      tight reply prompt,
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
// HTTP route, so a reply never starts a new round. A per-thread daily budget
// is the backstop.
//
// Group rounds (workforce/adr-0047): in a group thread one operator message
// starts a round — every member (or every @-addressed member) replies once,
// in order. The API invokes the first member with the rest of the round in
// `then`; after replying (or skipping, or failing) this Lambda invokes itself
// for the next member. `then` only ever shrinks, so a round is at most
// `participants.length` replies and terminates by construction.

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import { type AgentMetaRow, agentPk } from "../shared/agent.js";
import { getItem } from "../shared/ddb.js";
import { complete } from "../shared/llm-anthropic.js";
import {
  MESSAGING_OPERATOR_ID,
  getThreadDetail,
  sendMessage,
  type ThreadDetailView,
} from "../shared/messaging.js";
import { buildRecallBlock } from "../shared/recall-prompt.js";
import { readIndex, readChunk } from "../shared/memory.js";
import type { ProjectId } from "../shared/project.js";

const STAGE = process.env.STAGE ?? "dev";

/** Bumped when the reply prompt/guard contract changes (lands on MSG rows
 *  as `skill_version`, mirroring the cadence skills' versioning).
 *  0.2.0: recall packet (EXEC recall + latest memory summary) grounding.
 *  0.3.0: persona read from the AGENT# META row (ADR-0007 step 2).
 *  0.3.1: bundled-file persona fallback removed (ADR-0007 step 6b) —
 *         a missing row/prompt now throws instead of degrading.
 *  0.4.0: longer, deeper replies — the channel contract moved from "1–4
 *         sentences" to two-to-three short paragraphs (~2–3× the volume),
 *         asking the agent to surface the iceberg under the surface
 *         activity (current standing, thoughts/worries, proposals). Visible
 *         cap raised 400 → 1100 accordingly.
 *  0.5.0: group rounds (adr-0047) — every member speaks once per operator
 *         message; the prompt names the members and no longer lets a member
 *         pass because the message was "addressed to someone else". */
const SKILL_VERSION = "0.5.0";

/** Cap on the memory-summary excerpt folded into the system prompt. The
 *  rolling summary can grow; a reply needs the gist, not the archive. */
const MEMORY_EXCERPT_CHARS = 1200;

const NO_REPLY_TOKEN = "__NO_REPLY_NEEDED__";

// A work-register reply is now two-to-three short paragraphs (skill 0.4.0:
// the operator asked for ~2–3× the depth — the iceberg under the surface
// activity, not a bare status line). 1100 visible tokens covers that with
// headroom before the truncation throw.
// reasoningBudgetTokens is the thinking on-switch + max_tokens headroom
// (complete() sends ADAPTIVE thinking on supported models, omits it on
// Haiku) — keep it ≥ the visible cap so reasoning cannot starve the prose
// budget (same class of bug as the L2 truncation; see llm-anthropic.ts).
// History: 1000 (< the legacy 1024 budget floor) 400'd every call, and the
// legacy enabled+budget_tokens shape itself 400'd on opus-4-7 (Maya) —
// both now guarded/handled in complete().
const REPLY_MAX_TOKENS = 1100;
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
  "Write ONE reply, in your own voice (first-person, work-register). Aim for two",
  "or three short paragraphs — roughly two to three times the length of a bare",
  "status line. It is still a message, not a document: flowing prose, no headers,",
  "no bullet lists, no greeting boilerplate.",
  "",
  "Don't just report the surface activity. Surface the iceberg underneath it:",
  "where things actually stand right now, what you are turning over in your head,",
  "what is nagging or worrying you, and any idea or proposal you would put",
  "forward. Let your own perspective and judgement show. Go deeper, but stay",
  "grounded in your actual work and the notes below — never invent facts to fill",
  "the space.",
  "When a 'Relevant past work' or 'Your memory' section is present below, treat",
  "it as your own private notes: ground your answer in it, but never quote it",
  "verbatim or mention that you were given notes.",
  "",
  `If the last message genuinely needs no reply — a bare acknowledgement ("Nice.`,
  `Ship it.") or a closing — output the literal token ${NO_REPLY_TOKEN} and`,
  "nothing else.",
  "",
  "Never address yourself, never start an unrelated new topic, never reply to your own message.",
].join("\n");

// Group-thread contract (adr-0047), appended only when the thread is a group.
// The operator expects every member to speak; the risk to steer away from is
// N members restating the same status in turn.
function groupInstructions(selfSlug: string, participants: readonly string[]): string {
  const others = participants.filter((p) => p !== selfSlug);
  return [
    "This is a GROUP thread. Members: the Operator, you, and " +
      `${others.map((p) => `\`${p}\``).join(", ")}. Colleagues' messages are labelled`,
    "with their slug. The operator expects every member to speak in turn, so do",
    "reply even when the operator's message was addressed to the whole group or",
    "another member has already answered. Read what colleagues have said in this",
    "round and build on it: answer any question put to you by name, agree or push",
    "back from your own role, and add what only you know. Do not restate what a",
    "colleague already said, and do not speak for another member.",
  ].join("\n");
}

const cw = new CloudWatchClient({});
const lambda = new LambdaClient({});

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
  /** Members still to speak in this round, in order (adr-0047). */
  then?: string[];
  /** The operator message this round answers. Absent on a pre-0.5.0 event. */
  trigger_message_id?: string;
}

interface AgentCard {
  model: string;
  systemMd: string;
}

// ADR-0007: the AGENT#{slug}/META row is the single persona source —
// `model` + inline `system_prompt`. A missing row or empty prompt throws
// (W-4): with the git tree retired there is nothing to degrade to, and a
// persona-less reply published under a byline would be a W-1 violation.
async function loadAgent(slug: string): Promise<AgentCard> {
  const row = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!row) {
    throw new Error(`messaging-reply: AGENT#${slug}/META row not found`);
  }
  if (!row.model || typeof row.system_prompt !== "string" || row.system_prompt.length === 0) {
    emitMetric("WfMsgPersonaMissing", { Slug: slug });
    throw new Error(
      `messaging-reply: AGENT#${slug}/META lacks model/system_prompt — PATCH the row via agents-api (ADR-0007)`,
    );
  }
  return { model: row.model, systemMd: row.system_prompt };
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

/** Message ids are ULIDs, so string order is time order. */
function isAfter(messageId: string, triggerId: string): boolean {
  return messageId > triggerId;
}

/** Hand the round to the next member. Throws on failure (W-4): the Lambda
 *  then errors, its async retry finds this member already answered (the
 *  `already_replied` skip) and tries the hand-off again. */
async function passRound(event: MessagingReplyEvent): Promise<void> {
  const [next, ...rest] = event.then ?? [];
  if (!next || !event.thread_id) return;
  const self = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!self) throw new Error("messaging-reply: AWS_LAMBDA_FUNCTION_NAME unset — cannot continue the round");
  const payload: MessagingReplyEvent = {
    thread_id: event.thread_id,
    addressed_slug: next,
    then: rest,
    ...(event.trigger_message_id ? { trigger_message_id: event.trigger_message_id } : {}),
  };
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: self,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (err) {
    emitMetric("WfMsgRoundHandoffFailed");
    throw err;
  }
}

export async function handler(event: MessagingReplyEvent): Promise<MessagingReplyResult> {
  let result: MessagingReplyResult | undefined;
  try {
    result = await replyOnce(event);
    return result;
  } finally {
    // Also on a throw: one member's failed reply must not silence the rest of
    // the round. A superseded round stops — the newer round covers everyone.
    if (result?.reason !== "superseded") await passRound(event);
  }
}

async function replyOnce(event: MessagingReplyEvent): Promise<MessagingReplyResult> {
  const { thread_id, addressed_slug, trigger_message_id } = event ?? {};
  // Structured entry log: with async fire-and-forget dispatch, "was the
  // Lambda even invoked?" is the first triage question — answer it in one
  // log line rather than by inference.
  console.log(
    JSON.stringify({
      event: "messaging_reply_invoked",
      thread_id,
      addressed_slug,
      then: event?.then,
      trigger_message_id,
    }),
  );
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

  if (trigger_message_id) {
    const roundSkip = checkRound(detail, addressed_slug, trigger_message_id);
    if (roundSkip) {
      emitMetric("WfMsgReplySkipped", { Reason: roundSkip });
      return { status: "skipped", reason: roundSkip };
    }
  }

  // Loop safety: reply only to an inbound message. If the last message is
  // already ours, there is nothing to answer — a stale/duplicate invoke.
  const last = detail.messages[detail.messages.length - 1];
  if (!last || last.from === addressed_slug) {
    emitMetric("WfMsgReplySkipped", { Reason: "no_inbound" });
    return { status: "skipped", reason: "no_inbound" };
  }
  // Recall keys on what the operator asked, not on the previous member's reply.
  const trigger = detail.messages.find((m) => m.message_id === trigger_message_id) ?? last;

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
  const workContext = await assembleWorkContext(addressed_slug, trigger.body);
  const groupContext = detail.group ? groupInstructions(addressed_slug, detail.participants) : "";

  // complete() throws on stop_reason==='max_tokens' — that IS the W-1
  // finish_reason==='length' guard (a 1–4 sentence reply that truncates is a
  // real signal, not an expected case). We let it propagate.
  const out = await complete({
    model: agent.model,
    system: [agent.systemMd, REPLY_INSTRUCTIONS, groupContext, workContext]
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

/** Round guards (adr-0047). `superseded`: the operator has written again, so
 *  a newer round is already under way and this one stops. `already_replied`:
 *  this member has answered this round — a duplicate or retried invoke. */
function checkRound(
  detail: ThreadDetailView,
  slug: string,
  triggerId: string,
): "superseded" | "already_replied" | undefined {
  const sinceTrigger = detail.messages.filter((m) => isAfter(m.message_id, triggerId));
  if (sinceTrigger.some((m) => m.from === MESSAGING_OPERATOR_ID)) return "superseded";
  if (sinceTrigger.some((m) => m.from === slug)) return "already_replied";
  return undefined;
}
