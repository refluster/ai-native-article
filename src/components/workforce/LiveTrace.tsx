// Recent-runs strip — a one-line scrolling ribbon of the latest agent
// activity. Mocked from workforce-mock-stats.json#recent_runs when the
// live API is unconfigured. Click a row to jump to that agent's profile.

import { Link } from 'react-router-dom';
import type { MockRecentRun } from '../../types/workforce-stats';

interface Props {
  runs: MockRecentRun[];
  className?: string;
  /** Cap the visible rows. Default 6. */
  limit?: number;
}

function relativeFromNow(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.max(0, Math.round((now - then) / 60000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

function statusInk(status: MockRecentRun['status']): string {
  if (status === 'throw' || status === 'dlq') return 'text-wf-tertiary';
  return 'text-wf-running';
}

export default function LiveTrace({ runs, className = '', limit = 6 }: Props) {
  const visible = runs.slice(0, limit);
  return (
    <div className={`border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md ${className}`}>
      <div className="border-b border-wf-outline-variant px-4 py-2 flex items-center justify-between">
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          <span className="inline-block w-1.5 h-1.5 bg-wf-tertiary mr-2 align-middle" />
          LIVE TRACE
        </span>
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          last {visible.length} runs
        </span>
      </div>
      <ul className="divide-y divide-wf-outline-variant">
        {visible.map((run) => (
          <li key={`${run.slug}-${run.started_at}`} className="px-4 py-2.5 flex items-center gap-3 text-sm">
            <Link
              to={`/workforce/agents/${run.slug}`}
              className="font-wfmono font-semibold uppercase tracking-[0.08em] text-wf-on-surface hover:text-wf-primary"
            >
              {run.slug.toUpperCase()}
            </Link>
            <span className="text-wf-on-surface-variant font-wfmono text-xs">{run.skill}</span>
            <span className={`font-wfmono text-[11px] uppercase tracking-[0.12em] ${statusInk(run.status)}`}>
              {run.status}
            </span>
            <span className="ml-auto text-wf-on-surface-variant font-wfmono text-xs whitespace-nowrap">
              {relativeFromNow(run.started_at)} · {Math.round(run.duration_s)}s
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
