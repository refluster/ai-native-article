/**
 * quality.ts — schema for the multi-candidate, multi-judge sidecar
 * `.eval.json` written per L2/L3 article at generation time.
 *
 * Reference: GROWTH.md §2–§5.
 *
 * Shape summary:
 *   ArticleEval
 *   ├─ sourceIds[]            ← inputs, same for every candidate
 *   ├─ candidates[]           ← one per generator on the panel (N≥1)
 *   │   ├─ generator: {id, model, systemPromptVersion}
 *   │   ├─ judges[]           ← one per judge on the panel (M≥1)
 *   │   │   └─ dims (every rubric dim, scored from this judge's perspective)
 *   │   └─ aggregate: panel-weighted per-dim + overall score
 *   └─ chosen: { candidateId, reason }
 *
 * The sidecar is operator-only; `promptVersion` of the *chosen* candidate
 * and its aggregate score are copied into the published article's
 * frontmatter so GA4 can bucket reader behavior by them (the outer loop).
 */

export type PipelineLevel = 'L2' | 'L3'

/** Rubric dim keys. Must match the tables in GROWTH.md §3 and §4. */
export type L2Dim =
  | 'faithfulness'
  | 'coverage'
  | 'coherence'
  | 'japanese_quality'
  | 'structure'
  | 'signal_to_noise'

export type L3Dim =
  | 'novel_angle'
  | 'disparate_source_bridging'
  | 'claim_source_alignment'
  | 'actionability'
  | 'falsifiability'
  | 'japanese_quality'

export type AnyDim = L2Dim | L3Dim

/** The lens a judge brings. Roster lives in GROWTH.md §2a — Zone A. */
export type JudgePerspective = 'editor' | 'domain' | 'reader'

/** One judge's scoring of one candidate. Every dim is scored from this
 *  judge's perspective — the weight in `JUDGE_ROSTER` is what converts
 *  these per-perspective scores into a per-dim aggregate. */
export interface JudgeCall {
  judgeId: string                          // e.g. 'editor-claude'
  perspective: JudgePerspective
  model: string                            // e.g. 'claude-sonnet-4-6@anthropic'
  rubricVersion: string                    // e.g. 'rubric-l3-2026-04-23'
  dims: Partial<Record<AnyDim, number>>    // 0..10 per dim
  critique: string                         // fed back on regen
}

/** One candidate: a full article draft from one generator, scored by all
 *  judges on the panel. */
export interface Candidate {
  candidateId: string                      // stable id within this ArticleEval
  generator: {
    id: string                             // e.g. 'claude-pattern'
    model: string                          // e.g. 'claude-sonnet-4-6@anthropic'
    systemPromptVersion: string            // e.g. 'l3-claude-pattern-2026-04-23a'
  }
  /** Where the draft lives — Notion page id, or operator-branch path. */
  outputRef: string
  judges: JudgeCall[]
  aggregate: {
    /** Weighted mean of `dims`. 0..10. The number the gate applies to. */
    score: number
    /** Per-dim aggregate across judges. Each value is the weighted mean
     *  of that dim across the judges that scored it. */
    dims: Partial<Record<AnyDim, number>>
  }
}

export interface ArticleEval {
  slug: string
  level: PipelineLevel
  /** Inputs shared by every candidate. L1 IDs for L2 attempts,
   *  L2 IDs for L3 attempts. */
  sourceIds: string[]
  candidates: Candidate[]
  /** The winner, chosen by aggregate score subject to `passesGate`. */
  chosen: {
    candidateId: string
    /** Short human-readable rationale — "highest aggregate, all dims ≥ 6". */
    reason: string
  }
  /** If this entire run was a regeneration (all candidates failed the
   *  prior round), the slug of the prior ArticleEval. */
  regeneratedFrom?: string
  createdAt: string
}

// -------- Panel roster & weights --------

/** Starter judge roster. Weights must sum to 1. Zone A — changing this
 *  changes the product. See GROWTH.md §2a. */
export const JUDGE_ROSTER: Array<{
  id: string
  perspective: JudgePerspective
  model: string
  weight: number
}> = [
  { id: 'editor-claude',     perspective: 'editor', model: 'claude-sonnet-4-6@anthropic',  weight: 0.25 },
  { id: 'domain-gpt4o',      perspective: 'domain', model: 'gpt-4o@azure',                 weight: 0.40 },
  { id: 'reader-gpt4o-mini', perspective: 'reader', model: 'gpt-4o-mini@azure',            weight: 0.35 },
]

/** Starter generator roster. Zone A. */
export const GENERATOR_ROSTER: Array<{
  id: string
  model: string
}> = [
  { id: 'claude-pattern', model: 'claude-sonnet-4-6@anthropic' },
  { id: 'gpt-skeptic',    model: 'gpt-4o@azure' },
]

// -------- Gates --------

/** Mean-score gate per level. Zone A. */
export const JUDGE_GATE: Record<PipelineLevel, number> = {
  L2: 7.0,
  L3: 7.5,
}

/** Any single judge's score on any dim at or below this floor blocks
 *  publish regardless of the aggregate — "panel disagreement on a low
 *  score" is itself the signal. */
export const DIM_FLOOR = 4

/** L3-specific hard floor on falsifiability — any judge ≤ 5 blocks. */
export const FALSIFIABILITY_FLOOR = 5

// -------- Derived checks --------

/** True if a candidate clears both the mean gate for its level and every
 *  per-dim floor across every judge on the panel. */
export function passesGate(candidate: Candidate, level: PipelineLevel): boolean {
  if (candidate.aggregate.score < JUDGE_GATE[level]) return false
  for (const judge of candidate.judges) {
    for (const [dim, score] of Object.entries(judge.dims)) {
      if (score === undefined) continue
      if (score <= DIM_FLOOR) return false
      if (level === 'L3' && dim === 'falsifiability' && score <= FALSIFIABILITY_FLOOR) return false
    }
  }
  return true
}

/** Pick the winning candidate by aggregate score; returns null if none
 *  clears the gate (caller should trigger regeneration). */
export function pickWinner(evalRun: ArticleEval): Candidate | null {
  const eligible = evalRun.candidates
    .filter(c => passesGate(c, evalRun.level))
    .sort((a, b) => b.aggregate.score - a.aggregate.score)
  return eligible[0] ?? null
}

/** Panel is degenerate when one generator always wins, or judges all
 *  score identically. Used in the weekly leaderboard to surface when the
 *  ensemble has stopped adding value. */
export function panelDisagreement(candidate: Candidate, dim: AnyDim): number {
  const scores = candidate.judges
    .map(j => j.dims[dim])
    .filter((s): s is number => typeof s === 'number')
  if (scores.length < 2) return 0
  const max = Math.max(...scores)
  const min = Math.min(...scores)
  return max - min
}
