// 成果 / TRACK RECORD — business-level activity for an agent.
//
// The "EXEC · RECENT" list below this is the raw run log: every cron tick,
// including the 2-hourly heartbeat (discord-ping), shows up there. That reads
// as a flat time-log, which is the wrong altitude for "what did this agent
// actually accomplish".
//
// This section answers the business question instead: it keeps only the
// executions that produced a real DELIVERABLE — article / pr / design-doc /
// plan / launch-plan — and renders each as an outcome (what was shipped, in
// which project, with what status), grouping out the operational noise.
//
// Classification source: the bundled /workforce-skills.json manifest, where
// each skill declares its `deliverable.type`. A skill counts as
// business-producing when that type is in BUSINESS_TYPES (i.e. NOT
// `notification`, which is feed-post / discord operational chatter, and NOT
// `null`, which is heartbeats / routing / ops). Unknown skills (absent from
// the manifest) default to operational.
//
// Front-end-only by design — no new API. Known limitation: it filters the
// recent execution window the profile already fetched, so a deliverable
// buried under a long tail of heartbeats beyond that window won't appear; a
// server-side `?kind=deliverable` filter is the follow-up once deliverable
// volume makes that matter (tracked in the PR).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Typeplate from './Typeplate';
import StatusBadge from './StatusBadge';
import { apiConfigured, type AgentExecution } from '../lib/agents';
import { loadWorkforceSkillManifest } from '../lib/skills';
import type { DeliverableType, WorkforceSkillManifest } from '../types/skill';

/** Deliverable types that count as a business outcome on the track record.
 *  `notification` (feed-post / discord) is operational, not a deliverable. */
const BUSINESS_TYPES: ReadonlySet<DeliverableType> = new Set<DeliverableType>([
  'article',
  'pr',
  'design-doc',
  'plan',
  'launch-plan',
]);

const TYPE_META: Record<string, { icon: string; label: string }> = {
  article: { icon: '📄', label: 'ARTICLE' },
  pr: { icon: '🔀', label: 'PR' },
  'design-doc': { icon: '🎨', label: 'DESIGN' },
  plan: { icon: '🧭', label: 'PLAN' },
  'launch-plan': { icon: '🚀', label: 'LAUNCH' },
};

const SUMMARY_CAP = 180;

export default function TrackRecordSection({ execs }: { execs: AgentExecution[] | null }) {
  const [manifest, setManifest] = useState<WorkforceSkillManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWorkforceSkillManifest()
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        if (!cancelled) setManifest(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // skill_name -> business deliverable type (absent = operational / unknown).
  const businessTypeOf = useMemo(() => {
    const map = new Map<string, DeliverableType>();
    for (const s of manifest?.skills ?? []) {
      if (s.deliverable && BUSINESS_TYPES.has(s.deliverable.type)) {
        map.set(s.name, s.deliverable.type);
      }
    }
    return map;
  }, [manifest]);

  const outcomes = useMemo(
    () =>
      (execs ?? [])
        .filter((e) => businessTypeOf.has(e.skill_name))
        .map((e) => ({ e, type: businessTypeOf.get(e.skill_name)! })),
    [execs, businessTypeOf],
  );

  if (!apiConfigured()) return null;

  const operationalCount = (execs ?? []).length - outcomes.length;
  const loading = execs === null || manifest === null;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3">
        <Typeplate label="成果" value="TRACK RECORD · DELIVERABLES" />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant shrink-0">
          {outcomes.length} outcome{outcomes.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="p-4">
        {loading ? (
          <p className="font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
        ) : outcomes.length === 0 ? (
          <p className="text-xs text-wf-on-surface-variant leading-relaxed">
            まだ業務成果物はありません。
            {operationalCount > 0 && (
              <>
                {' '}
                直近 {operationalCount} 件は運用実行(死活通知など)です。
              </>
            )}{' '}
            このエージェントが記事・PR・デザイン・計画・ローンチを出すと、ここに
            業務単位で並びます(生の実行ログは下の EXEC を参照)。
          </p>
        ) : (
          <ul className="divide-y divide-wf-outline-variant">
            {outcomes.map(({ e, type }) => {
              const meta = TYPE_META[type] ?? { icon: '•', label: type.toUpperCase() };
              const raw = e.artifact_ref?.summary?.trim() ?? '';
              const summary = raw.length > SUMMARY_CAP ? `${raw.slice(0, SUMMARY_CAP)}…` : raw;
              return (
                <li key={e.exec_ulid} className="py-2.5 flex items-baseline gap-3 text-sm">
                  <span className="font-wfmono text-xs text-wf-on-surface-variant shrink-0 w-24">
                    {e.started_at?.slice(0, 10)}
                  </span>
                  <span
                    className="shrink-0 w-24 font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-tertiary"
                    title={type}
                  >
                    {meta.icon} {meta.label}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-wf-on-surface">
                      {summary.length > 0 ? (
                        summary
                      ) : (
                        <span className="italic text-wf-on-surface-variant">(no summary)</span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2 font-wfmono text-[10px] text-wf-on-surface-variant">
                      <Link
                        to={`/projects/${encodeURIComponent(e.project_id)}`}
                        className="text-wf-primary hover:underline"
                      >
                        {e.project_id}
                      </Link>
                      <StatusBadge status={e.status} error={e.error} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
