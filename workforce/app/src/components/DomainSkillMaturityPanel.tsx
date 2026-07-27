// PANEL · DOMAIN SKILL MATURITY (2026-07-24 operator request). Dreyfus
// skill-acquisition ladder (not_defined → novice → advanced_beginner →
// competent → proficient → expert) applied to `domain`-kind skills only, as
// a cumulative stacked-area chart over the trailing 90 days. Distinct from
// Sana's L0–L5 maturity_score (agent-experience-and-skill-metrics.md §3,
// execution-ledger based, all skills) — this ladder is age-derived and
// domain-only. See lib/skillGrowth.ts for the derivation rule.
//
// One hue (running/green) at increasing opacity reads as the maturity
// gradient itself — no new design tokens introduced for the extra rungs.

import Typeplate from './Typeplate';
import StackedAreaChart, { type AreaSeries } from './StackedAreaChart';
import type { DomainMaturityPoint } from '../types/skillGrowth';

const SERIES: AreaSeries[] = [
  { key: 'not_defined', label: 'not defined', fill: 'var(--wf-svg-archived)', opacity: 0.5 },
  { key: 'novice', label: 'novice', fill: 'var(--wf-svg-running)', opacity: 0.3 },
  { key: 'advanced_beginner', label: 'advanced beginner', fill: 'var(--wf-svg-running)', opacity: 0.48 },
  { key: 'competent', label: 'competent', fill: 'var(--wf-svg-running)', opacity: 0.64 },
  { key: 'proficient', label: 'proficient', fill: 'var(--wf-svg-running)', opacity: 0.8 },
  { key: 'expert', label: 'expert', fill: 'var(--wf-svg-running)', opacity: 1 },
];

export default function DomainSkillMaturityPanel({ points }: { points: DomainMaturityPoint[] }) {
  const last = points[points.length - 1];
  const expertNow = last ? last.expert : 0;
  const cohortNow = last
    ? last.not_defined + last.novice + last.advanced_beginner + last.competent + last.proficient + last.expert
    : 0;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="DOMAIN SKILL MATURITY" value="DREYFUS LADDER" />
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
              expert
            </div>
            <div className="font-headline text-3xl font-black tracking-tighter text-wf-on-surface leading-none">
              {expertNow}
            </div>
          </div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            of {cohortNow} domain skills
          </div>
        </div>

        <StackedAreaChart
          data={points as unknown as Array<Record<string, number | string>>}
          xKey="date"
          series={SERIES}
          height={170}
          ariaLabel="Domain skill maturity: Dreyfus ladder from not-defined to expert, stacked by day"
          tooltip={(d) =>
            `${d.date} — novice ${d.novice} · adv.beginner ${d.advanced_beginner} · competent ${d.competent} · proficient ${d.proficient} · expert ${d.expert}`
          }
        />

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3"
                style={{ backgroundColor: s.fill, opacity: s.opacity }}
                aria-hidden
              />
              {s.label}
              <span className="text-wf-on-surface">{last ? (last[s.key as keyof DomainMaturityPoint] as number) : 0}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          * age-derived heuristic — no per-skill maturity ledger exists yet; see lib/skillGrowth.ts
        </p>
      </div>
    </section>
  );
}
