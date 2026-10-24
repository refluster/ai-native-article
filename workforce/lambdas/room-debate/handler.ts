// wf-room-debate — one speaker's turn in a Room (Rooms v1, workforce/adr-0048
// proposed).
//
// Architecture: the Room twin of wf-messaging-reply (ADR-0006) — the same
// narrow real-time execution surface, not a new one. The wf-rooms-api room
// writes (`POST /rooms`, a reopening steer, `POST /rooms/{id}/conclude`)
// async-invoke this Lambda with the run's head turn and the rest of the
// schedule in `then`. One invocation:
//
//   1. loads the room META + every turn (shared/room.ts, direct DDB/S3),
//   2. applies the run guards (archived / superseded / already spoke /
//      participant / per-room daily budget / chair-only conclusion), then
//      claims the turn's slot (a conditional put, below),
//   3. composes the speaker's persona from the AGENT#{slug}/META row
//      (`model` + inline `system_prompt`, ADR-0007) + the debate or
//      conclusion contract + the room roster + a memory excerpt,
//   4. calls Claude once (shared/llm-anthropic.ts),
//   5. enforces the W-1 guards (max_tokens throw via `complete()`, the
//      LLM-artefact head regex, empty-body throw),
//   6. writes the TURN row via shared appendTurn() (a conclusion also flips
//      META to `concluded`),
//   7. invokes ITSELF for the next element of `then`.
//
// Loop safety (the property that bounds cost): the schedule is fixed when the
// run starts and `then` only ever shrinks, so a run is at most
// `participants × rounds + 1` Claude calls and terminates by construction —
// exactly the ADR-0047 group-round hand-off (`MessagingReplyRoundHandoff`),
// applied to a Room. A turn is written via the shared module, never the HTTP
// route, so no turn can start a new run; only an operator action can. A
// reopen or re-conclude mints a new `run_id`, and every older event drops out
// at the `superseded` guard (and stops passing its baton). A per-room daily
// turn budget is the backstop.
//
// Duplicate delivery. Async Lambda delivery is at-least-once, so one event
// can arrive twice and both copies can run at once. Before the Claude call
// the turn claims its slot with a conditional put — a third row kind in the
// room partition, `ROOM#{room_id}` / `CLAIM#{run_id}#{round}#{kind}#{speaker}`
// (shared/room.ts claimTurnSlot; the copy that loses skips as
// `already_spoke` and stops). The transcript check before it stays as a
// second line of defence. CLAIM rows sort before `TURN#`, so no turn read
// or the daily-budget count ever sees them.
//
// No async retries (`MaximumRetryAttempts: 0` on WfRoomDebateFunction). The
// baton is passed in a `finally`, so a retried invocation would hand the run
// on again and fork the chain. A failed turn throws once (alarm + META
// `last_error`) while the run continues; a failed hand-off is a stalled room
// the operator recovers with "Conclude now" — never a retry.

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import { type AgentMetaRow, agentPk } from "../shared/agent.js";
import { getItem } from "../shared/ddb.js";
import { complete } from "../shared/llm-anthropic.js";
import { readChunk, readIndex } from "../shared/memory.js";
import {
  ROOM_OPERATOR_ID,
  appendTurn,
  claimTurnSlot,
  countAgentTurnsSince,
  debateRoundOrdinals,
  getRoomMeta,
  listRoomTurnRows,
  listRoomTurns,
  ordinalOfRound,
  parsePosition,
  questionLanguage,
  updateRoomMeta,
  type RoomMetaRow,
  type RoomTurnDispatch,
  type TurnView,
} from "../shared/room.js";

const STAGE = process.env.STAGE ?? "dev";

/** Bumped when the debate prompt / guard contract changes (lands on TURN
 *  rows as `skill_version`, mirroring messaging-reply's versioning).
 *  0.1.0: Rooms v1 — POSITION line, round-aware debate contract, the
 *         five-section chair conclusion. */
const SKILL_VERSION = "0.1.0";

