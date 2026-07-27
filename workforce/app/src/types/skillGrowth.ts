// Types for the /performance "SKILL GROWTH" section (2026-07-24 operator
// request): Skill catalogue growth, Domain Skill maturity, and
// Agent-capability Skill onboarding. Unlike Epic-016's PerformanceSeries,
// none of this comes from a backend endpoint — every point here is derived
// client-side, at render time, from the real skill roster
// (`lib/skills.ts:loadWorkforceSkills()`) and agent roster
// (`lib/agents.ts:loadWorkforceManifest()`) already fetched elsewhere on the
// Dashboard. See `lib/skillGrowth.ts` for the derivation rules.

/**
 * The four-way split requested for the catalogue-growth chart. Classification
 * is a documented heuristic (`classifySkillKind` in lib/skillGrowth.ts), not a
 * field carried by any skill record — there was no existing taxonomy to reuse.
 *
 *   domain            — produces domain/subject-matter artefacts (article,
 *                        design-doc, launch-plan deliverables).
 *   automation        — fire-and-forget notifications (discord digests, feed
 *                        posts, podcast publish).
 *   agent-capability  — everything else in the workforce/skills/ cadence
 *                        catalogue: org/process capability with no domain
 *                        artefact (pr-autopilot, backlog-reconcile, reports, …).
 *   claude-custom     — Claude Code session skills under .claude/skills/ — a
 *                        different registry entirely (no DDB row, no cadence
 *                        binding), tracked via the small static list in
 *                        lib/skillGrowth.ts.
 */
export type SkillKind = 'domain' | 'agent-capability' | 'automation' | 'claude-custom';

/** One day of cumulative skill-catalogue size, split by kind. */
export interface SkillGrowthPoint {
  date: string;
  domain: number;
  agent_capability: number;
  automation: number;
  claude_custom: number;
}

/**
 * The Dreyfus skill-acquisition ladder applied to `domain`-kind skills only.
 * This is a distinct concept from Sana's `maturity_score` L0–L5 rubric
 * (workforce/docs/team/agent-experience-and-skill-metrics.md §3, computed
 * from execution-ledger outcomes across ALL skills) — this ladder instead
 * reads a domain skill's operational depth from its age, heuristically, and
 * only for the domain subset. `not_defined` is the ladder's zero rung: a
 * domain area the workforce has identified but not yet built a skill for —
 * always 0 today (no such backlog is tracked as data), shown honestly rather
 * than fabricated.
 */
export type DreyfusStage =
  | 'not_defined'
  | 'novice'
  | 'advanced_beginner'
  | 'competent'
  | 'proficient'
  | 'expert';

export const DREYFUS_STAGES: DreyfusStage[] = [
  'not_defined',
  'novice',
  'advanced_beginner',
  'competent',
  'proficient',
  'expert',
];

/** One day of the domain-skill cohort partitioned by Dreyfus stage. */
export type DomainMaturityPoint = { date: string } & Record<DreyfusStage, number>;

/**
 * Deployment-readiness funnel applied to `agent-capability`-kind skills only.
 * Each skill's CURRENT stage is read from real signals (see
 * `computeOnboardingStage` in lib/skillGrowth.ts); a skill never appears past
 * the furthest stage it has actually reached.
 *
 *   registered      — the skill row exists (created_at reached).
 *   org_placed      — has ≥1 owner assigned (`owners.length > 0`).
 *   skill_equipped  — ≥1 agent binding in the roster references this skill.
 *   deployed        — status is active AND skill_equipped.
 */
export type OnboardingStage = 'registered' | 'org_placed' | 'skill_equipped' | 'deployed';

export const ONBOARDING_STAGES: OnboardingStage[] = [
  'registered',
  'org_placed',
  'skill_equipped',
  'deployed',
];

/** One day of the agent-capability cohort partitioned by furthest onboarding stage. */
export type OnboardingPoint = { date: string } & Record<OnboardingStage, number>;
