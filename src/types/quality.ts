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
 *   │   ├─ generator: {id, modelBinding, systemPromptVersion}
 *   │   ├─ judges[]           ← one per judge on the panel (M≥1)
 *   │   │   └─ dims (every rubric dim, scored from this judge's perspective)
 *   │   └─ aggregate: panel-weighted per-dim + overall score
 *   └─ chosen: { candidateId, reason }
 *
 * The sidecar is operator-only; `systemPromptVersion` of the *chosen*
 * candidate and its aggregate score are copied into the published
 * article's frontmatter so GA4 can bucket reader behavior by them
 * (the outer loop).
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

/** The lens a judge brings. Roster lives below — Zone A. */
export type JudgePerspective = 'editor' | 'domain' | 'reader'

// -------- Provider registry --------
//
// Provider/model selection goes through this registry so adding a second
// provider (Anthropic, Gemini, OpenAI direct) is a config change, not a
// refactor. Rosters reference `ModelBinding['id']`, the scorer code
// looks up the binding at runtime to get the credential env var and
// wire-level details.

export type Provider =
  | 'azure_openai'
  | 'openai'
  | 'anthropic'
  | 'gemini'

export interface ModelBinding {
  /** Stable id used by rosters. Not the wire-level model name. */
  id: string
  provider: Provider
  /** Provider-specific model id, e.g. 'gpt-5.4' or 'claude-sonnet-4-6'. */
  model: string
  /** Name of the env var (GAS script property) that holds the API key. */
  credentialEnvVar: string
  /** Optional endpoint env var — needed for Azure OpenAI and custom hosts. */
  endpointEnvVar?: string
}

/** Active model bindings. Zone A — adding or removing a provider is a
 *  product-shape decision, and every change must recheck the panel's
 *  diversity story in GROWTH.md §2a. */
export const MODEL_REGISTRY: ModelBinding[] = [
  {
    id: 'azure-gpt5',
    provider: 'azure_openai',
    model: 'gpt-5.4',
    credentialEnvVar: 'AZURE_OPENAPI_KEY',
    endpointEnvVar: 'AZURE_OPENAPI_ENDPOINT',
  },
  // Phase 2 — uncomment and set env vars to activate.
  // {
  //   id: 'anthropic-sonnet',
  //   provider: 'anthropic',
  //   model: 'claude-sonnet-4-6',
  //   credentialEnvVar: 'ANTHROPIC_API_KEY',
  // },
  // {
  //   id: 'openai-gpt4o',
  //   provider: 'openai',
  //   model: 'gpt-4o',
  //   credentialEnvVar: 'OPENAI_API_KEY',
  // },
  // {
  //   id: 'gemini-pro',
  //   provider: 'gemini',
  //   model: 'gemini-1.5-pro',
  //   credentialEnvVar: 'GOOGLE_API_KEY',
  // },
]

// -------- Sidecar shape --------

/** One judge's scoring of one candidate. Every dim is scored from this
 *  judge's perspective — the weight in `JUDGE_ROSTER` is what converts
 *  these per-perspective scores into a per-dim aggregate. */
export interface JudgeCall {
  judgeId: string                          // e.g. 'editor'
  perspective: JudgePerspective
  /** Resolved model label for traceability, e.g. 'azure_openai:gpt-5.4'.
   *  Derived from the roster's `modelBinding` at call time. */
  model: string
  rubricVersion: string                    // e.g. 'rubric-l3-editor-2026-04-23'
  dims: Partial<Record<AnyDim, number>>    // 0..10 per dim
  critique: string                         // fed back on regen
}

/** One candidate: a full article draft from one generator, scored by all
 *  judges on the panel. */
export interface Candidate {
  candidateId: string                      // stable id within this ArticleEval
  generator: {
    id: string                             // e.g. 'pattern'
    /** Resolved model label, e.g. 'azure_openai:gpt-5.4'. */
    model: string
    systemPromptVersion: string            // e.g. 'l3-pattern-2026-04-23a'
  }
  /** Where the draft lives — Notion page id or operator-branch path. */
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

// -------- Panel rosters --------
//
// Phase 1: all members bind to `azure-gpt5` and differentiate purely by
// system prompt. This lets us ship the ensemble against the one provider
// already wired. Phase 2 swaps individual `modelBinding` entries to reach
// real model diversity — the rosters change, nothing else.

export interface GeneratorRosterEntry {
  id: string                      // e.g. 'pattern'
  modelBinding: ModelBinding['id']
  systemPromptVersion: string
}

export interface JudgeRosterEntry {
  id: string                      // e.g. 'editor'
  perspective: JudgePerspective
  modelBinding: ModelBinding['id']
  /** Panel weight; the weights across all judges must sum to 1. */
  weight: number
  rubricVersion: string
}

/** Starter generator roster. Zone A. */
export const GENERATOR_ROSTER: GeneratorRosterEntry[] = [
  { id: 'pattern', modelBinding: 'azure-gpt5', systemPromptVersion: 'l3-pattern-2026-04-23a' },
  { id: 'skeptic', modelBinding: 'azure-gpt5', systemPromptVersion: 'l3-skeptic-2026-04-23a' },
]

/** Starter judge roster. Weights must sum to 1. Zone A. */
export const JUDGE_ROSTER: JudgeRosterEntry[] = [
  { id: 'editor', perspective: 'editor', modelBinding: 'azure-gpt5', weight: 0.25, rubricVersion: 'rubric-l3-editor-2026-04-23' },
  { id: 'domain', perspective: 'domain', modelBinding: 'azure-gpt5', weight: 0.40, rubricVersion: 'rubric-l3-domain-2026-04-23' },
  { id: 'reader', perspective: 'reader', modelBinding: 'azure-gpt5', weight: 0.35, rubricVersion: 'rubric-l3-reader-2026-04-23' },
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

/** Resolve a model-binding id to the binding. Throws on unknown id —
 *  callers should treat an unknown id as a config bug, not a runtime
 *  fallback. */
export function resolveModel(bindingId: string): ModelBinding {
  const found = MODEL_REGISTRY.find(m => m.id === bindingId)
  if (!found) throw new Error(`quality.ts: unknown model binding '${bindingId}'`)
  return found
}