/** Cap on the memory-summary excerpt folded into the system prompt. A turn
 *  needs the gist of the agent's record, not the archive. */
const MEMORY_EXCERPT_CHARS = 1200;

/** Each prior turn is clipped to this in the transcript. */
const TRANSCRIPT_TURN_CHARS = 1500;

/** The transcript keeps the opening, the latest conclusion and the last
 *  this-many turns; earlier turns are elided with a count. A run is at most
 *  19 turns, but every reopen adds one, so without a window the prompt (and
 *  the cost of each call) would grow with the room's whole history. With
 *  it, a prompt is bounded by (30 + 2) × 1500 chars of transcript. */
const TRANSCRIPT_MAX_TURNS = 30;

/** Cap on META `last_error` (it renders as a banner on the room). */
const LAST_ERROR_MAX_CHARS = 300;

const NO_REPLY_TOKEN = "__NO_REPLY_NEEDED__";

// A statement is POSITION + two–four short paragraphs; a conclusion is five
// sections of up to ~900 words (~1,500 Japanese characters — Japanese runs
// ~1–1.5 chars/token, so 3200 leaves it the same headroom English has).
// reasoningBudgetTokens is the adaptive-
// thinking on-switch + max_tokens headroom (≥ the 1024 floor complete()
// enforces), kept ≥ the statement cap so reasoning cannot starve the prose
// (the L2 truncation bug class; see llm-anthropic.ts).
const STATEMENT_MAX_TOKENS = 1600;
const CONCLUSION_MAX_TOKENS = 3200;
const REASONING_TOKENS = 2048;

/** Per-room agent turns per UTC day. A 6 × 3 room is 19 turns a run, so 60
 *  allows a start plus two reopens in a day; it is the seatbelt against a
 *  bug that re-fires, not a product limit. */
const TURNS_PER_ROOM_PER_DAY = Number(process.env.WF_ROOM_TURN_BUDGET ?? "60");

// Mirrors messaging-reply / shared/post.ts LLM_ARTEFACT_PATTERNS by design:
// each W-1 enforcer self-contains its guard rather than trusting an upstream
// caller. Checked over the first 50 chars of the position and of the body.
const LLM_ARTEFACT_PATTERNS: readonly RegExp[] = [
  /^as an ai/i,
  /^here is the/i,
  /^here's the/i,
  /^i apologi[sz]e/i,
  /^certainly[!,]/i,
  /^sure[!,]/i,
  /^of course[!,]/i,
];

// The voice is the persona's system prompt; these set the room contract
// (spec §5). The room is the purpose — every member speaks to the question.
const STATEMENT_CONTRACT = [
  "You are a member of a ROOM: a deliberation convened for one question. The",
  "question is the purpose of the room; everything you write serves answering it.",
  "The transcript below is the room so far, oldest first. The human operator who",
  "convened the room is labelled `Operator`; your own past turns are labelled `You`;",
  "colleagues are labelled with their slug.",
  "",
  "Write your turn for this round:",
  "- The FIRST line must be exactly `POSITION: <one sentence>` — your stance on the",
  "  question right now, at most 140 characters. Keep the label `POSITION:` in",
  "  English whatever language you write in.",
  "- Then two to four short paragraphs of flowing prose (about 300 words, or 800",
  "  Japanese characters, at most). No headers, no bullet lists, no greeting, no",
  "  sign-off.",
  "- Take a clear position from your own role and your own record. Ground it in",
  "  what you actually know; never invent facts to fill the space.",
  "- Engage the colleagues who have spoken BY NAME (their name from the member",
  "  list, not their slug): agree or disagree with specifics, answer any question",
  "  put to you.",
  "- In the opening round, state your opening position. In later rounds, respond:",
  "  refine, concede a point that was well made, or hold your ground and say why.",
  "- Never restate what a colleague already said, and never speak for another member.",
  "- Write in the language of the question, as stated below.",
  "- A steer from the Operator is a direction to follow from that point on.",
  "",
  `Every summoned member speaks in a room: never output ${NO_REPLY_TOKEN}.`,
].join("\n");

