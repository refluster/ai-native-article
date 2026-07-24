// PANEL · AGENT-CAPABILITY SKILL ONBOARDING (2026-07-24 operator request).
// Deployment-readiness funnel (registered → org_placed → skill_equipped →
// deployed) applied to `agent-capability`-kind skills only, as a cumulative
// stacked-area chart over the trailing 90 days. Each skill's CURRENT stage is
// read from real signals (owners[], agent-roster bindings, status) — see
// lib/skillGrowth.ts. Same funnel semantics/colours as AgentLifecyclePanel's
// registered → assigned → delivered.

import Typeplate from './Typeplate';
import StackedAreaChart, { type AreaSeries } from './StackedAreaChart';
import type { OnboardingPoint } from '../types/skillGrowth';

const SERIES: AreaSeries[] = [
  { key: 'registered', label: 'registered', fill: 'var(--wf-svg-archived)' },
  { key: 'org_placed', label: 'org placed', fill: 'var(--wf-svg-paused)' },
  { key: 'skill_equipped', label: 'skill equipped', fill: 'var(--wf-svg-primary)' },
  { key: 'deployed', label: 'deployed', fill: 'var(--wf-svg-running)' },
];

export default function AgentCapabilityOnboardingPanel({ points }: { points: OnboardingPoint[] }) {
  const last = points[points.length - 1];
  const deployedNow = last ? last.deployed : 0;
  const cohortNow = last ? last.registered + last.org_placed + last.skill_equipped + last.deployed : 0;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="AGENT-CAPABILITY ONBOARDING" value="REGISTERED → DEPLOYED" />
        {points.length > 0 && (
          <span className="hidden sm:inline font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            {points[0].date} → {points[points.length - 1].date}
          </span>
        )}
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mb-4">
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              deployed
            </div>
            <div className="font-headline text-3xl font-black tracking-tighter text-wf-on-surface leading-none">
              {deployedNow}
            </div>
          </div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            of {cohortNow} agent-capability skills
          </div>
        </div>

        <StackedAreaChart
          data={points as unknown as Array<Record<string, number | string>>}
          xKey="date"
          series={SERIES}
          height={170}
          ariaLabel="Agent-capability skill onboarding: registered, org placed, skill equipped, deployed, stacked by day"
          tooltip={(d) =>
            `${d.date} — registered ${d.registered} · org placed ${d.org_placed} · skill equipped ${d.skill_equipped} · deployed ${d.deployed}`
          }
        />

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3" style={{ backgroundColor: s.fill }} aria-hidden />
              {s.label}
              <span className="text-wf-on-surface">{last ? (last[s.key as keyof OnboardingPoint] as number) : 0}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
