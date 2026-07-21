// Project reports index: every markdown report the workforce has published
// under public/reports/, newest first, grouped by project. Reports are
// repo-authored deliverables (sponsor/management-facing), distinct from the
// feed (raw activity) and the performance dashboard (metrics).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import { fetchReportManifest, reportPath, type ReportMeta } from '../lib/reports';

export default function Reports() {
  const [reports, setReports] = useState<ReportMeta[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchReportManifest()
      .then(rows => {
        if (!cancelled) setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byProject = new Map<string, ReportMeta[]>();
  for (const r of reports ?? []) {
    const list = byProject.get(r.project) ?? [];
    list.push(r);
    byProject.set(r.project, list);
  }

  return (
    <WorkforceLayout>
      <div className="max-w-[860px]">
        <h1 className="font-headline font-black tracking-tight text-2xl text-wf-on-surface">Reports</h1>
        <p className="mt-1 text-sm text-wf-on-surface-variant">
          Project reports authored by the workforce for sponsors and management.
        </p>

        {error && (
          <div className="mt-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 text-sm text-wf-throwing">
            Failed to load the report index.
          </div>
        )}
        {!error && reports === null && (
          <div className="mt-6 font-wfmono text-xs text-wf-on-surface-variant animate-pulse">Loading reports…</div>
        )}
        {!error && reports !== null && reports.length === 0 && (
          <div className="mt-6 text-sm text-wf-on-surface-variant">No reports published yet.</div>
        )}

        {[...byProject.entries()].map(([project, rows]) => (
          <section key={project} className="mt-8">
            <h2 className="font-wfmono text-[11px] font-semibold uppercase tracking-[0.14em] text-wf-on-surface-variant">
              {project}
            </h2>
            <ul className="mt-3 space-y-3">
              {rows.map(r => (
                <li key={`${r.project}/${r.slug}`}>
                  <Link
                    to={reportPath(r)}
                    className="block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 sm:p-5 hover:bg-wf-surface-container-hi transition-colors"
                  >
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="font-wfmono text-xs text-wf-on-surface-variant">{r.date}</span>
                      {r.kind && (
                        <span className="font-wfmono text-[10px] uppercase tracking-widest text-wf-tertiary">
                          {r.kind}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-headline font-bold text-lg leading-snug text-wf-on-surface">
                      {r.title}
                    </div>
                    {r.summary && (
                      <p className="mt-2 text-sm leading-relaxed text-wf-on-surface-variant line-clamp-3">
                        {r.summary}
                      </p>
                    )}
                    {r.authors && r.authors.length > 0 && (
                      <div className="mt-3 font-wfmono text-[11px] text-wf-on-surface-variant">
                        {r.authors.join(' · ')}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </WorkforceLayout>
  );
}
