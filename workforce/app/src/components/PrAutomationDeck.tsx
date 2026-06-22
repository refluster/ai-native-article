// DECK · PR AUTOMATION (Epic-016 Metric 3). Daily merged-PR throughput split
// into autopilot-merged (no human in the loop) vs human-involved, plus a
// summary band: autopilot share (the headline, target → 100%), churn (± lines
// per PR), and the distinct humans still touching merged PRs (the set we are
// trying to shrink). The PR series is real — derived offline from git history
// by workforce/scripts/build-pr-metrics.mjs.

import Typeplate from './Typeplate';
import type { PerformanceSeries } from '../types/performance';

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export default function PrAutomationDeck({ series }: { series: PerformanceSeries }) {
  const days = series.pr_daily;
  const s = series.pr_summary;
  const maxPrs = Math.max(1, ...days.map((d) => d.prs));
  const meanAdd = s.total_prs > 0 ? Math.round(s.total_additions / s.total_prs) : 0;
  const meanDel = s.total_prs > 0 ? Math.round(s.total_deletions / s.total_prs) : 0;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="DECK 04 · PR AUTOMATION" value="HUMAN-OUT-OF-LOOP TREND" />
        <span className="hidden sm:inline font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {series.window.start} → {series.window.end}
        </span>
      </div>

      <div className="p-4">
        {/* Summary band. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          <Stat
            cap="AUTOPILOT SHARE"
            value={pct(s.autopilot_share)}
            sub={`${s.autopilot_merged} of ${s.total_prs} PRs`}
            emphasis
          />
          <Stat cap="PRS · WINDOW" value={String(s.total_prs)} sub="merged" />
          <Stat
            cap="CHURN · PER PR"
            value={`+${meanAdd}/−${meanDel}`}
            sub={`+${s.total_additions}/−${s.total_deletions} total`}
          />
          <Stat
            cap="HUMANS INVOLVED"
            value={String(s.humans_involved.length)}
            sub={s.humans_involved.length === 0 ? 'fully autonomous' : 'still in the loop'}
            alarm={s.humans_involved.length > 0}
          />
        </div>

        {/* Daily stacked bars: autopilot (green) over human-involved (amber). */}
        <div className="overflow-x-auto">
          <div className="flex items-end gap-[3px]" style={{ height: 120, minWidth: days.length * 10 }}>
            {days.map((d) => {
              const human = Math.max(0, d.prs - d.autopilot_merged);
              const h = (d.prs / maxPrs) * 100;
              const autoFrac = d.prs > 0 ? d.autopilot_merged / d.prs : 0;
              return (
                <div
                  key={d.date}
                  className="flex-1 min-w-[6px] flex flex-col justify-end"
                  style={{ height: '100%' }}
                  title={`${d.date} — ${d.prs} PR${d.prs === 1 ? '' : 's'} · ${d.autopilot_merged} autopilot · ${human} human · +${d.additions}/−${d.deletions}`}
                >
                  <div style={{ height: `${h}%` }} className="flex flex-col justify-end">
                    {human > 0 && (
                      <div className="bg-wf-paused" style={{ height: `${(1 - autoFrac) * 100}%` }} />
                    )}
                    {d.autopilot_merged > 0 && (
                      <div className="bg-wf-running" style={{ height: `${autoFrac * 100}%` }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend + churn key. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 bg-wf-running" aria-hidden /> autopilot-merged
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 bg-wf-paused" aria-hidden /> human-involved
          </span>
        </div>

        {/* Humans-involved chips — the set we are shrinking. */}
        {s.humans_involved.length > 0 && (
          <div className="mt-4">
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1.5">
              humans in the loop
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {s.humans_involved.map((h) => (
                <li
                  key={h}
                  className="font-wfmono text-[11px] text-wf-on-surface border border-wf-outline-variant bg-wf-surface px-2 py-0.5 rounded-wf-sm"
                >
                  {h}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  cap,
  value,
  sub,
  emphasis = false,
  alarm = false,
}: {
  cap: string;
  value: string;
  sub: string;
  emphasis?: boolean;
  alarm?: boolean;
}) {
  return (
    <div>
      <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        {cap}
      </div>
      <div
        className={`font-headline font-black tracking-tighter leading-none ${
          emphasis ? 'text-3xl' : 'text-2xl'
        } ${alarm ? 'text-wf-throwing' : 'text-wf-on-surface'}`}
      >
        {value}
      </div>
      <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mt-0.5">
        {sub}
      </div>
    </div>
  );
}
