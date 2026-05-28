// Handler for the feed-post skill — Epic-011 Story 1 (#128).
// See ./SKILL.md for the persona-facing prompt body and the post shape.
//
// Pipeline:
//   1. Resolve the recall packet (recent EXEC rows + 1–2 memory chunks +
//      ≤5 pending TASK rows) — assembled by the runner-side caller in
//      production. Reading happens via shared/project.ts (GSI1, agent-
//      scoped) + shared/memory.ts + a TASK scan filtered by agent_slug.
//      This handler receives the *composed* prompt (system + user), so
//      the recall is the caller's concern and the handler stays hermetic.
//   2. Compose the LLM prompt (persona system.md + this SKILL.md +
//      recall packet) — done by the runner-side caller.
//   3. Call the LLM. For Sonnet/Opus, set the reasoning budget SEPARATELY
//      from the visible-output cap (per Story #128 AC + the L2-truncation
//      class described in root CLAUDE.md). Haiku uses a single max-tokens.
//   4. STRICT-EQUALITY skip check: only `response.trim() ===
//      '__SKIP_NO_MATERIAL__'` skips. A response containing the sentinel
//      anywhere else throws — W-4 inversion guard per Dario A2.
//   5. `finish_reason==='length'` is thrown by `shared/llm-anthropic.ts`
//      (R-9). We don't re-check here; that throw propagates naturally.
//   6. LLM-artefact regex over the FIRST 50 CHARS of the body throws.
//      The regex set is defined inline below. (article-health's
//      truncation predicate is structural — heading-without-body — not
//      artefact-based; it does not expose a regex helper, so this list
//      lives here. Epic-011 §7 names the canonical set.)
//   7. Parse the structured tail (fenced JSON block at end) for `kind`
//      + `references[]`. Body is everything before that block.
//   8. Write the POST row (DDB) + the body (S3) under the conventions
//      added to data-model.md, then the RUN row.
//
// This file is NOT wired into the agent-runner's runLlmProse path yet.
// Story 3 (#130) adds the per-agent feed-post binding to agent.json,
// at which point the runner either delegates to this handler or this
// handler stays callable from a thin shim. The skip / throw / artefact
// shape is defined here regardless so the tests lock semantics now.
//
// SDK imports deliberately live in workforce/lambdas/shared/ (writeFeedPostBody
// in shared/deliverable.ts, putCountMetric in shared/cw-metric.ts) — the
// skill folder is not its own npm package and module resolution from
// workforce/skills/ does not reach workforce/lambdas/node_modules/.

import { putItem } from "../../lambdas/shared/ddb.js";
import { writeFeedPostBody } from "../../lambdas/shared/deliverable.js";
import { putCountMetric } from "../../lambdas/shared/cw-metric.js";
import {
  complete as defaultComplete,
  type CompletionResponse,
} from "../../lambdas/shared/llm-anthropic.js";
import { newUlid } from "../../lambdas/shared/task.js";

// --- Public types --------------------------------------------------------

export type PostKind = "reflection" | "friction" | "improvement" | "observation";

export interface FeedPostRow {
  pk: `AGENT#${string}`;
  sk: `POST#${string}`;
  agent_slug: string;
  posted_at: string;
  kind: PostKind;
  body_ref: string;
  /** First ≤320 chars of the body — cheap to read on the feed page
   *  without an S3 fetch. Distinct from `artifact_ref.summary` (Epic-010
   *  §8): different domains (post body vs. arbitrary artefact), different
   *  idiomatic names. See data-model.md row catalogue rationale. */
  body_preview: string;
  references: string[];
  finish_reason: string;
  tokens_in: number;
  tokens_out: number;
  skill_version: string;
  /** GSI3 global feed partition — see data-model.md GSI3 section. */
  gsi3pk: "FEED";
  /** GSI3 sort key — `posted_at` so reverse-chrono pagination is a
   *  partition range query with `ScanIndexForward=false`. */
  gsi3sk: string;
}

export interface RunResultRow {
  pk: `AGENT#${string}`;
  sk: `RUN#${string}`;
  skill_name: "feed-post";
  skill_version: string;
  status: "ok" | "skipped" | "throw";
  started_at: string;
  ended_at: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  skip_reason?: string;
  error_message?: string;
  post_id?: string;
}

