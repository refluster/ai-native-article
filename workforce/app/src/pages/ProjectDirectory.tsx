// /workforce/projects — Project Index. Lists all PROJECT#*/META rows from
// the agents-api `/projects` endpoint, with a side panel that documents
// the "how do I create a new project" flow.
//
// Per Epic-010 §10, `POST /projects` is deliberately not exposed: new
// projects come from `workforce/projects/{id}/project.json` + a seed
// step (mirroring Epic-007's "creates via API are deliberately not
// exposed"). The new-project form on this page is therefore a
// declarative generator: the operator fills in the form, the SPA emits
// the `project.json` snippet for them to commit to git. No API mutation.
//
// `self/{slug}` projects are hidden by default per Epic-010 §10; an
// "include self" filter chip surfaces them when needed.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import { fetchProjects, apiConfigured } from '../lib/projects';
import type { ProjectSummary } from '../types/project';

type Filter = 'all' | 'active' | 'archived';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',      label: 'ALL' },
  { id: 'active',   label: 'ACTIVE' },
  { id: 'archived', label: 'ARCHIVED' },
];

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function ProjectDirectory() {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [includeSelf, setIncludeSelf] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Workforce — Projects';
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchProjects({ includeSelf })
      .then((items) => {
        if (cancelled) return;
        setRows(items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [includeSelf]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (filter === 'all' ? true : r.status === filter))
      .filter((r) => {
        if (!q) return true;
        return (
          r.project_id.toLowerCase().includes(q) ||
          r.owner_agent.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Active first, then by last_execution_at desc (recent activity up
        // top), then by created_at desc so brand-new projects don't sink
        // to the bottom just because they have no executions yet.
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        const al = a.last_execution_at ?? '';
        const bl = b.last_execution_at ?? '';
        if (al !== bl) return bl.localeCompare(al);
        return b.created_at.localeCompare(a.created_at);
      });
  }, [rows, filter, query]);

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="PROJECTS" value={`PROJECTS · ${rows?.length ?? '—'} REGISTERED`} className="mb-3" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface">
              The projects.
            </h1>
            <p className="mt-2 max-w-prose text-sm text-wf-on-surface-variant leading-relaxed">
              Every credential and execution hangs off a project. A project is the
              workforce's trust boundary — see{' '}
              <a
                href="https://github.com/refluster/ai-native-article/blob/main/workforce/docs/epics/epic-010-project-trust-boundary.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-wf-primary hover:underline"
              >
                Epic-010
              </a>
              .
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors ${
                  filter === f.id
                    ? 'border-wf-tertiary text-wf-tertiary'
                    : 'border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              onClick={() => setIncludeSelf((v) => !v)}
              className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors ${
                includeSelf
                  ? 'border-wf-tertiary text-wf-tertiary'
                  : 'border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface'
              }`}
              aria-pressed={includeSelf}
            >
              + SELF/*
            </button>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search by id / owner"
              className="font-wfmono text-xs px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full md:w-56 focus:outline-none focus:border-wf-primary"
            />
          </div>
        </div>
      </section>

      {!apiConfigured() && (
        <p className="mb-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          * mocked — wire WORKFORCE_AGENTS_API_BASE for live data
        </p>
      )}
      {error && (
        <p className="mb-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
          agents-api error: {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {rows === null ? (
            <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
              Loading…
            </div>
          ) : (
            <ProjectList items={filtered} />
          )}
        </div>
        <aside className="lg:col-span-1">
          <NewProjectPanel />
        </aside>
      </div>
    </WorkforceLayout>
  );
}

function ProjectList({ items }: { items: ProjectSummary[] }) {
  if (items.length === 0) {
    return (
      <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
        no projects match.
      </div>
    );
  }
  return (
    <div className="border border-wf-outline-variant rounded-wf-md overflow-hidden bg-wf-surface-container-lo">
      <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 border-b border-wf-outline-variant font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        <div className="col-span-5">PROJECT</div>
        <div className="col-span-2">OWNER</div>
        <div className="col-span-2">STATUS</div>
        <div className="col-span-3 text-right">LAST EXEC</div>
      </div>
      <ul className="divide-y divide-wf-outline-variant">
        {items.map((p) => (
          <li key={p.project_id}>
            <Link
              to={`/projects/${encodeURIComponent(p.project_id)}`}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 items-baseline px-4 py-3 hover:bg-wf-surface-container-hi transition-colors"
            >
              <div className="md:col-span-5 min-w-0">
                <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                  PROJECT
                </div>
                <div className="text-sm text-wf-on-surface truncate">
                  {p.name ?? <span className="font-mono">{p.project_id}</span>}
                </div>
                {p.name && (
                  <div className="font-mono text-[10px] text-wf-on-surface-variant truncate">
                    {p.project_id}
                  </div>
                )}
              </div>
              <div className="md:col-span-2 text-sm">
                <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant md:hidden">
                  OWNER
                </div>
                <span className="text-wf-on-surface">{p.owner_agent}</span>
              </div>
              <div className="md:col-span-2">
                <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant md:hidden">
                  STATUS
                </div>
                <StatusChip status={p.status} />
              </div>
              <div className="md:col-span-3 md:text-right font-wfmono text-xs text-wf-on-surface-variant">
                <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant md:hidden mr-2">
                  LAST EXEC
                </span>
                {formatRelative(p.last_execution_at)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusChip({ status }: { status: 'active' | 'archived' }) {
  const tone = status === 'active' ? 'text-wf-running' : 'text-wf-archived';
  return (
    <span className={`font-wfmono text-[10px] uppercase tracking-[0.14em] ${tone}`}>
      ● {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New-project panel.
//
// Per Epic-010 §10 the API has no POST /projects — new projects are
// authored as `workforce/projects/{id}/project.json` and picked up by a
// seed step. This panel makes that flow operable from the SPA: the
// operator fills in the form, the panel renders the `project.json`
// snippet, and a "copy" button puts it on the clipboard ready to paste
// into a PR.
// ---------------------------------------------------------------------------

function NewProjectPanel() {
  const [projectId, setProjectId] = useState('');
  const [owner, setOwner] = useState('_operator');
  // The standard project attribute: the target GitHub repo as `owner/repo`
  // (e.g. `refluster/project-ind`). Non-confidential — it lands as the
  // `github` block in project.json, distinct from the PAT credential stored
  // out-of-band under wf/projects/{id}/github.token. Optional: a project
  // without a repo simply omits the block.
  const [repo, setRepo] = useState('');
  const [copied, setCopied] = useState(false);

  // Parse `owner/repo` into the schema's github block. Validated against the
  // same patterns as project.schema.json (github.owner / github.repo).
  const repoTrimmed = repo.trim();
  const repoParts = repoTrimmed.split('/');
  const repoInvalid =
    repoTrimmed.length === 0
      ? null
      : repoParts.length !== 2 ||
          !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(repoParts[0] ?? '') ||
          !/^[A-Za-z0-9._-]+$/.test(repoParts[1] ?? '')
        ? 'must be owner/repo (e.g. refluster/project-ind)'
        : null;
  const github =
    repoTrimmed.length > 0 && !repoInvalid
      ? { owner: repoParts[0]!, repo: repoParts[1]! }
      : undefined;

  // Validate against the same constraints as asProjectId() in the
  // backend (workforce/lambdas/shared/project.ts): non-empty, no `#`,
  // no `|`. Leading `self/` is reserved for the per-agent personal
  // partitions; operators creating "real" projects should pick a
  // human-meaningful slug.
  const invalid =
    projectId.length === 0
      ? null
      : projectId.includes('#') || projectId.includes('|')
        ? "must not contain '#' or '|'"
        : projectId.startsWith('self/')
          ? 'self/* is reserved — pick a different prefix'
          : null;

  const snippet = projectId
    ? JSON.stringify(
        {
          project_id: projectId,
          owner_agent: owner,
          ...(github ? { github } : {}),
        },
        null,
        2,
      )
    : '';

  async function copy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may not be available in some browser contexts; the
      // textarea below remains selectable as a fallback.
    }
  }

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="NEW PROJECT" value="SEED · NOT POST" />
      </div>
      <div className="p-4 space-y-4">
        <p className="text-sm text-wf-on-surface-variant leading-relaxed">
          Projects are seeded from <code className="font-wfmono text-xs">workforce/projects/{'{id}'}/project.json</code>{' '}
          (per Epic-010 §10 — creates via API are deliberately not exposed). Fill in the form, copy the
          snippet, commit it, and merge — the seed step picks it up on the next deploy.
        </p>

        <div>
          <label className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant block mb-1">
            PROJECT ID
          </label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. workforce-meta"
            className="w-full font-mono text-sm px-3 py-2 border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary"
          />
          {invalid && (
            <p className="mt-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
              {invalid}
            </p>
          )}
        </div>

        <div>
          <label className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant block mb-1">
            OWNER
          </label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="_operator or an agent slug"
            className="w-full font-mono text-sm px-3 py-2 border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary"
          />
        </div>

        <div>
          <label className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant block mb-1">
            GITHUB REPO <span className="text-wf-on-surface-variant/60">· OPTIONAL</span>
          </label>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo · e.g. refluster/project-ind"
            className="w-full font-mono text-sm px-3 py-2 border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary"
          />
          {repoInvalid && (
            <p className="mt-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
              {repoInvalid}
            </p>
          )}
          <p className="mt-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            non-secret · the github.token PAT is stored separately
          </p>
        </div>

        {snippet && !invalid && !repoInvalid && (
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                project.json
              </span>
              <button
                type="button"
                onClick={copy}
                className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
              >
                {copied ? 'COPIED' : 'COPY'}
              </button>
            </div>
            <textarea
              readOnly
              value={snippet}
              rows={5}
              className="w-full font-mono text-xs px-3 py-2 border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface focus:outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              commit as workforce/projects/{projectId}/project.json
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
