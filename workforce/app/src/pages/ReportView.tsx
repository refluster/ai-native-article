// Single project-report page: fetches public/reports/{project}/{slug}.md and
// renders it with the same react-markdown stack as SkillProfile, plus
// ```mermaid fences as inline figures (MermaidBlock, ported from the
// newsletter reader). Metadata comes from the manifest; a YAML frontmatter
// block in the .md, if present, is stripped rather than rendered as body.

import { useEffect, useState, type ComponentProps } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import WorkforceLayout from '../components/WorkforceLayout';
import MermaidBlock from '../components/MermaidBlock';
import { splitFrontmatter } from './SkillProfile';
import { extractMermaidSource, fetchProjectReports, fetchReportBody, type ReportMeta } from '../lib/reports';

const markdownComponents: Components = {
  pre({ node: _node, children, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
    const source = extractMermaidSource(children);
    if (source !== null) return <MermaidBlock code={source} />;
    return <pre {...rest}>{children}</pre>;
  },
};

export default function ReportView() {
  const { project, slug } = useParams<{ project: string; slug: string }>();
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!project || !slug) return;
    let cancelled = false;
    setBody(null);
    setError(false);
    fetchReportBody(project, slug)
      .then(text => {
        if (!cancelled) setBody(splitFrontmatter(text).body);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    fetchProjectReports(project)
      .then(rows => {
        if (!cancelled) setMeta(rows.find(r => r.slug === slug) ?? null);
      })
      .catch(() => {
        /* meta is decorative — the body fetch drives the error state */
      });
    return () => {
      cancelled = true;
    };
  }, [project, slug]);

  return (
    <WorkforceLayout>
      <div className="max-w-[820px]">
        <nav className="font-wfmono text-[11px] text-wf-on-surface-variant">
          <Link to="/reports" className="hover:text-wf-on-surface underline">
            Reports
          </Link>
          <span className="mx-1.5">/</span>
          <span>{project}</span>
        </nav>

        {meta && (
          <header className="mt-4 mb-6 border-b border-wf-outline-variant pb-5">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-wfmono text-xs text-wf-on-surface-variant">{meta.date}</span>
              {meta.kind && (
                <span className="font-wfmono text-[10px] uppercase tracking-widest text-wf-tertiary">{meta.kind}</span>
              )}
            </div>
            <h1 className="mt-1 font-headline font-black tracking-tight text-2xl leading-tight text-wf-on-surface">
              {meta.title}
            </h1>
            {meta.authors && meta.authors.length > 0 && (
              <div className="mt-2 font-wfmono text-[11px] text-wf-on-surface-variant">
                {meta.authors.join(' · ')}
              </div>
            )}
          </header>
        )}

        {error && (
          <div className="mt-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 text-sm text-wf-throwing">
            Report not found.
          </div>
        )}
        {!error && body === null && (
          <div className="mt-6 font-wfmono text-xs text-wf-on-surface-variant animate-pulse">Loading report…</div>
        )}
        {!error && body !== null && (
          <article className="skill-md-body" lang={meta?.lang}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {body}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </WorkforceLayout>
  );
}
