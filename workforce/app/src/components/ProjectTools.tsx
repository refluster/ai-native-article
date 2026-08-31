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
import { TOOL_REGISTRY, findTool, missingCredentials } from '../lib/tools';
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

export default function ProjectTools({ projectId, toolId }: Props) {
  // Credentials drive the readiness badge on every card, so they are
  // fetched once here rather than per tool. A failure is not fatal: the
  // tools still render, with readiness unknown rather than wrong.
  const [credentials, setCredentials] = useState<CredentialMetadata[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCredentials(projectId, WORKFORCE_AGENTS_API_BASE)
      .then((rows) => {
        if (!cancelled) setCredentials(rows);
      })
      .catch(() => {
        if (!cancelled) setCredentials(null);
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
  credentials: CredentialMetadata[] | null;
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
  credentials: CredentialMetadata[] | null;
}) {
  const missing = credentials ? missingCredentials(tool, credentials) : [];
  return (
    <Link
      to={projectPath(projectId, 'tools', tool.tool_id)}
      className="block h-full border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-4 hover:border-wf-on-surface transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-wfmono text-xs text-wf-on-surface truncate">
          {tool.display_name}
        </span>
        {missing.length > 0 && (
          <span className="shrink-0 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
            {missing.length} missing
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-wf-on-surface-variant leading-relaxed">{tool.summary}</p>
    </Link>
  );
}

function ToolDetail({
  projectId,
  tool,
  credentials,
}: {
  projectId: string;
  tool: ToolDefinition;
  credentials: CredentialMetadata[] | null;
}) {
  const missing = credentials ? missingCredentials(tool, credentials) : [];
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
        {missing.length > 0 && <MissingCredentials missing={missing} />}
      </div>
    </section>
  );
}

// A tool whose credentials are not provisioned says so here, with the
// remedy named, rather than failing at the API boundary (Epic-025 AC4).
function MissingCredentials({ missing }: { missing: string[] }) {
  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
        Credentials required
      </p>
      <p className="mt-2 text-sm text-wf-on-surface-variant leading-relaxed">
        This tool cannot run until{' '}
        <span className="font-wfmono text-wf-on-surface">{missing.join(', ')}</span>{' '}
        {missing.length === 1 ? 'is' : 'are'} provisioned in this project's credential
        vault, on the Overview tab.
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
