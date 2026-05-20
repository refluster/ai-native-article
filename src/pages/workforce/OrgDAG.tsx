// /workforce/org — the reporting graph as an SVG DAG.
//
// Layout is computed from manifest topology:
//   - tier === 'founder' → row 0 (apex)
//   - tier === 'lead'    → row 1
//   - everyone else      → row 2
// Reports-to edges are drawn as solid vertical lines. Lateral edges are
// drawn as dashed horizontal connectors between same-row nodes.
//
// Five-agent dataset doesn't justify d3/visx; we lay it out by hand
// across a 12-column grid. Mobile collapses to a vertical "manager →
// you → reports" stack so the rendering still makes sense at ~320px.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import WorkforceLayout from '../../components/workforce/WorkforceLayout';
import Typeplate from '../../components/workforce/Typeplate';
import Sigil from '../../components/workforce/Sigil';
import { loadWorkforceManifest, fullName } from '../../lib/workforce-agents';
import type { WorkforceAgent, WorkforceAgentManifest } from '../../types/workforce-agent';

interface LaidOutNode {
  agent: WorkforceAgent;
  row: number;
  col: number; // 0..(width-1)
  x: number;
  y: number;
}

const NODE_W = 200;
const NODE_H = 96;
const COL_GAP = 32;
const ROW_GAP = 96;
const PADDING = 24;

function layoutByTier(agents: WorkforceAgent[]): { nodes: LaidOutNode[]; width: number; height: number } {
  // Bucket agents by tier — founder=0, lead=1, ic=2.
  const rows: WorkforceAgent[][] = [[], [], []];
  for (const a of agents) {
    const r = a.tier === 'founder' ? 0 : a.tier === 'lead' ? 1 : 2;
    rows[r].push(a);
  }
  // Stable sort each row by slug for predictability.
  for (const r of rows) r.sort((a, b) => a.slug.localeCompare(b.slug));

  const widest = Math.max(1, ...rows.map((r) => r.length));
  const innerW = widest * NODE_W + (widest - 1) * COL_GAP;

  const nodes: LaidOutNode[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowW = row.length * NODE_W + (row.length - 1) * COL_GAP;
    const rowOffset = (innerW - rowW) / 2;
    for (let c = 0; c < row.length; c++) {
      const x = PADDING + rowOffset + c * (NODE_W + COL_GAP);
      const y = PADDING + r * (NODE_H + ROW_GAP);
      nodes.push({ agent: row[c], row: r, col: c, x, y });
    }
  }
  return {
    nodes,
    width: innerW + 2 * PADDING,
    height: rows.length * NODE_H + (rows.length - 1) * ROW_GAP + 2 * PADDING,
  };
}

