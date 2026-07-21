// Project reports read routes (GET /projects/{id}/reports[/{slug}]).
//
// Reports are project deliverables (sponsor/management-facing markdown)
// that live in the PROJECT'S OWN storage — the GitHub repo the project
// record points at (`github_owner`/`github_repo`), under `reports/` on the
// default branch — not in the console bundle. The console fetches them at
// request time through these routes; the Lambda authenticates to GitHub
// with the project's own credential (`wf/projects/{id}/github.token`),
// which never reaches the browser (same trust boundary as the credentials
// LIST route: values stay server-side).
//
// Storage contract (in the project repo):
//   reports/manifest.json   — array of ReportManifestEntry (slug/title/date/…)
//   reports/{slug}.md       — one markdown document per report
//
// The repo is the single source of truth for report content (W-2): merge
// to the default branch = publish. No copy is persisted on the workforce
// side.

import { getSecret, type GithubSecret } from "../shared/secrets.js";
import type { ProjectMetaRow } from "../shared/project.js";

const GITHUB_API = "https://api.github.com";

/** Path-segment allowlist for report slugs — blocks traversal ("../"),
 *  query smuggling and nested paths at the route layer. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function isValidReportSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes("..");
}

export interface ReportManifestEntry {
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  kind?: string;
  summary?: string;
  authors?: string[];
  lang?: string;
}

/** Manifest rows the API returns: manifest entry + owning project id. */
export interface ProjectReportView extends ReportManifestEntry {
  project_id: string;
}

/** Newest first; date ties broken by slug for a stable listing. */
export function sortReportEntries(rows: ReportManifestEntry[]): ReportManifestEntry[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/**
 * Keep only rows that carry the required fields with a plausible shape.
 * A malformed manifest row is dropped (and logged) rather than surfaced —
 * one bad row must not 500 the whole listing, but silence would hide it,
 * so the skip is logged for the alarm trail (C-4 compromise mirroring the
 * feed's malformed-row handling).
 */
export function validReportEntries(raw: unknown, projectId: string): ReportManifestEntry[] {
  if (!Array.isArray(raw)) {
    console.error(`[reports] ${projectId}: manifest is not an array — treating as empty`);
    return [];
  }
  const out: ReportManifestEntry[] = [];
  for (const row of raw) {
    const r = row as Partial<ReportManifestEntry>;
    if (
      typeof r.slug === "string" &&
      isValidReportSlug(r.slug) &&
      typeof r.title === "string" &&
      r.title.length > 0 &&
      typeof r.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date)
    ) {
      out.push(row as ReportManifestEntry);
    } else {
      console.error(`[reports] ${projectId}: dropped malformed manifest row: ${JSON.stringify(row).slice(0, 200)}`);
    }
  }
  return out;
}

/** The subset of the project record these routes need. */
export type ReportProject = Pick<ProjectMetaRow, "project_id" | "github_owner" | "github_repo">;

/**
 * Fetch one file from the project repo's default branch via the GitHub
 * contents API, authenticated with the project-scoped token. Returns the
 * raw file body, or null when the file (or repo path) does not exist.
 * Any other GitHub failure throws (W-4: a broken token / rate limit must
 * alarm, not render as "no reports").
 */
async function fetchProjectFile(project: ReportProject, path: string): Promise<string | null> {
  if (!project.github_owner || !project.github_repo) return null;
  const { token } = await getSecret<GithubSecret>(`wf/projects/${project.project_id}/github.token`);
  const url = `${GITHUB_API}/repos/${project.github_owner}/${project.github_repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github.raw+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github contents ${res.status} for ${project.project_id}:${path}: ${body.slice(0, 300)}`);
  }
  return res.text();
}

/**
 * List a project's reports from `reports/manifest.json` in its repo.
 * A missing manifest (or a project with no repo configured) is "no
 * reports yet" — an empty list, mirroring the credentials LIST 404→[]
 * convention — not an error.
 */
export async function listProjectReports(project: ReportProject): Promise<ProjectReportView[]> {
  const raw = await fetchProjectFile(project, "reports/manifest.json");
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A manifest that exists but doesn't parse is a broken publish —
    // fail loud so the deploy alarm catches it instead of the page
    // quietly showing an empty index (C-4).
    throw new Error(`[reports] ${project.project_id}: reports/manifest.json is not valid JSON`);
  }
  return sortReportEntries(validReportEntries(parsed, project.project_id)).map(entry => ({
    ...entry,
    project_id: project.project_id,
  }));
}

/**
 * Fetch one report body (`reports/{slug}.md`). Returns null when absent.
 */
export async function getProjectReportBody(project: ReportProject, slug: string): Promise<string | null> {
  if (!isValidReportSlug(slug)) return null;
  return fetchProjectFile(project, `reports/${slug}.md`);
}
