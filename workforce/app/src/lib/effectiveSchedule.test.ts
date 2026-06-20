// Parity test for lib/effectiveSchedule.ts — the app-side MIRROR of the
// canonical engine predicate in workforce/lambdas/shared/agent.ts.
//
// CASES below mirror SCHEDULE_CASES in workforce/lambdas/shared/agent-tests.ts
// one-for-one. The two TS projects compile under different configs so we
// cannot import across the boundary (house convention — see the file header);
// instead both sides assert the SAME expectations. If you add/change a case
// here, change it there too. A divergence here is the exact failure class
// this fix exists to prevent: the console disagreeing with the engine about
// whether a binding fires.

import { describe, expect, it } from 'vitest';
import { bindingCronIsLoadBearing, effectiveSchedule, scheduleLabel } from './effectiveSchedule';
import type { AgentBinding } from '../types/agent';
import type { EffectiveSchedule } from './effectiveSchedule';

type Case = { name: string; binding: AgentBinding; expect: EffectiveSchedule };

const CASES: Case[] = [
  {
    name: 'orchestrator-fired CCR cron (feed-post live shape)',
    binding: {
      skill: 'feed-post',
      executor: 'claude-code-routine',
      trigger: { scheduler: 'external', invoked_by: 'api', cron: 'cron(57 3 ? * * *)' },
      routine_spec: 'workforce/docs/routines/agent-runner.md',
      project_id: 'agent-workforce',
    },
    expect: { kind: 'cron', cron: 'cron(57 3 ? * * *)', scheduler: 'external' },
  },
  {
    name: 'eventbridge Lambda cron',
    binding: {
      skill: 'discord-heartbeat',
      executor: 'lambda',
      trigger: { scheduler: 'eventbridge', cron: 'cron(20 0/2 * * ? *)' },
    },
    expect: { kind: 'cron', cron: 'cron(20 0/2 * * ? *)', scheduler: 'eventbridge' },
  },
  {
    name: 'GHA cron',
    binding: {
      skill: 'deploy-workforce-data-plane',
      executor: 'gha',
      trigger: { scheduler: 'gha', cron: 'cron(0 7 * * ? *)' },
      workflow: '.github/workflows/deploy-workforce-data-plane.yml',
    },
    expect: { kind: 'cron', cron: 'cron(0 7 * * ? *)', scheduler: 'gha' },
  },
  {
    name: 'CCR self-schedule cron',
    binding: {
      skill: 'pr-review',
      executor: 'claude-code-routine',
      trigger: { scheduler: 'claude-code-routine', cron: 'cron(0 1 ? * * *)' },
      routine_spec: 'workforce/docs/routines/dario-review.md',
    },
    expect: { kind: 'cron', cron: 'cron(0 1 ? * * *)', scheduler: 'claude-code-routine' },
  },
  {
    name: 'DEAD cron — manual scheduler with a hand-added cron (daily-research drift)',
    binding: {
      skill: 'daily-research',
      executor: 'claude-code-routine',
      trigger: { scheduler: 'manual', cron: 'cron(37 8 ? * * *)' },
      routine_spec: 'workforce/docs/routines/agent-runner.md',
      project_id: 'agent-workforce',
    },
    expect: { kind: 'dead-cron', cron: 'cron(37 8 ? * * *)', scheduler: 'manual' },
  },
  {
    name: 'DEAD cron — external but not invoked_by=api',
    binding: {
      skill: 'daily-research',
      executor: 'claude-code-routine',
      trigger: { scheduler: 'external', invoked_by: 'repository_dispatch', cron: 'cron(0 9 ? * * *)' },
      routine_spec: 'workforce/docs/routines/agent-runner.md',
    },
    expect: { kind: 'dead-cron', cron: 'cron(0 9 ? * * *)', scheduler: 'external' },
  },
  {
    name: 'clean paused — manual scheduler, no cron (seed shape)',
    binding: {
      skill: 'daily-research',
      executor: 'claude-code-routine',
      trigger: { scheduler: 'manual' },
      routine_spec: 'workforce/docs/routines/agent-runner.md',
      project_id: 'agent-workforce',
    },
    expect: { kind: 'manual', scheduler: 'manual' },
  },
  {
    name: 'declarative — cli/manual is reported manual (no cron)',
    binding: {
      skill: 'pdm-charter',
      executor: 'cli',
      trigger: { scheduler: 'manual' },
    },
    expect: { kind: 'manual', scheduler: 'manual' },
  },
  {
    name: 'declarative — github-event CCR (no cron)',
    binding: {
      skill: 'pr-review',
      executor: 'claude-code-routine',
      trigger: { scheduler: 'claude-code-routine', github_event: 'pull_request.labeled' },
      routine_spec: 'workforce/docs/routines/dario-review.md',
    },
    expect: { kind: 'declarative', scheduler: 'claude-code-routine', executor: 'claude-code-routine' },
  },
];

describe('effectiveSchedule (app mirror parity)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(effectiveSchedule(c.binding)).toEqual(c.expect);
    });
  }

  it('a dead cron is never load-bearing; a live cron always is', () => {
    for (const c of CASES) {
      if (c.expect.kind === 'dead-cron') expect(bindingCronIsLoadBearing(c.binding)).toBe(false);
      if (c.expect.kind === 'cron') expect(bindingCronIsLoadBearing(c.binding)).toBe(true);
    }
  });
});

describe('scheduleLabel (honest display)', () => {
  it('flags a dead cron instead of presenting it as live', () => {
    const dead = CASES.find((c) => c.expect.kind === 'dead-cron')!;
    const label = scheduleLabel(dead.binding);
    expect(label).toContain('not honored');
    expect(label).toContain('manual');
  });

  it('shows a live cron verbatim', () => {
    const live = CASES.find((c) => c.expect.kind === 'cron')!;
    expect(scheduleLabel(live.binding)).toBe((live.expect as { cron: string }).cron);
  });

  it('labels a pure manual binding as operator-triggered', () => {
    const manual = CASES.find((c) => c.expect.kind === 'manual')!;
    expect(scheduleLabel(manual.binding)).toBe('manual (operator-triggered)');
  });
});
