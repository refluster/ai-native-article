// Project reports: sponsor/management-facing markdown deliverables that
// live in each PROJECT'S OWN storage (the GitHub repo on the project
// record, under reports/), not in this bundle. The console reads them at
// runtime through agents-api (GET /projects/{id}/reports[/{slug}]); the
// Lambda authenticates to the repo with the project-scoped github.token
// credential, which never reaches the browser.
//
// Base resolution mirrors lib/agents.ts (ADR-0008 §7): use the build-time
// agents-api base when configured, else fall back to the prod custom
// domain so dev builds still read the live report set. No static mock —
// report content has exactly one home, the project repo (W-2).

import type { ReactNode } from 'react';
import { isValidElement } from 'react';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';

const REPORTS_API_BASE =
  WORKFORCE_AGENTS_API_BASE.length > 0
    ? WORKFORCE_AGENTS_API_BASE
    : 'https://workforce-api.kohuehara.xyz';

export interface ReportMeta {
  /** Project the report belongs to, e.g. "project-ind". */
  project: string;
  /** Filename stem under reports/ in the project repo, e.g. "2026-07-21-weekly". */
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

/** API row shape: manifest entry + owning project id. */
interface ProjectReportRow extends Omit<ReportMeta, 'project'> {
  project_id: string;
}

export function reportPath(meta: Pick<ReportMeta, 'project' | 'slug'>): string {
  return `/reports/${meta.project}/${meta.slug}`;
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

const encode = (id: string): string => encodeURIComponent(id);

/** One project's reports (its repo's reports/manifest.json, via agents-api). */
export async function fetchProjectReports(projectId: string): Promise<ReportMeta[]> {
  const res = await fetch(`${REPORTS_API_BASE}/projects/${encode(projectId)}/reports`);
  if (!res.ok) throw new Error(`reports list: HTTP ${res.status}`);
  const data = (await res.json()) as { items: ProjectReportRow[] };
  return data.items.map(({ project_id, ...rest }) => ({ project: project_id, ...rest }));
}

export interface ReportIndex {
  reports: ReportMeta[];
  /** Projects whose reports request failed (rendered as a visible warning
   *  — one broken project must not blank the whole index, but hiding the
   *  failure would be a silent degrade). */
  failedProjects: string[];
}

/**
 * Every active project's reports, merged newest-first for the /reports
 * index. Fan-out is bounded by the single-operator project count. Each
 * project is isolated: a failing one lands in `failedProjects` (shown as
 * a warning) while the rest still render. The projects list itself
 * failing still throws — with no roster there is no index.
 */
export async function fetchReportManifest(): Promise<ReportIndex> {
  const res = await fetch(`${REPORTS_API_BASE}/projects?status=active`);
  if (!res.ok) throw new Error(`projects list: HTTP ${res.status}`);
  const data = (await res.json()) as { items: Array<{ project_id: string }> };
  const settled = await Promise.allSettled(data.items.map(p => fetchProjectReports(p.project_id)));
  const reports: ReportMeta[] = [];
  const failedProjects: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') reports.push(...s.value);
    else failedProjects.push(data.items[i].project_id);
  });
  return { reports: sortReports(reports), failedProjects };
}

export async function fetchReportBody(project: string, slug: string): Promise<string> {
  const res = await fetch(
    `${REPORTS_API_BASE}/projects/${encode(project)}/reports/${encodeURIComponent(slug)}`,
  );
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
