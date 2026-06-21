// MIRROR of workforce/lambdas/shared/agent.ts (effectiveSchedule /
// bindingCronIsLoadBearing / isOrchestratorOwnedCcr). Duplicated — not
// imported — because the two TS projects compile under different
// module/target configs (same precedent as types/agent.ts and
// lib/credentials.ts). The logic MUST stay identical to the canonical
// engine copy: it is the single predicate that decides how a binding's
// schedule is displayed, derived from the same gate the orchestrator-tick
// uses to decide firing. Keep this in lockstep with the canonical copy and
// its parity fixture (workforce/lambdas/shared/agent-tests.ts SCHEDULE_CASES,
// re-asserted in effectiveSchedule.test.ts).
//
// Why this exists: a binding can carry a `trigger.cron` that no scheduler
// actually consumes (e.g. a cron hand-added while scheduler stayed `manual`
// — the daily-research / Epic-015 drift). The naive render `cron ?? scheduler`
// presented that decorative cron as a live schedule, so the console disagreed
// with the engine, which never fires it. effectiveSchedule closes that seam.

import type { AgentBinding } from '../types/agent';

type SchedulerKind = AgentBinding['trigger']['scheduler'];
type ExecutorKind = NonNullable<AgentBinding['executor']>;

/** Canonical mirror: the orchestrator-tick fires a CCR binding only when
 *  executor=claude-code-routine + scheduler=external + invoked_by=api. */
export function isOrchestratorOwnedCcr(binding: AgentBinding): boolean {
  return (
    binding.executor === 'claude-code-routine' &&
    binding.trigger?.scheduler === 'external' &&
    binding.trigger?.invoked_by === 'api'
  );
}

/** True when some scheduler actually consumes `trigger.cron`. Any other
 *  scheduler carrying a cron has a dead (decorative) cron. */
export function bindingCronIsLoadBearing(binding: AgentBinding): boolean {
  const s = binding.trigger?.scheduler;
  return (
    isOrchestratorOwnedCcr(binding) ||
    s === 'eventbridge' ||
    s === 'gha' ||
    s === 'claude-code-routine'
  );
}

export type EffectiveSchedule =
  | { kind: 'cron'; cron: string; scheduler: SchedulerKind }
  | { kind: 'dead-cron'; cron: string; scheduler: SchedulerKind }
  | { kind: 'manual'; scheduler: SchedulerKind }
  | { kind: 'declarative'; scheduler: SchedulerKind; executor?: ExecutorKind };

export function effectiveSchedule(binding: AgentBinding): EffectiveSchedule {
  const scheduler = binding.trigger?.scheduler;
  const cron = binding.trigger?.cron;
  if (typeof cron === 'string' && cron.length > 0) {
    return bindingCronIsLoadBearing(binding)
      ? { kind: 'cron', cron, scheduler }
      : { kind: 'dead-cron', cron, scheduler };
  }
  if (scheduler === 'manual') return { kind: 'manual', scheduler };
  return { kind: 'declarative', scheduler, executor: binding.executor };
}

/** Operator-facing one-line label for a binding's schedule cell. Honest by
 *  construction: a dead cron is flagged, never shown as if it were live. */
export function scheduleLabel(binding: AgentBinding): string {
  const s = effectiveSchedule(binding);
  switch (s.kind) {
    case 'cron':
      return s.cron;
    case 'dead-cron':
      // The cron is inert; say so. Enabling it is the operator's B-authority
      // flip to scheduler=external + invoked_by=api (see bindings.md).
      return `manual (paused) — ${s.cron} not honored`;
    case 'manual':
      return 'manual (operator-triggered)';
    case 'declarative':
      return s.scheduler;
  }
}
