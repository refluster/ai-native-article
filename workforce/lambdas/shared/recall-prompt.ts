// Epic-012 Story 1 — assemble the "recall packet" injected into an agent's
// run prompt so it reasons from its own past experience, not just the
// previous-run memory chunk.
//
// Kept separate from agent-runner/handler.ts so the prompt-budget logic
// (the bug-prone part: char cap, visible omission, fail-loud single-entry
// overflow) is unit-testable without the runner's AWS-heavy import graph.
//
// Retrieval (the network-bearing recall() call) is wrapped fail-soft here:
// recall is an enhancement, never a run-blocker. The ONLY loud failure is a
// rendering-budget contradiction (a single entry that alone exceeds the
// cap) — that's a misconfiguration, not a transient, so it throws (C-4).

import { recall, type RecallResult } from "./recall.js";
import type { ProjectId } from "./project.js";

/** Default number of past executions to semantically recall per run; a skill
 *  overrides via meta.recall_k (0 = opt out). Resolves Epic-012 Q1. */
export const RECALL_K_DEFAULT = 3;

/** Hard char budget for the rendered recall block. Overflow → a visible
 *  "omitted" marker (loud, not silent); a single entry that alone exceeds
 *  the cap throws (C-4 fail-loud). */
export const RECALL_BLOCK_CHAR_CAP = 1500;

/** Query basis mirrors the write-time embedding basis ({skill_name,
 *  inputs_summary, artifact.summary, error}) closely enough to match:
 *  skill name + operator brief + project. */
export function buildRecallQuery(
  skillName: string,
  brief: string | undefined,
  projectId: string,
): string {
  return [skillName, brief, projectId]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" — ");
}

export interface BuildRecallBlockInput {
  caller_agent_slug: string;
  brief?: string;
  skillName: string;
  /** From skill.meta.recall_k; undefined → RECALL_K_DEFAULT. */
  recall_k?: number;
  projectId: ProjectId;
}

/**
 * Caller-scoped (an agent recalls its own history, never a peer's; Epic-012
 * Q2). Fail-soft on retrieval: a missing Voyage key, an un-embedded ledger,
 * or a transient error yields an empty block and the run proceeds (mirrors
 * the fail-soft embedding-write path).
 */
export async function buildRecallBlock(input: BuildRecallBlockInput): Promise<string> {
  const k = input.recall_k ?? RECALL_K_DEFAULT;
  if (k <= 0) return "";

  const query = buildRecallQuery(input.skillName, input.brief, input.projectId);

  let results: RecallResult[];
  try {
    results = await recall({
      caller_agent_slug: input.caller_agent_slug,
      query,
      k,
      embedding_project_id: input.projectId,
    });
  } catch (err) {
    console.warn(
      `[recall] skipped for ${input.caller_agent_slug}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
  return renderRecallBlock(results);
}

/** Render recalled executions to a markdown block under
 *  RECALL_BLOCK_CHAR_CAP. Results are relevance-ranked (top-k cosine), so on
 *  overflow we keep the most-relevant prefix and append a VISIBLE omission
 *  marker. A single entry that alone exceeds the cap throws (C-4). */
export function renderRecallBlock(results: RecallResult[]): string {
  if (results.length === 0) return "";
  const header =
    "\n## Relevant past work (recalled)\n\nThese are your own earlier executions, surfaced because they resemble the task at hand. Draw on them where useful.\n\n";
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = 0; i < results.length; i++) {
    const line = renderRecallLine(results[i]!);
    if (line.length > RECALL_BLOCK_CHAR_CAP) {
      throw new Error(
        `recall: single entry (${line.length} chars) exceeds RECALL_BLOCK_CHAR_CAP=${RECALL_BLOCK_CHAR_CAP} — raise the cap or bound artifact_ref.summary`,
      );
    }
    if (used + line.length + 1 > RECALL_BLOCK_CHAR_CAP) {
      omitted = results.length - i;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (omitted > 0) {
    lines.push(
      `- (${omitted} less-relevant match${omitted === 1 ? "" : "es"} omitted for prompt budget)`,
    );
  }
  return header + lines.join("\n") + "\n";
}

function renderRecallLine(result: RecallResult): string {
  const row = result.row;
  const when = row.started_at.slice(0, 10);
  // Prefer the top-level engagement summary (the business line); fall back to
  // the artifact preview for legacy/CCR rows, then the error, then a marker.
  const summary = row.summary ?? row.artifact_ref?.summary ?? row.error ?? "(no summary)";
  return `- [${when} · ${row.skill_name} · ${row.status}] ${summary}`;
}
