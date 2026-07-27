// Derives the three "SKILL GROWTH" /performance charts (2026-07-24 operator
// request) entirely client-side from the real skill roster
// (`lib/skills.ts:loadWorkforceSkills()`) and agent roster
// (`lib/agents.ts:loadWorkforceManifest()`). No backend endpoint, no mock
// dataset — every number here traces back to a real `created_at` / `owners`
// / `status` / binding on an actual skill or agent record. Where a metric
// requires a fact nobody records (WHEN a skill crossed a maturity rung or
// onboarding stage), the gap is bridged with a documented, deterministic
// age-based heuristic — never a random or fabricated value — and the
// heuristic is capped at each skill's real, currently-observable state so it
// can never claim a skill reached further than it truly has.

import type { WorkforceSkill } from '../types/skill';
import type { WorkforceAgent } from '../types/agent';
import {
  DREYFUS_STAGES,
  type DomainMaturityPoint,
  type DreyfusStage,
  type OnboardingPoint,
  type OnboardingStage,
  type SkillGrowthPoint,
  type SkillKind,
} from '../types/skillGrowth';

// ── .claude/skills/* — a separate registry from workforce/skills/ ──────────
// Claude Code session skills carry no DDB row and no build-time manifest, so
// there is nothing to fetch. created_at is each skill directory's real first
// commit date (`git log --diff-filter=A --format=%cI -- .claude/skills/{name}`,
// confirmed 2026-07-24). Add a line here when a new one ships.
export const CLAUDE_CUSTOM_SKILLS: { name: string; created_at: string }[] = [
  { name: 'article-health', created_at: '2026-07-03' },
  { name: 'cadence-forge', created_at: '2026-07-03' },
  { name: 'log-workforce-engagements', created_at: '2026-07-03' },
  { name: 'ship-pr', created_at: '2026-07-03' },
];

/** Classifies a `workforce/skills/*` catalogue entry by its deliverable
 *  shape (operator delegated the taxonomy, 2026-07-24 — this is the
 *  documented rule, not a field any skill record carries):
 *   - article / design-doc / launch-plan → domain (a subject-matter artefact)
 *   - notification                       → automation (fire-and-forget)
 *   - everything else (pr, external-pr-merge, plan, no deliverable)
 *                                         → agent-capability (org/process work)
 *  `.claude/skills/*` entries are classified 'claude-custom' by construction
 *  (see buildClassifiedSkills) — this function only sees registry skills. */
export function classifySkillKind(skill: Pick<WorkforceSkill, 'deliverable'>): SkillKind {
  const t = skill.deliverable?.type;
  if (t === 'article' || t === 'design-doc' || t === 'launch-plan') return 'domain';
  if (t === 'notification') return 'automation';
  return 'agent-capability';
}

export interface ClassifiedSkill {
  name: string;
  kind: SkillKind;
  /** YYYY-MM-DD. */
  created_at: string;
  active: boolean;
  ownersCount: number;
}

/** Merges the two registries into one flat classified list — the shared
 *  input every compute* function below works from. */
export function buildClassifiedSkills(skills: WorkforceSkill[]): ClassifiedSkill[] {
  const fromCatalogue: ClassifiedSkill[] = skills.map((s) => ({
    name: s.name,
    kind: classifySkillKind(s),
    created_at: s.created_at.slice(0, 10),
    active: s.status === 'active',
    ownersCount: s.owners.length,
  }));
  const fromClaude: ClassifiedSkill[] = CLAUDE_CUSTOM_SKILLS.map((s) => ({
    name: s.name,
    kind: 'claude-custom',
    created_at: s.created_at,
    active: true,
    ownersCount: 1, // operator-owned by construction — .claude/skills/ has no owners[] field
  }));
  return [...fromCatalogue, ...fromClaude];
}

// ── shared date-window helper (mirrors lib/performance.ts's lastNDaysUTC) ──