const CONCLUSION_CONTRACT = [
  "You are the CHAIR of a ROOM: a deliberation convened for one question. The",
  "debate is in the transcript below, oldest first (`Operator` is the human who",
  "convened it; `You` are your own past turns; colleagues are labelled by slug).",
  "",
  "Write the room's conclusion — neutral and specific, faithful to what was",
  "actually argued, in the language of the question. Use exactly these five",
  "Markdown sections, in this order — the Japanese set when the question is",
  "Japanese, the English set otherwise, never both:",
  "",
  "  ## 結論            / ## Conclusion",
  "  ## 合意点          / ## Where we agree",
  "  ## 対立点          / ## Where we differ   (name who holds which view)",
  "  ## 推奨アクション  / ## Recommended action   (who should do what next)",
  "  ## 未解決の論点    / ## Open questions",
  "",
  "Start with the first heading. Bullets are allowed inside the sections. Do not",
  "write a `POSITION:` line, a preamble or a sign-off. At most ~900 words (in",
  "Japanese, 約1,500字).",
  "Where the room genuinely did not agree, say so — do not manufacture consensus.",
].join("\n");

const cw = new CloudWatchClient({});
const lambda = new LambdaClient({});

/** Fire-and-forget metric. Never awaited, never throws — a metric failure
 *  must not mask the turn outcome (same discipline as messaging-reply). */
function emitMetric(name: string, dims: Record<string, string> = {}): void {
  cw.send(
    new PutMetricDataCommand({
      Namespace: "Workforce/Rooms",
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
    console.warn(JSON.stringify({ event: "room_debate_metric_emit_failed", name, error: String(err) }));
  });
}

export type RoomDebateEvent = RoomTurnDispatch;

export interface RoomDebateResult {
  status: "ok" | "skipped";
  reason?: string;
  turn_id?: string;
}

interface AgentCard {
  model: string;
  systemMd: string;
}

interface RosterEntry {
  slug: string;
  name: string;
  role: string;
}

// ADR-0007: the AGENT#{slug}/META row is the single persona source. A missing
// row or empty prompt throws (W-4) — a persona-less turn published under a
// byline would be a W-1 violation.
async function loadAgent(slug: string): Promise<{ card: AgentCard; row: AgentMetaRow }> {
  const row = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!row) {
    emitMetric("WfRoomPersonaMissing", { Slug: slug });
    throw new Error(`room-debate: AGENT#${slug}/META row not found`);
  }
  if (!row.model || typeof row.system_prompt !== "string" || row.system_prompt.length === 0) {
    emitMetric("WfRoomPersonaMissing", { Slug: slug });
    throw new Error(
      `room-debate: AGENT#${slug}/META lacks model/system_prompt — PATCH the row via agents-api (ADR-0007)`,
    );
  }
  return { card: { model: row.model, systemMd: row.system_prompt }, row };
}

function rosterEntry(slug: string, row: AgentMetaRow | undefined): RosterEntry {
  const name = row ? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() : "";
  return { slug, name: name || slug, role: row?.role ?? "" };
}

/** Names + roles of the other members. Fail-soft per colleague: a missing
 *  row only costs the prompt a display name, never the speaker's turn. */
async function loadRoster(meta: RoomMetaRow, self: RosterEntry): Promise<RosterEntry[]> {
  return Promise.all(
    meta.participants.map(async (slug) => {
      if (slug === self.slug) return self;
      try {
        return rosterEntry(slug, await getItem<AgentMetaRow>(agentPk(slug), "META"));
      } catch {
        return rosterEntry(slug, undefined);
      }
    }),
  );
}

/** Tail of the latest rolling memory summary. Fail-soft: no index, no
 *  summary or a broken read yields no section, never a failed turn. */
