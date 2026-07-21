// Project reports: markdown documents committed under public/reports/,
// indexed by public/reports/manifest.json. Unlike posts/skills (which read
// the live agents-api), reports are repo-authored deliverables — the .md in
// git IS the source of truth (no Notion/DDB copy exists), so serving them
// as static assets does not create a second authority (W-2).

import type { ReactNode } from 'react';
import { isValidElement } from 'react';
import { withBasePath } from './paths';

export interface ReportMeta {
  /** Project the report belongs to, e.g. "project-ind". */
  project: string;
  /** Filename stem under public/reports/{project}/, e.g. "2026-07-21-weekly". */
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD) the report covers/was issued. */
  date: string;
  /** Report cadence/kind label, e.g. "weekly". */
  kind?: string;
  /** One-paragraph abstract shown on the index card. */
  summary?: string;
  /** Contributing agent slugs (display only — attribution, not auth). */
  authors?: string[];
  /** BCP-47 language of the body, e.g. "ja". */
  lang?: string;
}

export function reportPath(meta: Pick<ReportMeta, 'project' | 'slug'>): string {
  return `/reports/${meta.project}/${meta.slug}`;
}

export async function fetchReportManifest(): Promise<ReportMeta[]> {
  const res = await fetch(withBasePath('reports/manifest.json'));
  if (!res.ok) throw new Error(`reports manifest: HTTP ${res.status}`);
  const rows = (await res.json()) as ReportMeta[];
  return sortReports(rows);
}

/** Newest first; ties broken by project then slug for a stable index. */
export function sortReports(rows: ReportMeta[]): ReportMeta[] {
  return [...rows].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      a.project.localeCompare(b.project) ||
      a.slug.localeCompare(b.slug),
  );
}

export async function fetchReportBody(project: string, slug: string): Promise<string> {
  const res = await fetch(withBasePath(`reports/${encodeURIComponent(project)}/${encodeURIComponent(slug)}.md`));
  if (!res.ok) throw new Error(`report body: HTTP ${res.status}`);
  return res.text();
}

// Fenced ```mermaid blocks arrive from react-markdown as a <pre> whose only
// child is a <code class="language-mermaid">. Same detection as the
// newsletter reader (newsletter/app/src/pages/Article.tsx).
export function extractMermaidSource(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(child)) return null;
  const { className, children: source } = child.props as {
    className?: string;
    children?: ReactNode;
  };
  if (!/\blanguage-mermaid\b/.test(className ?? '')) return null;
  return String(source ?? '');
}