export interface FeedPostInput {
  /** Persona slug — drives the AGENT# partition + S3 key. */
  agent_slug: string;
  /** Composed system prompt (persona system.md + SKILL.md). The runner
   *  composes these; the handler does not re-load them, so tests stay
   *  hermetic. */
  system_prompt: string;
  /** Composed user prompt (recall packet — recent EXECs + memory +
   *  pending TASKs, formatted by the runner-side caller). */
  user_prompt: string;
  /** Model id (e.g. `anthropic:claude-sonnet-4-6`, `claude-haiku-4-5`).
   *  Drives the per-model token-cap shape (Haiku=800 single cap,
   *  Sonnet/Opus=1200 visible + 1200 separate reasoning). */
  model: string;
  /** Skill version — written to the POST row + RUN row for audit. */
  skill_version: string;
}

/** Test-injectable dependencies. Production calls `runFeedPost(input)`
 *  with deps defaulted; tests pass mocks. The defaults pin to the live
 *  AWS SDK paths so production is one fewer wiring step. */
export interface FeedPostDeps {
  complete: typeof defaultComplete;
  putItem: typeof putItem;
  writeFeedPostBody: typeof writeFeedPostBody;
  putCountMetric: typeof putCountMetric;
  /** Injectable timestamp — tests pin it for deterministic `posted_at`. */
  now: () => Date;
  /** Injectable ULID — tests pin it. Default: `newUlid()`. */
  newUlid: () => string;
}

// --- Constants -----------------------------------------------------------

/** Per-model token budgets, per Story #128 AC. */
const TOKEN_BUDGETS = {
  /** Haiku: single shared cap, no extended-thinking. */
  haiku: { maxTokens: 800, reasoningBudgetTokens: 0 },
  /** Sonnet/Opus: visible cap + SEPARATE reasoning budget so a long
   *  hidden-reasoning trace cannot starve the 600-char visible post
   *  (the L2 truncation class described in root CLAUDE.md). */
  reasoning: { maxTokens: 1200, reasoningBudgetTokens: 1200 },
} as const;

/** The skip sentinel. Strict-equality match only — see Step 4 in header. */
const SKIP_SENTINEL = "__SKIP_NO_MATERIAL__";

/** LLM-failure artefact patterns. Checked over the FIRST 50 chars of the
 *  body (after trim). article-health's truncation predicate is structural
 *  rather than artefact-based, so this list is defined here. When
 *  extending: keep the patterns short and high-precision; a false-positive
 *  here loudly throws away an otherwise-fine post. */
const LLM_ARTEFACT_PATTERNS: readonly RegExp[] = [
  /^as an ai/i,
  /^here is the/i,
  /^here's the/i,
  /^i apologi[sz]e/i,
  /^certainly[!,]/i,
  /^sure[!,]/i,
  /^of course[!,]/i,
  /^i'?m sorry/i,
  /^i cannot/i,
  /^i can'?t/i,
];

/** Inline-preview cap (data-model.md §POST rows: ≤320 chars). */
const BODY_PREVIEW_MAX_CHARS = 320;
/** Hard cap on body length per Epic-011 §1. */
const BODY_HARD_MAX_CHARS = 2000;

const METRIC_NAMESPACE = "Workforce/Feed";

// --- Defaults ------------------------------------------------------------

function defaultDeps(): FeedPostDeps {
  return {
    complete: defaultComplete,
    putItem,
    writeFeedPostBody,
    putCountMetric,
    now: () => new Date(),
    newUlid,
  };
}

// --- Public entrypoint ---------------------------------------------------

export interface FeedPostResult {
  status: "ok" | "skipped" | "throw";
  run_id: string;
  post_id?: string;
  body_preview?: string;
  kind?: PostKind;
  references?: string[];
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  skip_reason?: string;
  error_message?: string;
}

