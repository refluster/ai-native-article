/**
 * quality.ts — schema for the sidecar `.eval.json` written next to every
 * L2/L3 article at generation time.
 *
 * See GROWTH.md §2–§5 for the two-loop model this feeds. The sidecar is
 * operator-only — it stays out of public/ — but its `promptVersion` and
 * `judgeScore` are copied into the published article's frontmatter so GA4
 * events can group by prompt version (the outer loop).
 */

export type PipelineLevel = 'L2' | 'L3'

/** Dimension keys must match the rubric tables in GROWTH.md §3 and §4. */
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

export interface JudgeResult<Dim extends string = string> {
  /** Mean of `dims`. Range 0..10. */
  score: number
  /** Per-dimension scores, 0..10 each. Keys must match the rubric for `level`. */
  dims: Record<Dim, number>
  /** Free-text critique from the judge. Fed back into the generator on retry. */
  critique: string
  /** Model id used by the judge, e.g. "gpt-4o@azure". Distinct from generator. */
  judgeModel: string
  /** Rubric prompt version, e.g. "rubric-l3-2026-04-23". Changing this
   *  invalidates prior scores — see AGENTS.md §3. */
  judgeVersion: string
}

export interface ArticleEval {
  /** Notion-derived slug, same as published article's slug when this attempt shipped. */
  slug: string
  level: PipelineLevel
  /** Generator prompt version, e.g. "l3-2026-04-23a". Copied into the
   *  published article's frontmatter so GA4 events can bucket by it. */
  promptVersion: string
  /** Generator model id, e.g. "gpt-4o-mini@azure". */
  model: string
  /** Notion page IDs of the input articles — L1 IDs for L2 attempts,
   *  L2 IDs for L3 attempts. */
  sourceIds: string[]
  judge: JudgeResult<L2Dim | L3Dim>
  /** If this attempt was a retry after a failed gate, the slug of the
   *  prior attempt. Lets rubric calibration trace regeneration chains. */
  regeneratedFrom?: string
  /** ISO-8601 timestamp. */
  createdAt: string
}

/** Gate thresholds. See GROWTH.md §3, §4. Changing these is Zone A. */
export const JUDGE_GATE: Record<PipelineLevel, number> = {
  L2: 7.0,
  L3: 7.5,
}

/** Any single dimension at or below this score blocks publish regardless of
 *  the mean — prevents "great average, one fatal flaw" from shipping. */
export const DIM_FLOOR = 4

/** True if this attempt clears both the mean gate and the per-dim floor. */
export function passesGate(evaluation: ArticleEval): boolean {
  if (evaluation.judge.score < JUDGE_GATE[evaluation.level]) return false
  for (const v of Object.values(evaluation.judge.dims)) {
    if (v <= DIM_FLOOR) return false
  }
  return true
}
