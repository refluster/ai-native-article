// Inline editor for a project's descriptive config (ADR-0029).
//
// Before ADR-0029 these four fields were editable only by changing
// `workforce/projects/{id}/project.json` and re-running the seed — a PR
// round-trip for "point this project at a different repo". `PATCH
// /projects/{id}` now accepts them, so the console can offer a form.
//
// A panel rather than a dialog (the pattern ProjectRenameButton uses): four
// related fields edited together read better in place than stacked in a modal,
// and the read-only view IS the panel, so there is no separate display to keep
// in sync.
//
// The API is the validation authority — it re-checks everything below against
// the same constraints `project.schema.json` puts on the seed, validates the
// whole patch before writing any of it, and appends an AUDIT# row. The
// client-side checks here exist to give immediate feedback, never as the gate.

import { useEffect, useMemo, useState } from 'react';
import { patchProjectConfig, type ProjectConfigPatch } from '../lib/projects';
import { loadWorkforceManifest } from '../lib/agents';
import type { ProjectDetail } from '../types/project';
import { SIGV4_IS_CONFIGURED } from '../config/auth';

interface Props {
  project: ProjectDetail;
  /** Parent callback so the page re-renders with the saved values. */
  onSaved: (next: ProjectDetail) => void;
}

/** Split a textarea into trimmed, non-empty lines. */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export default function ProjectConfigEditor({ project, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [agentSlugs, setAgentSlugs] = useState<string[]>([]);

  const [owner, setOwner] = useState(project.owner_agent);
  const [repo, setRepo] = useState(
    project.github_owner && project.github_repo
      ? `${project.github_owner}/${project.github_repo}`
      : '',
  );
  const [docs, setDocs] = useState((project.governance_docs ?? []).join('\n'));
  const [creds, setCreds] = useState((project.credential_types ?? []).join('\n'));

  const sigv4Ready = SIGV4_IS_CONFIGURED;

  // Reset the form whenever the underlying project changes (a save, or a
  // parent refetch) so the inputs never drift from what is stored.
  useEffect(() => {
    setOwner(project.owner_agent);
    setRepo(
      project.github_owner && project.github_repo
        ? `${project.github_owner}/${project.github_repo}`
        : '',
    );
    setDocs((project.governance_docs ?? []).join('\n'));
    setCreds((project.credential_types ?? []).join('\n'));
  }, [project]);

  useEffect(() => {
    if (!editing || agentSlugs.length > 0) return;
    // Owner is a pointer at a registered agent; a free-text field invites the
    // dangling-owner the API rejects. Load the roster for a picker instead.
    loadWorkforceManifest()
      .then((m) => setAgentSlugs(m.agents.map((a) => a.slug).sort()))
      .catch(() => setAgentSlugs([]));
  }, [editing, agentSlugs.length]);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(id);
  }, [success]);

  // `github` is entered as one `owner/repo` string — the API wants both parts
  // or neither, and two inputs make a half-filled pair easy to submit.
  const repoParsed = useMemo(() => {
    const trimmed = repo.trim();
    if (trimmed.length === 0) return { ok: true as const, value: null };
    const match = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/.exec(trimmed);
    if (!match) return { ok: false as const, message: 'repo must read owner/name' };
    return { ok: true as const, value: { owner: match[1]!, repo: match[2]! } };
  }, [repo]);

  async function handleSave() {
    if (pending || !repoParsed.ok) return;
    setPending(true);
    setError(null);

    const patch: ProjectConfigPatch = {
      owner_agent: owner,
      github: repoParsed.value,
      governance_docs: lines(docs),
      credential_types: lines(creds),
    };

    try {
      const updated = await patchProjectConfig(project.project_id, patch);
      onSaved(updated);
      setEditing(false);
      setSuccess('Saved');
    } catch (err) {
      // Left in edit mode with the values intact: the API validates the whole
      // patch before writing any of it, so nothing was applied and the
      // operator can correct the one field the message names.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="flex items-center gap-3 border-b border-wf-outline-variant px-4 py-3">
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          CONFIG
        </span>
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface">
          OWNER · REPO · GOVERNANCE · CREDENTIALS
        </span>
        <div className="ml-auto flex items-center gap-2">
          {success && (
            <span
              role="status"
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-running"
            >
              {success}
            </span>
          )}
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={pending}
                className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface-variant hover:text-wf-on-surface disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending || !repoParsed.ok}
                className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface hover:text-wf-primary hover:border-wf-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? 'SAVING…' : '✓ SAVE'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => sigv4Ready && setEditing(true)}
              disabled={!sigv4Ready}
              title={
                sigv4Ready
                  ? 'Edit this project’s config (writes to the project row; audited)'
                  : 'sigv4 broker not configured — wire VITE_COGNITO_IDENTITY_POOL_ID'
              }
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface hover:text-wf-primary hover:border-wf-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ✎ EDIT
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="m-4 flex items-start gap-3 border border-wf-throwing/40 bg-wf-throwing/10 rounded-wf-sm px-3 py-2 text-wf-throwing"
        >
          <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] break-all">
            API ERROR · {error}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="ml-auto font-wfmono text-[10px] text-wf-throwing hover:text-wf-on-surface"
          >
            ×
          </button>
        </div>
      )}

      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 p-4 text-sm">
          <Field id="project-owner-agent" label="OWNER_AGENT" hint="who is responsible for this project's direction">
            <select
              id="project-owner-agent"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full bg-wf-surface border border-wf-outline-variant rounded-wf-sm px-2 py-1 font-mono text-sm text-wf-on-surface"
            >
              <option value="_operator">_operator</option>
              {agentSlugs.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
              {/* The stored owner may predate the current roster — keep it
                  selectable so opening the form never silently reassigns. */}
              {owner !== '_operator' && !agentSlugs.includes(owner) && (
                <option value={owner}>{owner}</option>
              )}
            </select>
          </Field>

          <Field
            id="project-github-repo"
            label="GITHUB REPO"
            hint="owner/name — the repo this project ships against. Blank clears it."
            error={repoParsed.ok ? undefined : repoParsed.message}
          >
            <input
              id="project-github-repo"
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="refluster/ai-native-article"
              className="w-full bg-wf-surface border border-wf-outline-variant rounded-wf-sm px-2 py-1 font-mono text-sm text-wf-on-surface"
            />
          </Field>

          <Field id="project-governance-docs" label="GOVERNANCE_DOCS" hint="one path per line, relative to the target repo root">
            <textarea
              id="project-governance-docs"
              value={docs}
              onChange={(e) => setDocs(e.target.value)}
              rows={4}
              placeholder={'AGENTS.md\ndocs/governance.md'}
              className="w-full bg-wf-surface border border-wf-outline-variant rounded-wf-sm px-2 py-1 font-mono text-xs text-wf-on-surface"
            />
          </Field>

          <Field
            id="project-credential-types"
            label="CREDENTIAL_TYPES"
            hint="one key per line. Declaring a type does NOT create the secret."
          >
            <textarea
              id="project-credential-types"
              value={creds}
              onChange={(e) => setCreds(e.target.value)}
              rows={4}
              placeholder={'github.token\nnotion.integration_token'}
              className="w-full bg-wf-surface border border-wf-outline-variant rounded-wf-sm px-2 py-1 font-mono text-xs text-wf-on-surface"
            />
          </Field>
        </div>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
          <ReadFact label="OWNER_AGENT" values={[project.owner_agent]} />
          <div>
            <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-0.5">
              GITHUB REPO
            </dt>
            <dd className="text-sm">
              {project.github_owner && project.github_repo ? (
                <a
                  href={`https://github.com/${project.github_owner}/${project.github_repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-wf-primary hover:underline break-all"
                >
                  {project.github_owner}/{project.github_repo}
                </a>
              ) : (
                <span className="font-wfmono text-xs text-wf-on-surface-variant">—</span>
              )}
            </dd>
          </div>
          <ReadFact label="GOVERNANCE_DOCS" values={project.governance_docs ?? []} />
          <ReadFact label="CREDENTIAL_TYPES" values={project.credential_types ?? []} />
        </dl>
      )}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1"
      >
        {label}
      </label>
      {children}
      <p
        className={`mt-1 font-wfmono text-[10px] ${
          error ? 'text-wf-throwing' : 'text-wf-on-surface-variant'
        }`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

function ReadFact({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-0.5">
        {label}
      </dt>
      <dd className="text-sm">
        {values.length === 0 ? (
          <span className="font-wfmono text-xs text-wf-on-surface-variant">—</span>
        ) : (
          <ul className="space-y-0.5">
            {values.map((v) => (
              <li key={v} className="font-mono text-xs text-wf-on-surface break-all">
                {v}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