async function memoryExcerpt(slug: string): Promise<string> {
  try {
    const idx = await readIndex(slug);
    const key = idx?.latest_summary_key ?? idx?.latest_chunk_key ?? undefined;
    if (!key) return "";
    const chunk = await readChunk(key);
    const excerpt =
      chunk.length > MEMORY_EXCERPT_CHARS ? `${chunk.slice(0, MEMORY_EXCERPT_CHARS)}\n…(older memory omitted)` : chunk;
    return `## Your memory (latest summary)\n\nTreat this as your own private notes: ground your view in it, but never quote it or mention it.\n\n${excerpt.trim()}`;
  } catch (err) {
    console.warn(JSON.stringify({ event: "room_debate_memory_skipped", slug, error: String(err) }));
    return "";
  }
}

/** The last debate round of the current run (absolute numbering). */
function lastDebateRound(meta: RoomMetaRow): number {
  const start = meta.run_start_round ?? 1;
  const rounds = meta.run_rounds ?? meta.rounds;
  return start + rounds - 1;
}

function roleBlock(
  event: RoomDebateEvent,
  meta: RoomMetaRow,
  roster: readonly RosterEntry[],
  turns: readonly TurnView[],
): string {
  const self = roster.find((r) => r.slug === event.speaker);
  const members = roster
    .map((r) => {
      const who = r.slug === event.speaker ? " ← you" : "";
      const chair = r.slug === meta.chair ? " (chair)" : "";
      return `- \`${r.slug}\` — ${r.name}${r.role ? `, ${r.role}` : ""}${chair}${who}`;
    })
    .join("\n");
  const lines = [
    `You are \`${event.speaker}\`${self?.name ? ` (${self.name}${self.role ? `, ${self.role}` : ""})` : ""}.`,
    "",
    "Members of this room:",
    members,
    "",
  ];
  const ja = questionLanguage(meta.question) === "ja";
  if (event.kind === "conclusion") {
    lines.push("The debate rounds are over. You are writing the conclusion as the chair.");
    lines.push(
      ja
        ? "The question is in Japanese: write the conclusion in Japanese, under the Japanese headings (## 結論 … ## 未解決の論点)."
        : "The question is in English: write the conclusion in English, under the English headings (## Conclusion … ## Open questions).",
    );
  } else {
    const last = lastDebateRound(meta);
    // Labels count debate rounds only (a conclusion takes a stored round
    // number of its own): a reopened 3 × 2 room speaks at stored round 4,
    // which is "round 3 of 3".
    const ordinal = ordinalOfRound(turns, event.round);
    lines.push(`This is round ${ordinal} of ${ordinal + (last - event.round)}.`);
    if (event.round === 1) lines.push("This is the opening round: state your opening position.");
    else if ((meta.run_start_round ?? 1) > 1 && event.round === meta.run_start_round) {
      lines.push("The operator reopened the room with a follow-up: answer it, and say whether it changes your position.");
    } else lines.push("Respond to the round before: refine, concede or hold.");
    if (event.round === last) {
      lines.push("This is the last round before the chair concludes: say plainly what you would accept as the room's answer.");
    }
    lines.push(
      ja
        ? "The question is in Japanese: write this turn in Japanese (keep the `POSITION:` label as is)."
        : "The question is in English: write this turn in English.",
    );
  }
  return lines.join("\n");
}

function roomHeader(meta: RoomMetaRow): string {
  return [
    `# Room: ${meta.title}`,
    "",
    `## The question`,
    meta.question,
    ...(meta.context ? ["", "## Background", meta.context] : []),
    "",
    "## Transcript",
    "",
  ].join("\n");
}

function clip(text: string): string {
  return text.length > TRANSCRIPT_TURN_CHARS ? `${text.slice(0, TRANSCRIPT_TURN_CHARS)} …(clipped)` : text;
}

/**
 * The turns the prompt carries: the opening (it holds the question), the
 * latest conclusion (the room's standing answer), and the last
 * TRANSCRIPT_MAX_TURNS turns — chronological, with an elision marker
 * (the number of turns left out) wherever a gap falls.
 */