function lastNDaysUTC(n: number, today: Date): string[] {
  const base = new Date(today);
  base.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

function ageDaysAt(createdAt: string, date: string): number {
  const created = Date.parse(`${createdAt}T00:00:00Z`);
  const day = Date.parse(`${date}T00:00:00Z`);
  return Math.floor((day - created) / 86_400_000);
}

// ── Skill catalogue growth (requirement 2) ──────────────────────────────────

/** Cumulative catalogue size by kind, one point per day — a skill counts
 *  from the day its real `created_at` lands, nothing earlier, nothing later. */
export function computeSkillCatalogueGrowth(
  skills: ClassifiedSkill[],
  days = 90,
  today: Date = new Date(),
): SkillGrowthPoint[] {
  const dates = lastNDaysUTC(days, today);
  return dates.map((date) => {
    const point: SkillGrowthPoint = { date, domain: 0, agent_capability: 0, automation: 0, claude_custom: 0 };
    for (const s of skills) {
      if (s.created_at > date) continue;
      if (s.kind === 'domain') point.domain += 1;
      else if (s.kind === 'agent-capability') point.agent_capability += 1;
      else if (s.kind === 'automation') point.automation += 1;
      else point.claude_custom += 1;
    }
    return point;
  });
}

// ── Domain Skill maturity — Dreyfus ladder (requirement 3) ─────────────────

// 5 non-zero rungs × 18 days = 90 days — a skill created at the start of the
// 3-month window reaches 'expert' by the window's end. `not_defined` is never
// assigned here (see types/skillGrowth.ts) — it stays the ladder's documented
// zero rung for domain areas with no skill built yet, which this function has
// no data to enumerate.
const RUNG_DAYS = 18;
const NON_ZERO_STAGES: DreyfusStage[] = DREYFUS_STAGES.filter((s) => s !== 'not_defined');
const COMPETENT_IDX = NON_ZERO_STAGES.indexOf('competent');

/** A skill still `active` climbs the ladder by age; a stale/deprecated/
 *  archived one freezes at 'competent' at the latest — it stopped improving
 *  when it stopped being maintained, so it should not keep "aging into"
 *  expert on the chart. */
function dreyfusStageForAge(ageDays: number, active: boolean): DreyfusStage {
  let idx = Math.min(NON_ZERO_STAGES.length - 1, Math.floor(ageDays / RUNG_DAYS));
  if (!active) idx = Math.min(idx, COMPETENT_IDX);
  return NON_ZERO_STAGES[Math.max(0, idx)];
}

export function computeDomainMaturity(
  skills: ClassifiedSkill[],
  days = 90,
  today: Date = new Date(),
): DomainMaturityPoint[] {
  const domainSkills = skills.filter((s) => s.kind === 'domain');
  const dates = lastNDaysUTC(days, today);
  return dates.map((date) => {
    const point = {
      date,
      not_defined: 0,
      novice: 0,
      advanced_beginner: 0,
      competent: 0,
      proficient: 0,
      expert: 0,
    } as DomainMaturityPoint;
    for (const s of domainSkills) {
      const age = ageDaysAt(s.created_at, date);
      if (age < 0) continue; // doesn't exist yet on this date
      point[dreyfusStageForAge(age, s.active)] += 1;
    }
    return point;
  });
}

// ── Agent-capability Skill onboarding (requirement 4) ───────────────────────

const ORG_PLACED_DELAY_DAYS = 7;
const SKILL_EQUIPPED_DELAY_DAYS = 21;
const DEPLOYED_DELAY_DAYS = 35;

export interface OnboardingFinalState {
  name: string;
  created_at: string;
  orgPlaced: boolean;
  skillEquipped: boolean;
  deployed: boolean;
}

/** Reads a skill's CURRENT onboarding reach from real signals — never a
 *  guess. `skill_equipped` cross-references the live agent roster's
 *  bindings, the same roster the Dashboard already loads for the crew table. */
export function computeOnboardingFinalState(
  skill: ClassifiedSkill,
  agents: Pick<WorkforceAgent, 'bindings'>[],
): OnboardingFinalState {
  const orgPlaced = skill.ownersCount > 0;
  const skillEquipped = orgPlaced && agents.some((a) => a.bindings.some((b) => b.skill === skill.name));
  const deployed = skillEquipped && skill.active;
  return { name: skill.name, created_at: skill.created_at, orgPlaced, skillEquipped, deployed };
}

/** A skill only advances past a stage it has truly reached (per
 *  `OnboardingFinalState`) — the delay constants shape WHEN it crossed each
 *  threshold it did reach, never invent a threshold it didn't. */
function onboardingStageForAge(ageDays: number, final: OnboardingFinalState): OnboardingStage {
  if (final.deployed && ageDays >= DEPLOYED_DELAY_DAYS) return 'deployed';
  if (final.skillEquipped && ageDays >= SKILL_EQUIPPED_DELAY_DAYS) return 'skill_equipped';
  if (final.orgPlaced && ageDays >= ORG_PLACED_DELAY_DAYS) return 'org_placed';
  return 'registered';
}

export function computeAgentCapabilityOnboarding(
  skills: ClassifiedSkill[],
  agents: Pick<WorkforceAgent, 'bindings'>[],
  days = 90,
  today: Date = new Date(),
): OnboardingPoint[] {
  const finals = skills.filter((s) => s.kind === 'agent-capability').map((s) => computeOnboardingFinalState(s, agents));
  const dates = lastNDaysUTC(days, today);
  return dates.map((date) => {
    const point = { date, registered: 0, org_placed: 0, skill_equipped: 0, deployed: 0 } as OnboardingPoint;
    for (const final of finals) {
      const age = ageDaysAt(final.created_at, date);
      if (age < 0) continue;
      point[onboardingStageForAge(age, final)] += 1;
    }
    return point;
  });
}
