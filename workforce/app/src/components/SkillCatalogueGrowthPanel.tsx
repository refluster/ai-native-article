// PANEL · SKILL CATALOGUE GROWTH (2026-07-24 operator request). Cumulative
// stacked-area chart of the skill catalogue split by kind — domain /
// agent-capability / automation / claude-custom — over the trailing 90 days.
// Every number is real: derived from each skill's actual created_at via
// lib/skillGrowth.ts, not a mock/illustrative fixture.

import Typeplate from './Typeplate';
import StackedAreaChart, { type AreaSeries } from './StackedAreaChart';
import type { SkillGrowthPoint } from '../types/skillGrowth';

const SERIES: AreaSeries[] = [
  { key: 'agent_capability', label: 'agent-capability', fill: 'var(--wf-svg-archived)' },
  { key: 'automation', label: 'automation', fill: 'var(--wf-svg-tertiary)' },
  { key: 'claude_custom', label: 'claude-custom', fill: 'var(--wf-svg-paused)' },
  { key: 'domain', label: 'domain', fill: 'var(--wf-svg-running)' },
];

export default function SkillCatalogueGrowthPanel({ points }: { points: SkillGrowthPoint[] }) {
  const last = points[points.length - 1];
  const total = last ? last.domain + last.agent_capability + last.automation + last.claude_custom : 0;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="SKILL CATALOGUE" value="GROWTH BY KIND" />
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
              catalogue
            </div>
            <div className="font-headline text-3xl font-black tracking-tighter text-wf-on-surface leading-none">
              {total}
            </div>
          </div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            skills tracked
          </div>
        </div>

        <StackedAreaChart
          data={points as unknown as Array<Record<string, number | string>>}
          xKey="date"
          series={SERIES}
          height={170}
          ariaLabel="Skill catalogue growth by kind: agent-capability, automation, claude-custom, domain, stacked by day"
          tooltip={(d) =>
            `${d.date} — domain ${d.domain} · agent-capability ${d.agent_capability} · automation ${d.automation} · claude-custom ${d.claude_custom}`
          }
        />

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3" style={{ backgroundColor: s.fill }} aria-hidden />
              {s.label}
              <span className="text-wf-on-surface">{last ? (last[s.key as keyof SkillGrowthPoint] as number) : 0}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