export function transcriptWindow(
  turns: readonly TurnView[],
  max: number = TRANSCRIPT_MAX_TURNS,
): Array<TurnView | { omitted: number }> {
  const opening = turns.findIndex((t) => t.kind === "opening");
  let conclusion = -1;
  turns.forEach((t, i) => {
    if (t.kind === "conclusion") conclusion = i;
  });
  const out: Array<TurnView | { omitted: number }> = [];
  let gap = 0;
  turns.forEach((t, i) => {
    if (i === opening || i === conclusion || i >= turns.length - max) {
      if (gap > 0) out.push({ omitted: gap });
      gap = 0;
      out.push(t);
    } else gap += 1;
  });
  return out;
}

function buildTranscript(turns: readonly TurnView[], selfSlug: string): string {
  const ordinals = debateRoundOrdinals(turns);
  return transcriptWindow(turns)
    .map((t) => {
      if ("omitted" in t) return `…(${t.omitted} earlier turn${t.omitted === 1 ? "" : "s"} omitted)`;
      if (t.from === ROOM_OPERATOR_ID) {
        const label = t.kind === "opening" ? "Operator (opening the room with the question)" : "Operator (steer)";
        return `${label}: ${clip(t.body)}`;
      }
      const who = t.from === selfSlug ? "You" : t.from;
      const tag = t.kind === "conclusion" ? "[Conclusion]" : `[Round ${ordinals.get(t.round) ?? t.round}]`;
      const stance = t.position ? `POSITION: ${t.position}\n` : "";
      return `${tag} ${who}: ${stance}${clip(t.body)}`;
    })
    .join("\n\n");
}

/** Hand the run to the next scheduled speaker. Throws on failure (W-4): the
 *  Lambda errors (alarm + META `last_error`) and the run stalls there — async
 *  retries are off, so the operator recovers it with "Conclude now". */
async function passTurn(event: RoomDebateEvent): Promise<void> {
  const [next, ...rest] = event.then ?? [];
  if (!next || !event.room_id || !event.run_id) return;
  const self = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!self) throw new Error("room-debate: AWS_LAMBDA_FUNCTION_NAME unset — cannot continue the run");
  const payload: RoomTurnDispatch = {
    room_id: event.room_id,
    run_id: event.run_id,
    speaker: next.speaker,
    round: next.round,
    kind: next.kind,
    then: rest,
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
    emitMetric("WfRoomHandoffFailed");
    throw err;
  }
}

/** Best-effort: put the failure on the room so the console can show it
 *  (W-4 visible). Guarded on the run — a stale run never overwrites the
 *  state of the run that superseded it — and never masks the original throw. */
async function recordError(event: RoomDebateEvent, err: unknown): Promise<void> {
  if (!event?.room_id || !event.run_id) return;
  const message = err instanceof Error ? err.message : String(err);
  try {
    await updateRoomMeta(
      event.room_id,
      { last_error: `${event.speaker} · ${event.kind} · round ${event.round}: ${message}`.slice(0, LAST_ERROR_MAX_CHARS) },
      { ifRunId: event.run_id },
    );
  } catch (patchErr) {
    console.warn(
      JSON.stringify({ event: "room_debate_last_error_write_failed", room_id: event.room_id, error: String(patchErr) }),
    );
  }
}

export async function handler(event: RoomDebateEvent): Promise<RoomDebateResult> {
  let result: RoomDebateResult | undefined;
  try {
    result = await speakOnce(event);
    return result;
  } catch (err) {
    await recordError(event, err);
    throw err;
  } finally {
    // Also on a throw: one member's failed turn must not silence the rest of
    // the run. A superseded run stops — the newer run covers everyone — and
    // so does an archived room: walking the rest of the schedule as no-ops
    // would only spend invocations. `already_spoke` stops too: the copy that
    // wrote the turn already passed the baton, so passing it again (retries
    // are off — this is a duplicate delivery) would invoke the next speaker
    // twice and fork the run past participants × rounds + 1.
    if (!result?.reason || !CHAIN_STOPS.has(result.reason)) {
      try {
        await passTurn(event);
      } catch (err) {
        // With retries off, a lost hand-off stalls the room: put it on META
        // so the console shows it and offers "Conclude now".
        await recordError(event, new Error(`hand-off failed: ${err instanceof Error ? err.message : String(err)}`));
        throw err;
      }
    }
  }
}