export async function runFeedPost(
  input: FeedPostInput,
  depsOverride?: Partial<FeedPostDeps>,
): Promise<FeedPostResult> {
  const deps: FeedPostDeps = { ...defaultDeps(), ...depsOverride };
  const startedAt = deps.now().toISOString();
  const runId = deps.newUlid();
  const slug = input.agent_slug;

  let llm: CompletionResponse;
  try {
    // Step 3: LLM call. Per-model token shape per Story #128 AC.
    const budget = pickTokenBudget(input.model);
    llm = await deps.complete({
      model: input.model,
      system: input.system_prompt,
      user: input.user_prompt,
      maxTokens: budget.maxTokens,
      reasoningBudgetTokens: budget.reasoningBudgetTokens || undefined,
    });
  } catch (err) {
    // The `complete()` helper throws on `stop_reason==='length'` (R-9).
    // Any LLM error propagates here; we write a `status=throw` RUN row
    // and re-throw so the operator sees it (W-4).
    const msg = err instanceof Error ? err.message : String(err);
    await writeRunRow(deps, {
      pk: `AGENT#${slug}`,
      sk: `RUN#${runId}`,
      skill_name: "feed-post",
      skill_version: input.skill_version,
      status: "throw",
      started_at: startedAt,
      ended_at: deps.now().toISOString(),
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_message: msg.slice(0, 1024),
    });
    throw err;
  }

  const responseText = llm.text;
  const trimmed = responseText.trim();

  // Step 4: STRICT-EQUALITY skip check. A response that *contains* the
  // sentinel but is not exactly the sentinel throws — this is the W-4
  // inversion guard (Dario A2). The order matters: we check skip BEFORE
  // any other body validation so a legitimate skip doesn't accidentally
  // trip a downstream check.
  if (trimmed === SKIP_SENTINEL) {
    await writeRunRow(deps, {
      pk: `AGENT#${slug}`,
      sk: `RUN#${runId}`,
      skill_name: "feed-post",
      skill_version: input.skill_version,
      status: "skipped",
      started_at: startedAt,
      ended_at: deps.now().toISOString(),
      tokens_in: llm.tokens_in,
      tokens_out: llm.tokens_out,
      cost_usd: llm.cost_usd,
      skip_reason: "no_material",
    });
    await deps.putCountMetric(METRIC_NAMESPACE, "WfFeedPostSkip", 1, [
      { Name: "Agent", Value: slug },
    ]);
    return {
      status: "skipped",
      run_id: runId,
      tokens_in: llm.tokens_in,
      tokens_out: llm.tokens_out,
      cost_usd: llm.cost_usd,
      skip_reason: "no_material",
    };
  }
  if (trimmed.includes(SKIP_SENTINEL)) {
    // Inversion guard: the model emitted the sentinel inside a larger
    // body. Throw with the discriminating error_message the Story's
    // strict-equality test asserts on.
    return await throwAndRecord(deps, slug, runId, startedAt, input, llm, "sentinel_in_body");
  }

  // Step 7: parse the structured tail BEFORE the artefact check so the
  // regex sees only the prose body, not a tail-block prefix.
  let body: string;
  let kind: PostKind;
  let references: string[];
  try {
    const parsed = parseBodyAndTail(responseText);
    body = parsed.body;
    kind = parsed.kind;
    references = parsed.references;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "tail_parse_failed";
    return await throwAndRecord(deps, slug, runId, startedAt, input, llm, reason);
  }

  // Step 6: LLM-artefact regex on the FIRST 50 CHARS of the body.
  const head = body.trim().slice(0, 50);
  for (const re of LLM_ARTEFACT_PATTERNS) {
    if (re.test(head)) {
      return await throwAndRecord(
        deps,
        slug,
        runId,
        startedAt,
        input,
        llm,
        `llm_artefact_in_head: ${re.source}`,
      );
    }
  }

  // Empty body after parsing is also a W-4 throw (Epic-011 §7).
  if (body.trim().length === 0) {
    return await throwAndRecord(deps, slug, runId, startedAt, input, llm, "empty_body");
  }
  if (body.length > BODY_HARD_MAX_CHARS) {
    return await throwAndRecord(
      deps,
      slug,
      runId,
      startedAt,
      input,
      llm,
      `body_over_hard_cap: ${body.length} > ${BODY_HARD_MAX_CHARS}`,
    );
  }

  // Step 8: write the body to S3 → POST row → RUN row. The S3 write goes
  // first so a DDB failure doesn't leave a dangling row pointing at no
  // body. The reverse order would risk a row whose body_ref returns 404.
  const postId = deps.newUlid();
  const postedAt = deps.now().toISOString();
  const bodyRef = await deps.writeFeedPostBody(slug, postedAt, postId, body);

  const postRow: FeedPostRow = {
    pk: `AGENT#${slug}`,
    sk: `POST#${postId}`,
    agent_slug: slug,
    posted_at: postedAt,
    kind,
    body_ref: bodyRef,
    body_preview: body.slice(0, BODY_PREVIEW_MAX_CHARS),
    references,
    finish_reason: llm.stop_reason,
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    skill_version: input.skill_version,
    gsi3pk: "FEED",
    gsi3sk: postedAt,
  };
  await deps.putItem(postRow);

  await writeRunRow(deps, {
    pk: `AGENT#${slug}`,
    sk: `RUN#${runId}`,
    skill_name: "feed-post",
    skill_version: input.skill_version,
    status: "ok",
    started_at: startedAt,
    ended_at: deps.now().toISOString(),
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
    post_id: postId,
  });

  return {
    status: "ok",
    run_id: runId,
    post_id: postId,
    body_preview: postRow.body_preview,
    kind,
    references,
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
  };
}

