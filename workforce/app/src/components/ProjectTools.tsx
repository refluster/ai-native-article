// The project Tools tab (ADR-0027, Epic-025 Phase 1).
//
// Two views behind one route suffix: the tools index (`/tools`) and one
// tool (`/tools/{toolId}`). Both are driven by the static registry in
// lib/tools.ts, which is deliberately EMPTY in Phase 1 — the surface,
// the routing, and the credential gating ship first so each tool that
// follows is a small PR.
//
// Tools are project-scoped rather than global because the project holds
// both halves of what a run needs: the credentials it consumes and the
// partition its execution row lands in (ADR-0027 §1).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Typeplate from './Typeplate';
import { LoadingRegion, SkeletonText } from './Skeleton';
import { TOOL_REGISTRY, findTool, unprovisionedOnProject } from '../lib/tools';
import { fetchCredentials } from '../lib/credentials';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';
import { projectPath } from '../lib/paths';
import type { ToolDefinition } from '../types/tool';
import type { CredentialMetadata } from '../types/project';

interface Props {
  projectId: string;
  /** Absent on the tools index. */
  toolId?: string;
}

/**
 * The credential LIST is one of three things, and the difference matters:
 * still loading, loaded (so the advisory is meaningful), or unreadable
 * (so no claim may be made either way).
 */
type CredentialState =
  | { status: 'loading' }
  | { status: 'loaded'; rows: CredentialMetadata[] }
  | { status: 'unknown' };