/** Skip reasons that end the chain instead of passing the baton. */
const CHAIN_STOPS: ReadonlySet<string> = new Set(["superseded", "archived", "already_spoke"]);

function skip(reason: string): RoomDebateResult {
  emitMetric("WfRoomTurnSkipped", { Reason: reason });
  return { status: "skipped", reason };
}

function guardThrow(reason: string, message: string): never {
  emitMetric("WfRoomTurnThrow", { Reason: reason });
  throw new Error(`room-debate: ${message}`);
}

async function speakOnce(event: RoomDebateEvent): Promise<RoomDebateResult> {
  const { room_id, run_id, speaker, round, kind } = event ?? ({} as RoomDebateEvent);
  // Structured entry log: with async fire-and-forget dispatch, "was the
  // Lambda even invoked?" is the first triage question.
  console.log(
    JSON.stringify({
      event: "room_debate_invoked",
      room_id,
      run_id,
      speaker,
      round,
      kind,
      then: event?.then?.map((s) => `${s.speaker}:${s.kind}:${s.round}`),
    }),
  );
  if (!room_id || !run_id || !speaker || typeof round !== "number") {
    throw new Error("room-debate: missing room_id, run_id, speaker or round");
  }
  if (kind !== "statement" && kind !== "conclusion") throw new Error(`room-debate: invalid kind ${String(kind)}`);
  if (speaker === ROOM_OPERATOR_ID) throw new Error("room-debate: speaker must be an agent, not the operator");

  // 1. The room exists (throw — a dispatch to nowhere is a bug) and is live.
  const meta = await getRoomMeta(room_id);
  if (!meta) throw new Error(`room-debate: room ${room_id} not found`);
  if (meta.archived) {
    // The chain stops here, so a still-debating room would read
    // "Deliberating" forever once unarchived: say why on META (W-4).
    if (meta.status === "debating" && meta.run_id === run_id) {
      await recordError(event, new Error("run stopped: the room was archived mid-run — unarchive, then Conclude now"));
    }
    return skip("archived");
  }

  // 2. A reopen / re-conclude minted a newer run: this one stops here.
  if (meta.run_id !== run_id) return skip("superseded");

  // 3. Duplicate invoke: this speaker already took this turn.
  const turns = await listRoomTurns(room_id);
  const spoke = turns.some(
    (t) => t.run_id === run_id && t.round === round && t.kind === kind && t.from === speaker,
  );
  if (spoke) return skip("already_spoke");

  // 4. Only summoned members speak.
  if (!meta.participants.includes(speaker)) guardThrow("not_participant", `${speaker} is not a participant of ${room_id}`);

  // 5. Cost backstop: cap agent turns per room per UTC day.
  const today = new Date();
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const turnsToday = await countAgentTurnsSince(room_id, dayStart);
  if (turnsToday >= TURNS_PER_ROOM_PER_DAY) {
    emitMetric("WfRoomBudgetExceeded", { Slug: speaker });
    throw new Error(
      `room-debate: per-room daily turn budget exhausted (${turnsToday}/${TURNS_PER_ROOM_PER_DAY}) for ${room_id}`,
    );
  }

  // 6. Only the chair writes the conclusion.
  if (kind === "conclusion" && speaker !== meta.chair) {
    guardThrow("not_chair", `${speaker} is not the chair of ${room_id} (chair: ${meta.chair})`);
  }

  // 7. Claim the slot before the Claude call (atomic — see the header): an
  //    overlapping duplicate of this event loses here and stops the chain.
  if (!(await claimTurnSlot({ room_id, run_id, round, kind, speaker }))) return skip("already_spoke");

  const { card, row } = await loadAgent(speaker);
  const self = rosterEntry(speaker, row);
  const [roster, memory] = await Promise.all([loadRoster(meta, self), memoryExcerpt(speaker)]);
  const contract = kind === "conclusion" ? CONCLUSION_CONTRACT : STATEMENT_CONTRACT;

  // complete() throws on stop_reason==='max_tokens' — that IS the W-1
  // finish_reason==='length' guard. We count it and let it propagate.
  let out;
  try {
    out = await complete({
      model: card.model,
      system: [card.systemMd, contract, roleBlock(event, meta, roster, turns), memory]
        .filter((s) => s.length > 0)
        .join("\n\n---\n\n"),
      user: roomHeader(meta) + buildTranscript(turns, speaker),
      maxTokens: kind === "conclusion" ? CONCLUSION_MAX_TOKENS : STATEMENT_MAX_TOKENS,
      reasoningBudgetTokens: REASONING_TOKENS,
    });
  } catch (err) {
    emitMetric("WfRoomTurnThrow", { Reason: /max_tokens/.test(String(err)) ? "max_tokens" : "llm_error" });
    throw err;
  }

  const raw = out.text.trim();
  if (raw.startsWith(NO_REPLY_TOKEN)) guardThrow("no_reply_token", "model declined to speak (no-reply token)");
  const parsed = parsePosition(raw);
  // A conclusion carries no stance line; drop one the model wrote anyway.
  const position = kind === "statement" ? parsed.position : undefined;
  const body = parsed.body;
  if (body.length === 0) guardThrow("empty_body", "empty turn body after trim");
  for (const head of [position ?? "", body].map((s) => s.slice(0, 50))) {
    for (const re of LLM_ARTEFACT_PATTERNS) {
      if (re.test(head)) guardThrow("llm_artefact", `llm_artefact_in_head: ${re.source}`);
    }
  }

  const written = await appendTurn({
    room_id,
    run_id,
    round,
    kind,
    from: speaker,
    body,
    ...(position !== undefined ? { position } : {}),
    finish_reason: out.stop_reason,
    tokens_in: out.tokens_in,
    tokens_out: out.tokens_out,
    skill_version: SKILL_VERSION,
  });

  emitMetric("WfRoomTurn", { Slug: speaker });
  if (kind === "conclusion") {
    if (written.superseded) {
      console.warn(JSON.stringify({ event: "room_conclusion_superseded", room_id, run_id, turn_id: written.view.turn_id }));
    } else {
      emitMetric("WfRoomConcluded");
      await flagSteerDuringConclusion(event, turns);
    }
  }
  return { status: "ok", turn_id: written.view.turn_id };
}