// --- Internals -----------------------------------------------------------

function pickTokenBudget(model: string): { maxTokens: number; reasoningBudgetTokens: number } {
  const key = model.replace(/^anthropic:/, "").toLowerCase();
  // Haiku: single shared cap, no extended-thinking budget.
  if (key.includes("haiku")) return TOKEN_BUDGETS.haiku;
  // Sonnet / Opus / anything else with reasoning support: SEPARATE budgets.
  return TOKEN_BUDGETS.reasoning;
}

/** Parse the LLM response into `{body, kind, references}`. The body is
 *  everything before the final fenced JSON code block; the JSON block
 *  contains the structured tail. Exported for unit-testability. */
export function parseBodyAndTail(response: string): {
  body: string;
  kind: PostKind;
  references: string[];
} {
  // Match the LAST fenced JSON block at the END of the response. The
  // SKILL.md prompt tells the persona to emit exactly one tail block at
  // the end; anchoring on end-of-string (after trimEnd) is robust to a
  // prose body that happens to include an earlier ```json``` example.
  const trimmedResp = response.trimEnd();
  const fenceRe = /```json\s*\n([\s\S]*?)\n```\s*$/;
  const match = trimmedResp.match(fenceRe);
  if (!match) {
    throw new Error("tail_missing: no `json` fenced block at end of response");
  }
  const jsonStr = match[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`tail_malformed: ${msg.slice(0, 100)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("tail_not_object");
  }
  const obj = parsed as Record<string, unknown>;
  const kindRaw = obj.kind;
  if (typeof kindRaw !== "string" || !isPostKind(kindRaw)) {
    throw new Error(`tail_bad_kind: ${String(kindRaw)}`);
  }
  const refsRaw = obj.references ?? [];
  if (!Array.isArray(refsRaw) || refsRaw.some((r) => typeof r !== "string")) {
    throw new Error("tail_bad_references");
  }
  if (refsRaw.length > 3) {
    throw new Error(`tail_too_many_references: ${refsRaw.length} > 3`);
  }
  const body = trimmedResp.slice(0, match.index).trim();
  return {
    body,
    kind: kindRaw,
    references: refsRaw as string[],
  };
}

function isPostKind(s: string): s is PostKind {
  return s === "reflection" || s === "friction" || s === "improvement" || s === "observation";
}

async function writeRunRow(deps: FeedPostDeps, row: RunResultRow): Promise<void> {
  await deps.putItem(row);
}

async function throwAndRecord(
  deps: FeedPostDeps,
  slug: string,
  runId: string,
  startedAt: string,
  input: FeedPostInput,
  llm: CompletionResponse,
  reason: string,
): Promise<never> {
  await writeRunRow(deps, {
    pk: `AGENT#${slug}`,
    sk: `RUN#${runId}`,
    skill_name: "feed-post",
    skill_version: input.skill_version,
    status: "throw",
    started_at: startedAt,
    ended_at: deps.now().toISOString(),
    tokens_in: llm.tokens_in,
    tokens_out: llm.tokens_out,
    cost_usd: llm.cost_usd,
    error_message: reason,
  });
  await deps.putCountMetric(METRIC_NAMESPACE, "WfFeedPostThrow", 1, [
    { Name: "Agent", Value: slug },
    { Name: "Reason", Value: classifyReasonDimension(reason) },
  ]);
  throw new Error(reason);
}

/** Reduce the high-cardinality `reason` string to a low-cardinality
 *  dimension value so CloudWatch metric storage stays affordable. */
function classifyReasonDimension(reason: string): string {
  if (reason === "sentinel_in_body") return "sentinel_in_body";
  if (reason === "empty_body") return "empty_body";
  if (reason.startsWith("llm_artefact_in_head")) return "llm_artefact";
  if (reason.startsWith("tail_")) return "tail_parse";
  if (reason.startsWith("body_over_hard_cap")) return "body_over_hard_cap";
  return "other";
}