export default function OrgDAG() {
  const navigate = useNavigate();
  const [manifest, setManifest] = useState<WorkforceAgentManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverSlug, setHoverSlug] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Workforce — Org';
    loadWorkforceManifest()
      .then(setManifest)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const laid = useMemo(() => (manifest ? layoutByTier(manifest.agents) : null), [manifest]);

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load org: {error}</div>
      </WorkforceLayout>
    );
  }
  if (!manifest || !laid) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
      </WorkforceLayout>
    );
  }

  const nodeBySlug = new Map(laid.nodes.map((n) => [n.agent.slug, n]));

  // Edges: reports_to is the source of truth; render each edge once.
  const reportEdges = laid.nodes.flatMap((child) =>
    child.agent.reports_to.flatMap((parentSlug) => {
      const parent = nodeBySlug.get(parentSlug);
      if (!parent) return [];
      return [{ from: parent, to: child, kind: 'reports' as const }];
    }),
  );
  // Lateral edges: dedupe — only draw a→b if a.slug < b.slug.
  const lateralEdges = laid.nodes.flatMap((node) =>
    node.agent.lateral.flatMap((peerSlug) => {
      if (node.agent.slug >= peerSlug) return [];
      const peer = nodeBySlug.get(peerSlug);
      if (!peer) return [];
      return [{ from: node, to: peer, kind: 'lateral' as const }];
    }),
  );

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="DECK 03" value="ORG · REPORTING GRAPH" className="mb-3" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface">
            Who reports to whom.
          </h1>
          <Legend />
        </div>
      </section>

      {/* DESKTOP: SVG DAG. Hidden under md to avoid the squeezed layout. */}
      <div className="hidden md:block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-2 overflow-auto">
        <svg
          width={laid.width}
          height={laid.height}
          viewBox={`0 0 ${laid.width} ${laid.height}`}
          className="mx-auto block"
          style={{ minWidth: laid.width }}
        >
          {/* Reports-to edges — vertical line from parent bottom to child top */}
          {reportEdges.map(({ from, to }, i) => {
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            const midY = (y1 + y2) / 2;
            const dim = hoverSlug && hoverSlug !== from.agent.slug && hoverSlug !== to.agent.slug;
            return (
              <path
                key={`r-${i}`}
                d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                fill="none"
                stroke="var(--wf-sigil-border)"
                strokeWidth={dim ? 1 : 1.5}
                opacity={dim ? 0.4 : 1}
              />
            );
          })}

          {/* Lateral edges — dashed horizontal between siblings */}
          {lateralEdges.map(({ from, to }, i) => {
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const dim = hoverSlug && hoverSlug !== from.agent.slug && hoverSlug !== to.agent.slug;
            return (
              <line
                key={`l-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--wf-svg-tertiary)"
                strokeDasharray="4 4"
                strokeWidth={dim ? 1 : 1.5}
                opacity={dim ? 0.35 : 0.8}
              />
            );
          })}

          {/* Nodes — onClick + useNavigate keeps client-side routing while
              sidestepping the namespace quirks of <Link> inside SVG. */}
          {laid.nodes.map((n) => {
            const dim = hoverSlug !== null && hoverSlug !== n.agent.slug;
            const href = `/workforce/agents/${n.agent.slug}`;
            return (
              <g
                key={n.agent.slug}
                transform={`translate(${n.x}, ${n.y})`}
                onMouseEnter={() => setHoverSlug(n.agent.slug)}
                onMouseLeave={() => setHoverSlug((c) => (c === n.agent.slug ? null : c))}
                onClick={() => navigate(href)}
                style={{ cursor: 'pointer', opacity: dim ? 0.45 : 1, transition: 'opacity 120ms' }}
                role="link"
                aria-label={`Open profile for ${n.agent.first_name} ${n.agent.last_name}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(href);
                  }
                }}
              >
                <rect
                  x="0"
                  y="0"
                  width={NODE_W}
                  height={NODE_H}
                  fill="var(--wf-svg-surface)"
                  stroke="var(--wf-sigil-border)"
                  strokeWidth="1"
                  rx="8"
                />
                <foreignObject x="12" y="12" width="56" height="56">
                  <Sigil slug={n.agent.slug} size={56} />
                </foreignObject>
                <text x="80" y="28" className="font-wfmono" style={{ fontSize: 10, fill: 'var(--wf-svg-on-surface-variant)', letterSpacing: 1.4 }}>
                  {n.agent.slug.toUpperCase()} · {n.agent.tier.toUpperCase()}
                </text>
                <text x="80" y="48" style={{ fontSize: 16, fontWeight: 600, fill: 'var(--wf-svg-on-surface)' }}>
                  {n.agent.first_name} {n.agent.last_name}
                </text>
                <text x="80" y="68" style={{ fontSize: 12, fill: 'var(--wf-svg-on-surface-variant)' }}>
                  {n.agent.role}
                </text>
                <text x="80" y="84" className="font-wfmono" style={{ fontSize: 10, fill: 'var(--wf-svg-on-surface-variant)' }}>
                  {n.agent.residence}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* MOBILE: vertical hierarchical list. */}
      <div className="md:hidden space-y-6">
        {[0, 1, 2].map((tier) => {
          const tierAgents = laid.nodes.filter((n) => n.row === tier);
          if (tierAgents.length === 0) return null;
          const label = tier === 0 ? 'FOUNDER' : tier === 1 ? 'LEAD' : 'IC';
          return (
            <section key={tier}>
              <Typeplate label={`TIER · ${label}`} value={`${tierAgents.length}`} className="mb-2" />
              <ul className="space-y-2">
                {tierAgents.map((n) => (
                  <li key={n.agent.slug}>
                    <Link
                      to={`/workforce/agents/${n.agent.slug}`}
                      className="flex items-center gap-3 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-3 hover:bg-wf-surface-container-hi transition-colors"
                    >
                      <Sigil slug={n.agent.slug} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                          {n.agent.slug.toUpperCase()} · {n.agent.tier.toUpperCase()}
                        </div>
                        <div className="font-semibold text-wf-on-surface truncate">{fullName(n.agent)}</div>
                        <div className="text-xs text-wf-on-surface-variant">{n.agent.role}</div>
                        {n.agent.reports_to.length > 0 && (
                          <div className="mt-1 font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                            reports to {n.agent.reports_to.map((s) => s.toUpperCase()).join(', ')}
                          </div>
                        )}
                        {n.agent.lateral.length > 0 && (
                          <div className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-tertiary">
                            lateral · {n.agent.lateral.map((s) => s.toUpperCase()).join(', ')}
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </WorkforceLayout>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
      <span className="flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="0" y1="3" x2="22" y2="3" stroke="var(--wf-sigil-border)" strokeWidth="1.5" />
        </svg>
        reports
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="0" y1="3" x2="22" y2="3" stroke="var(--wf-svg-tertiary)" strokeWidth="1.5" strokeDasharray="4 4" />
        </svg>
        lateral · throwing
      </span>
    </div>
  );
}
