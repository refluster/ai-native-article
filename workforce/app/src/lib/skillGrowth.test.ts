import { describe, expect, it } from 'vitest';
import {
  buildClassifiedSkills,
  classifySkillKind,
  computeAgentCapabilityOnboarding,
  computeDomainMaturity,
  computeOnboardingFinalState,
  computeSkillCatalogueGrowth,
  type ClassifiedSkill,
} from './skillGrowth';
import type { WorkforceSkill } from '../types/skill';
import type { WorkforceAgent } from '../types/agent';

function skill(over: Partial<WorkforceSkill>): WorkforceSkill {
  return {
    name: 'x',
    version: '0.1.0',
    status: 'active',
    deliverable: null,
    cost_class: 'small',
    owners: ['maya'],
    improvement_agent: null,
    created_at: '2026-05-01',
    description: '',
    files: [],
    ...over,
  };
}

describe('classifySkillKind', () => {
  it('buckets article/design-doc/launch-plan as domain', () => {
    expect(classifySkillKind({ deliverable: { type: 'article', publish_notion: false } })).toBe('domain');
    expect(classifySkillKind({ deliverable: { type: 'design-doc', publish_notion: false } })).toBe('domain');
    expect(classifySkillKind({ deliverable: { type: 'launch-plan', publish_notion: false } })).toBe('domain');
  });
  it('buckets notification as automation', () => {
    expect(classifySkillKind({ deliverable: { type: 'notification', publish_notion: false } })).toBe('automation');
  });
  it('buckets everything else (pr, plan, none) as agent-capability', () => {
    expect(classifySkillKind({ deliverable: { type: 'pr' as never, publish_notion: false } })).toBe('agent-capability');
    expect(classifySkillKind({ deliverable: null })).toBe('agent-capability');
  });
});

describe('buildClassifiedSkills', () => {
  it('merges the catalogue with the static claude-custom list', () => {
    const rows = buildClassifiedSkills([skill({ name: 'article-level2', deliverable: { type: 'article', publish_notion: false } })]);
    expect(rows.find((r) => r.name === 'article-level2')?.kind).toBe('domain');
    expect(rows.find((r) => r.name === 'ship-pr')?.kind).toBe('claude-custom');
  });
});

describe('computeSkillCatalogueGrowth', () => {
  it('only counts a skill from its created_at onward, cumulatively', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'a', kind: 'domain', created_at: '2026-07-01', active: true, ownersCount: 1 },
      { name: 'b', kind: 'automation', created_at: '2026-07-03', active: true, ownersCount: 1 },
    ];
    const points = computeSkillCatalogueGrowth(skills, 5, new Date('2026-07-05T00:00:00Z'));
    expect(points.map((p) => p.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
    expect(points[0]).toMatchObject({ domain: 1, automation: 0 });
    expect(points[2]).toMatchObject({ domain: 1, automation: 1 });
    expect(points[4]).toMatchObject({ domain: 1, automation: 1 });
  });
});

describe('computeDomainMaturity', () => {
  it('climbs the Dreyfus ladder by age, one rung per 18 days', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'a', kind: 'domain', created_at: '2026-04-01', active: true, ownersCount: 1 },
    ];
    const today = new Date('2026-07-04T00:00:00Z'); // age 94d -> well past expert threshold (72d)
    const points = computeDomainMaturity(skills, 1, today);
    expect(points[0].expert).toBe(1);
    expect(points[0].not_defined).toBe(0);
  });

  it('caps a non-active skill at competent', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'a', kind: 'domain', created_at: '2026-04-01', active: false, ownersCount: 1 },
    ];
    const today = new Date('2026-07-04T00:00:00Z');
    const points = computeDomainMaturity(skills, 1, today);
    expect(points[0].competent).toBe(1);
    expect(points[0].expert).toBe(0);
  });

  it('never counts a skill before it existed', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'a', kind: 'domain', created_at: '2026-07-10', active: true, ownersCount: 1 },
    ];
    const points = computeDomainMaturity(skills, 3, new Date('2026-07-05T00:00:00Z'));
    const total = (p: (typeof points)[number]) =>
      p.not_defined + p.novice + p.advanced_beginner + p.competent + p.proficient + p.expert;
    expect(points.every((p) => total(p) === 0)).toBe(true);
  });

  it('ignores non-domain skills entirely', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'a', kind: 'agent-capability', created_at: '2026-04-01', active: true, ownersCount: 1 },
    ];
    const points = computeDomainMaturity(skills, 1, new Date('2026-07-04T00:00:00Z'));
    expect(points[0].expert).toBe(0);
  });
});

function agent(bindingsSkills: string[]): Pick<WorkforceAgent, 'bindings'> {
  return {
    bindings: bindingsSkills.map((skillName) => ({ skill: skillName, trigger: { scheduler: 'manual' as const } })),
  };
}

describe('computeOnboardingFinalState', () => {
  it('requires owners for org_placed', () => {
    const s: ClassifiedSkill = { name: 'x', kind: 'agent-capability', created_at: '2026-01-01', active: true, ownersCount: 0 };
    expect(computeOnboardingFinalState(s, []).orgPlaced).toBe(false);
  });
  it('requires an org placement AND a real binding for skill_equipped', () => {
    const s: ClassifiedSkill = { name: 'x', kind: 'agent-capability', created_at: '2026-01-01', active: true, ownersCount: 1 };
    expect(computeOnboardingFinalState(s, [agent(['other'])]).skillEquipped).toBe(false);
    expect(computeOnboardingFinalState(s, [agent(['x'])]).skillEquipped).toBe(true);
  });
  it('requires active status for deployed even when equipped', () => {
    const s: ClassifiedSkill = { name: 'x', kind: 'agent-capability', created_at: '2026-01-01', active: false, ownersCount: 1 };
    expect(computeOnboardingFinalState(s, [agent(['x'])]).deployed).toBe(false);
  });
});

describe('computeAgentCapabilityOnboarding', () => {
  it('never advances a skill past a stage it never reached', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'stuck', kind: 'agent-capability', created_at: '2026-01-01', active: true, ownersCount: 0 },
    ];
    const points = computeAgentCapabilityOnboarding(skills, [], 1, new Date('2026-07-04T00:00:00Z'));
    expect(points[0].registered).toBe(1);
    expect(points[0].org_placed).toBe(0);
    expect(points[0].deployed).toBe(0);
  });

  it('advances a fully-onboarded skill to deployed once old enough', () => {
    const skills: ClassifiedSkill[] = [
      { name: 'done', kind: 'agent-capability', created_at: '2026-01-01', active: true, ownersCount: 1 },
    ];
    const points = computeAgentCapabilityOnboarding(skills, [agent(['done'])], 1, new Date('2026-07-04T00:00:00Z'));
    expect(points[0].deployed).toBe(1);
  });
});