/**
 * A steer stored on this run after the chair read its transcript was never
 * read: the conclusion has landed without it. wf-rooms-api refuses a steer
 * once every statement of the run is in (`409 room_concluding`), but one
 * that raced the last statement can still slip in. Say so on META (W-4:
 * visible, never silent) so the operator reopens to address it. Best-effort
 * — the conclusion itself has landed.
 */
async function flagSteerDuringConclusion(event: RoomDebateEvent, snapshot: readonly TurnView[]): Promise<void> {
  try {
    const seen = new Set(snapshot.map((t) => t.turn_id));
    const missed = (await listRoomTurnRows(event.room_id)).filter(
      (t) => t.kind === "steer" && t.run_id === event.run_id && !seen.has(t.turn_id),
    );
    if (missed.length === 0) return;
    emitMetric("WfRoomSteerDuringConclusion");
    await updateRoomMeta(
      event.room_id,
      {
        last_error:
          "a steer arrived while the chair was writing the conclusion, so the conclusion does not address it — reopen with a follow-up to have the room answer it",
      },
      { ifRunId: event.run_id },
    );
  } catch (err) {
    console.warn(
      JSON.stringify({ event: "room_steer_during_conclusion_check_failed", room_id: event.room_id, error: String(err) }),
    );
  }
}