export default function ProjectTools({ projectId, toolId }: Props) {
  // Credentials drive the provisioning advisory on every card, so they
  // are fetched once here rather than per tool. Three states, not two:
  // collapsing a failed fetch to an empty list would render every tool as
  // fully provisioned — the opposite of the truth, and the failure mode
  // an advisory exists to prevent.
  const [credentials, setCredentials] = useState<CredentialState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setCredentials({ status: 'loading' });
    fetchCredentials(projectId, WORKFORCE_AGENTS_API_BASE)
      .then((rows) => {
        if (!cancelled) setCredentials({ status: 'loaded', rows });
      })
      .catch(() => {
        if (!cancelled) setCredentials({ status: 'unknown' });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (toolId) {
    const tool = findTool(toolId);
    if (!tool) return <UnknownTool projectId={projectId} toolId={toolId} />;
    return <ToolDetail projectId={projectId} tool={tool} credentials={credentials} />;
  }

  return <ToolsIndex projectId={projectId} credentials={credentials} />;
}

function ToolsIndex({
  projectId,
  credentials,
}: {
  projectId: string;
  credentials: CredentialState;
}) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate
          label="TOOLS"
          value={
            TOOL_REGISTRY.length > 0
              ? `${TOOL_REGISTRY.length} AVAILABLE · PROJECT-SCOPED`
              : 'NONE REGISTERED YET'
          }
        />
      </div>

      {TOOL_REGISTRY.length === 0 ? (
        <EmptyRegistry />
      ) : (
        <ul className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOL_REGISTRY.map((tool) => (
            <li key={tool.tool_id}>
              <ToolCard projectId={projectId} tool={tool} credentials={credentials} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// An honest empty state: the surface is live, the registry is not yet
// populated, and the reason is a named phase rather than a mystery.
function EmptyRegistry() {
  return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-wf-on-surface">
        No tools are registered on this project yet.
      </p>
      <p className="text-sm text-wf-on-surface-variant leading-relaxed">
        Tools run against this project's credentials and record an execution row on
        its ledger. The five migrating from the luckyhat mini-apps — Problem Finding,
        User Research, Task Process, Business Impact Builder, and Insight Foundry —
        arrive from Epic-025 Phase 2 onward.
      </p>
      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        Surface live · registry empty
      </p>
    </div>
  );
}

function ToolCard({
  projectId,
  tool,
  credentials,
}: {
  projectId: string;
  tool: ToolDefinition;
  credentials: CredentialState;
}) {
  const missing =
    credentials.status === 'loaded' ? unprovisionedOnProject(tool, credentials.rows) : [];
  return (
    <Link
      to={projectPath(projectId, 'tools', tool.tool_id)}
      className="block h-full border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-4 hover:border-wf-on-surface transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-wfmono text-xs text-wf-on-surface truncate">
          {tool.display_name}
        </span>
        <CredentialBadge state={credentials} missing={missing} />
      </div>
      <p className="mt-2 text-sm text-wf-on-surface-variant leading-relaxed">{tool.summary}</p>
    </Link>
  );
}

/**
 * The card's readiness mark. Every state gets its OWN mark, with a noun:
 * an absent badge previously meant both "ready" and "could not check",
 * and a blocking state must never be inferred from silence.
 */
function CredentialBadge({
  state,
  missing,
}: {
  state: CredentialState;
  missing: string[];
}) {
  const cls = 'shrink-0 font-wfmono text-[10px] uppercase tracking-[0.14em]';
  if (state.status === 'loading') {
    return <span className={`${cls} text-wf-on-surface-variant`}>checking credentials…</span>;
  }
  if (state.status === 'unknown') {
    return <span className={`${cls} text-wf-on-surface-variant`}>credentials unknown</span>;
  }
  if (missing.length > 0) {
    return (
      <span className={`${cls} text-wf-tertiary`}>
        {missing.length} {missing.length === 1 ? 'credential' : 'credentials'} not on project
      </span>
    );
  }
  return <span className={`${cls} text-wf-on-surface-variant`}>credentials on project</span>;
}

function ToolDetail({
  projectId,
  tool,
  credentials,
}: {
  projectId: string;
  tool: ToolDefinition;
  credentials: CredentialState;
}) {
  const missing =
    credentials.status === 'loaded' ? unprovisionedOnProject(tool, credentials.rows) : [];
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3">
        <Typeplate label="TOOL" value={tool.tool_id} />
        <Link
          to={projectPath(projectId, 'tools')}
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-on-surface"
        >
          ← All tools
        </Link>
      </div>
      <div className="p-4 space-y-3">
        <h2 className="font-headline text-2xl font-black tracking-tighter text-wf-on-surface">
          {tool.display_name}
        </h2>
        <p className="text-sm text-wf-on-surface-variant leading-relaxed">{tool.summary}</p>
        {credentials.status === 'loading' && (
          <LoadingRegion label="Checking this project's credentials">
            <SkeletonText lines={2} />
          </LoadingRegion>
        )}
        {credentials.status === 'unknown' && <CredentialsUnknown />}
        {credentials.status === 'loaded' && missing.length > 0 && (
          <MissingCredentials projectId={projectId} missing={missing} />
        )}
      </div>
    </section>
  );
}

// An advisory with a remedy, not a verdict (Epic-025 AC4). The wording
// stops short of "cannot run" on purpose: the resolver also tries the
// shared `_default` bag and the legacy path, neither of which the
// project-scoped LIST can see — see unprovisionedOnProject() in lib/tools.ts.
function MissingCredentials({
  projectId,
  missing,
}: {
  projectId: string;
  missing: string[];
}) {
  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
        Not provisioned on this project
      </p>
      <p className="mt-2 text-sm text-wf-on-surface-variant leading-relaxed">
        <span className="font-wfmono text-wf-on-surface">{missing.join(', ')}</span>{' '}
        {missing.length === 1 ? 'is' : 'are'} not in this project's credential vault —
        provision{' '}
        <Link
          to={projectPath(projectId, 'overview')}
          className="text-wf-on-surface underline underline-offset-2 hover:text-wf-primary"
        >
          on the Overview tab
        </Link>
        . A run may still resolve one from the shared organisation default, so this is a
        heads-up rather than a blocker.
      </p>
    </div>
  );
}

// The LIST failed. Saying nothing would render the tool as fully
// provisioned, which is the one thing this panel must never do.
function CredentialsUnknown() {
  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        Credential status unknown
      </p>
      <p className="mt-2 text-sm text-wf-on-surface-variant leading-relaxed">
        This project's credential list could not be read, so this tool's requirements
        could not be checked. The vault on the Overview tab is the source of truth.
      </p>
    </div>
  );
}

function UnknownTool({ projectId, toolId }: { projectId: string; toolId: string }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-6 space-y-3">
      <Typeplate label="TOOL" value="NOT FOUND" />
      <p className="text-sm text-wf-on-surface">
        No tool <span className="font-wfmono">{toolId}</span> is registered on this
        project.
      </p>
      <Link
        to={projectPath(projectId, 'tools')}
        className="inline-block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-on-surface"
      >
        ← All tools
      </Link>
    </section>
  );
}
