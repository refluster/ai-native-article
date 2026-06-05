// Epic-012 Story 2 — memory compaction (the "MEMORY.md" rolling summary).
//
// Memory chunks (memory/{slug}/v{NNNN}.md) are append-only and thin (one per
// run). The runner only ever reads the SINGLE latest chunk as "previous
// memory", so without compaction an agent's working memory is just its last
// run. Compaction folds the run chunks accumulated since the last summary
// into a new rolling summary chunk — which then BECOMES the latest chunk, so
// the runner's next "previous memory" read is the agent's durable long-term
// memory, not its last step.
//
// This module is the pure, unit-testable core (trigger, prompt, and the
// identity-preservation guard). The S3/DDB/LLM orchestration lives in
// lambdas/memory-compactor/handler.ts.
//
// ─── Why an identity guard ────────────────────────────────────────────
//
// "Runs without losing agent identity" (ROADMAP Phase 4 / Epic-012 Story 2
// AC) must be MECHANICAL, not a hope pinned on the summariser. The rolling
// summary carries an `## Identity-laminated facts` section; compaction is
// instructed to reproduce it verbatim, and `assertIdentityPreserved` rejects
// (throws, C-4 fail-loud) any new summary that dropped a prior identity fact.
// The compactor isolates that throw per-agent and emits a metric — a bad
// summarisation never silently erases who an agent is.

import type { MemoryIndex } from "./memory.js";

/** Run chunks since the last summary before a compaction fires. Low so the
 *  rolling summary stays fresh; the cost is one summariser call per agent per
 *  threshold-crossing (nightly cadence bounds it). */
export const COMPACTION_THRESHOLD = 10;

/** Cheap-but-capable summariser. Sonnet (not Haiku) because the
 *  llm-anthropic PRICING table only prices Sonnet/Opus — using an unpriced
 *  model would yield a NaN cost. Summarisation is short, so the bill is tiny. */
export const COMPACTION_MODEL = "anthropic:claude-sonnet-4-6";

/** Visible-output budget for the summary. ~2k tokens ≈ a tight rolling
 *  summary; the runner reads it every run, so it must stay compact. */
export const COMPACTION_MAX_TOKENS = 2000;

export const IDENTITY_HEADING = "## Identity-laminated facts";

/** True when enough run chunks have accumulated since the last summary. */
export function shouldCompact(
  index: Pick<MemoryIndex, "memver" | "last_compacted_memver">,
  threshold: number = COMPACTION_THRESHOLD,
): boolean {
  const since = index.memver - (index.last_compacted_memver ?? 0);
  return since >= threshold;
}

export function buildCompactionSystemPrompt(): string {
  return [
    "You maintain an AI agent's long-term memory: a single, compact, first-person rolling summary that the agent re-reads at the start of every run.",
    "",
    "Output Markdown with EXACTLY these sections, in this order:",
    `${IDENTITY_HEADING}`,
    "## Active threads",
    "## Recent deliverables",
    "",
    "Rules:",
    `- ${IDENTITY_HEADING}: durable facts about who this agent is — persona, role, standing commitments, stable preferences. Reproduce EVERY bullet from the prior summary's identity section VERBATIM. You may ADD a new identity fact only when the new activity clearly establishes one; you may NEVER drop or reword an existing one.`,
    "- ## Active threads: ongoing lines of work, in one bullet each. Carry forward still-live threads; drop only what is clearly finished.",
    "- ## Recent deliverables: a condensed list of what the agent shipped recently. Summarise aggressively — counts and themes over per-item detail.",
    "- First person ('I'). No preamble, no closing remarks, no code fences. Stay under ~400 words total.",
  ].join("\n");
}

export function buildCompactionUserPrompt(
  priorSummary: string,
  newChunks: string[],
): string {
  const prior = priorSummary.trim()
    ? priorSummary.trim()
    : "(none — this is the first compaction; synthesise an initial identity section from the activity below and the agent's evident role)";
  const activity = newChunks.length
    ? newChunks.map((c, i) => `### chunk ${i + 1}\n${c.trim()}`).join("\n\n")
    : "(no new run chunks)";
  return [
    "## Prior rolling summary",
    prior,
    "",
    "## New run chunks since the prior summary",
    activity,
    "",
    "Produce the updated rolling summary now.",
  ].join("\n");
}

/** Extract the bullet facts under the identity heading (until the next `## `
 *  heading or EOF). Bullets are normalised (leading marker + whitespace
 *  collapsed) so the preservation check is robust to reflow. */
export function extractIdentityFacts(summary: string): string[] {
  const lines = summary.split(/\r?\n/);
  const facts: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim().startsWith("## ")) {
      inSection = line.trim() === IDENTITY_HEADING;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (m) facts.push(normaliseFact(m[1]!));
  }
  return facts;
}

function normaliseFact(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Fail loud (throw) if the new summary dropped any identity fact present in
 * the prior summary. First-compaction (empty prior) has nothing to preserve,
 * so it always passes. The comparison is substring-on-normalised so a fact
 * that survived but got reflowed still matches.
 */
export function assertIdentityPreserved(priorSummary: string, newSummary: string): void {
  const priorFacts = extractIdentityFacts(priorSummary);
  if (priorFacts.length === 0) return;
  const haystack = normaliseFact(newSummary);
  const dropped = priorFacts.filter((f) => !haystack.includes(f));
  if (dropped.length > 0) {
    throw new IdentityLossError(dropped);
  }
}

/** Thrown by `assertIdentityPreserved`; the compactor catches it per-agent,
 *  skips the write, and emits the WfMemoryCompactionIdentityLoss metric. */
export class IdentityLossError extends Error {
  readonly dropped: string[];
  constructor(dropped: string[]) {
    super(`compaction dropped ${dropped.length} identity fact(s): ${dropped.join(" | ")}`);
    this.name = "IdentityLossError";
    this.dropped = dropped;
  }
}

/** Frontmatter + body wrapper marking a chunk as a compaction summary so the
 *  next compaction (and any human reader) can tell it apart from a run chunk. */
export function buildCompactionChunk(
  slug: string,
  newMemver: number,
  fromMemver: number,
  summaryBody: string,
): string {
  const now = new Date().toISOString();
  return `---
slug: ${slug}
kind: compaction
memver: ${newMemver}
compacted_from_memver: ${fromMemver}
created_at: ${now}
---

${summaryBody.trim()}
`;
}
