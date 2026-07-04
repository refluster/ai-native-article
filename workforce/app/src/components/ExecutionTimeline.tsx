// ExecutionTimeline — THE execution-history presentation for the console.
//
// One visual language for "who did what, when" everywhere: the agent
// profile's ACTIVITY ledger and the project profile's EXECUTIONS both
// render through this component (the project page previously used a
// table — unified 2026-07-03 per the operator's UI-consistency direction).
//
// Geometry note (the old mis-alignment fix): the vertical rail and the
// status dots are BOTH centered in a fixed gutter column via flex
// `justify-center`, so the dot's center is on the rail's center by
// construction — no magic pixel offsets (`-left-[19px]`) that drift when
// padding, dot size, or ring width change.

import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';

// Timeline dot colour per EXEC status — the point marker reads at a
// glance: green ran clean, copper threw, grey did no work.
const DOT: Record<string, string> = {
  ok: 'bg-wf-running',
  throw: 'bg-wf-throwing',
  skipped: 'bg-wf-archived',
  failed_artefact_redaction: 'bg-wf-throwing',
};

const SUMMARY_CAP = 180;

export interface TimelineExecution {
  exec_ulid: string;
  started_at: string;
  status: string;
  error?: string;
  summary?: string;
  artifact_ref?: { summary?: string; uri?: string };
  skill_name: string;
  skill_version?: string;
  project_id?: string;
  agent_slug?: string;
}

interface Props {
  executions: TimelineExecution[];
  /** Which entity's page this renders on — decides the meta links shown
   *  per row (an agent page links project + skill; a project page links
   *  agent + skill). */
  perspective: 'agent' | 'project';
  limit?: number;
}

export default function ExecutionTimeline({ executions, perspective, limit }: Props) {
  const rows = limit ? executions.slice(0, limit) : executions;
  return (
    <ol>
      {rows.map((e, idx) => {
        // Prefer the explicit top-level engagement summary; fall back to
        // the artifact preview for CCR/legacy rows.
        const raw = (e.summary ?? e.artifact_ref?.summary)?.trim() ?? '';
        const summary = raw.length > SUMMARY_CAP ? `${raw.slice(0, SUMMARY_CAP)}…` : raw;
        // A skipped run did no work, so "skipped" is a truer body than
        // "no summary".
        const fallback = e.status === 'skipped' ? 'skipped' : 'no summary';
        const isLast = idx === rows.length - 1;
        return (
          <li key={e.exec_ulid} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3">
            {/* Gutter: rail + dot, both centered in the same 16px column so
                the dot is on the rail by construction. */}
            <span aria-hidden className="relative flex justify-center">
              <span
                className={`absolute top-0 w-px bg-wf-outline-variant ${isLast ? 'h-4' : 'bottom-0'}`}
              />
              <span
                className={`relative mt-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-wf-surface-container-lo ${DOT[e.status] ?? 'bg-wf-primary'}`}
              />
            </span>
            <div className={`text-sm min-w-0 ${isLast ? '' : 'pb-4'}`}>
              <div className="flex items-center gap-2 flex-wrap font-wfmono text-[10px] tracking-[0.08em] text-wf-on-surface-variant">
                {/* Date + time-of-day — parity with the old project table,
                    which showed HH:MM (Dario review on PR 430). */}
                <span>
                  {e.started_at?.slice(0, 10)}
                  {e.started_at?.length >= 16 && (
                    <span className="ml-1 text-wf-on-surface-variant/80">{e.started_at.slice(11, 16)}</span>
                  )}
                </span>
                <span aria-hidden>·</span>
                {perspective === 'agent' && e.project_id && (
                  <>
                    <Link
                      to={`/projects/${encodeURIComponent(e.project_id)}`}
                      className="text-wf-primary hover:underline"
                    >
                      {e.project_id}
                    </Link>
                    <span aria-hidden>·</span>
                  </>
                )}
                {perspective === 'project' && e.agent_slug && (
                  <>
                    <Link to={`/agents/${e.agent_slug}`} className="text-wf-primary hover:underline">
                      {e.agent_slug}
                    </Link>
                    <span aria-hidden>·</span>
                  </>
                )}
                <Link
                  to={`/skills/${e.skill_name}`}
                  className="hover:text-wf-primary truncate max-w-[12rem]"
                  title={e.skill_version ? `${e.skill_name} v${e.skill_version}` : e.skill_name}
                >
                  {e.skill_name}
                </Link>
                {/* Visible version — parity with the old table's sub-line
                    (was tooltip-only; Dario review on PR 430). */}
                {e.skill_version && <span className="text-wf-on-surface-variant/80">v{e.skill_version}</span>}
                <StatusBadge status={e.status} error={e.error} className="ml-auto" />
              </div>
              <div className="mt-1 leading-snug">
                {summary.length > 0 ? (
                  <span className="text-wf-on-surface">{summary}</span>
                ) : (
                  <span className="italic text-wf-on-surface-variant">{fallback}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
