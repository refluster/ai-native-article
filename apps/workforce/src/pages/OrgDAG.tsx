// /workforce/org — the reporting graph as an SVG DAG, rendered
// **egocentrically**: one agent is the focus, and only their immediate
// 2-hop neighbourhood is shown. Clicking any visible node re-centers.
//
// Why not render the whole tree? RFC-003 §"Behaviour at N = 100+ agents"
// already named this: a single-screen visual of N nodes becomes
// unreadable past ~15. Going egocentric now (at N=12) means the layout
// never needs another redesign as the org grows. At N≤~20 a 2-hop view
// from a root effectively shows the whole org, so we no longer expose a
// 1-hop / full toggle — the 2-hop view is the only mode.
//
// URL params:
//   ?center=<slug>   the focus agent (default: first root, typically maya)
//
// Layout uses absolute `depth` (0 = root) so the Y-axis stays stable
// across re-centerings — clicking from Maya's view onto Elena doesn't
// visually flip the tree upside down. Each edge (reports_to,
// direct_reports, lateral) counts as one hop.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import type { WorkforceAgent, WorkforceAgentManifest } from '../types/agent';

interface LaidOutNode {
  agent: WorkforceAgent;
  row: number;
  col: number;
  x: number;
  y: number;
  isCenter: boolean;
}

// Card dimensions tuned so long role titles like "VP Engineering
// Excellence" fit without overflow. The right-side text column uses a
// foreignObject so CSS handles ellipsis when a title still exceeds the
// available width.
const NODE_W = 264;
const NODE_H = 100;
const COL_GAP = 32;
const ROW_GAP = 96;
const PADDING = 24;
const SIGIL_SIZE = 56;
const TEXT_X = 80;
const TEXT_PAD_RIGHT = 12;
const HOPS = 2;

function pickDefaultCenter(agents: WorkforceAgent[]): string {
  // Roots first, then alphabetical. Single-root orgs land on that root;
  // multi-root forests pick the alphabetically-first root for stability.
  const roots = agents.filter((a) => a.reports_to.length === 0);
  if (roots.length > 0) return [...roots].sort((a, b) => a.slug.localeCompare(b.slug))[0].slug;
  return [...agents].sort((a, b) => a.slug.localeCompare(b.slug))[0].slug;
}

function computeNeighbourhood(
  agents: WorkforceAgent[],
  centerSlug: string,
  hops: number,
): Set<string> {
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const visited = new Set<string>([centerSlug]);
  let frontier: string[] = [centerSlug];
  for (let i = 0; i < hops; i++) {
    const next: string[] = [];
    for (const s of frontier) {
      const a = bySlug.get(s);
      if (!a) continue;
      for (const peer of [...a.reports_to, ...a.direct_reports, ...a.lateral]) {
        if (!visited.has(peer) && bySlug.has(peer)) {
          visited.add(peer);
          next.push(peer);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

function layoutByDepth(agents: WorkforceAgent[], centerSlug: string): {
  nodes: LaidOutNode[];
  width: number;
  height: number;
} {
  // Bucket by absolute depth; only rows that actually contain agents
  // get a slot, but they keep their absolute index so the Y-axis stays
  // stable as the user re-centers.
  const byDepth = new Map<number, WorkforceAgent[]>();
  for (const a of agents) {
    const row = byDepth.get(a.depth) ?? [];
    row.push(a);
    byDepth.set(a.depth, row);
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  for (const d of depths) byDepth.get(d)!.sort((a, b) => a.slug.localeCompare(b.slug));

  const widest = Math.max(1, ...Array.from(byDepth.values()).map((r) => r.length));
  const innerW = widest * NODE_W + (widest - 1) * COL_GAP;

  const nodes: LaidOutNode[] = [];
  for (let i = 0; i < depths.length; i++) {
    const d = depths[i];
    const row = byDepth.get(d)!;
    const rowW = row.length * NODE_W + (row.length - 1) * COL_GAP;
    const rowOffset = (innerW - rowW) / 2;
    for (let c = 0; c < row.length; c++) {
      const x = PADDING + rowOffset + c * (NODE_W + COL_GAP);
      const y = PADDING + i * (NODE_H + ROW_GAP);
      nodes.push({ agent: row[c], row: i, col: c, x, y, isCenter: row[c].slug === centerSlug });
    }
  }
  return {
    nodes,
    width: innerW + 2 * PADDING,
    height: depths.length * NODE_H + Math.max(0, depths.length - 1) * ROW_GAP + 2 * PADDING,
  };
}

export default function OrgDAG() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<WorkforceAgentManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverSlug, setHoverSlug] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Workforce — Org';
    loadWorkforceManifest()
      .then(setManifest)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const requestedCenter = searchParams.get('center');

  const view = useMemo(() => {
    if (!manifest) return null;
    const defaultCenter = pickDefaultCenter(manifest.agents);
    const center =
      requestedCenter && manifest.agents.some((a) => a.slug === requestedCenter)
        ? requestedCenter
        : defaultCenter;
    const neighbourhood = computeNeighbourhood(manifest.agents, center, HOPS);
    const visible = manifest.agents.filter((a) => neighbourhood.has(a.slug));
    const laid = layoutByDepth(visible, center);
    const centerAgent = manifest.agents.find((a) => a.slug === center)!;
    return { center, centerAgent, neighbourhood, laid, allAgents: manifest.agents };
  }, [manifest, requestedCenter]);

  function setCenter(slug: string) {
    const next = new URLSearchParams(searchParams);
    next.set('center', slug);
    setSearchParams(next, { replace: false });
  }

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load org: {error}</div>
      </WorkforceLayout>
    );
  }
  if (!manifest || !view) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
      </WorkforceLayout>
    );
  }

  const { laid, centerAgent, neighbourhood, allAgents } = view;
  const nodeBySlug = new Map(laid.nodes.map((n) => [n.agent.slug, n]));

  const reportEdges = laid.nodes.flatMap((child) =>
    child.agent.reports_to.flatMap((parentSlug) => {
      const parent = nodeBySlug.get(parentSlug);
      if (!parent) return [];
      return [{ from: parent, to: child }];
    }),
  );
  const lateralEdges = laid.nodes.flatMap((node) =>
    node.agent.lateral.flatMap((peerSlug) => {
      if (node.agent.slug >= peerSlug) return [];
      const peer = nodeBySlug.get(peerSlug);
      if (!peer) return [];
      return [{ from: node, to: peer }];
    }),
  );

  const hiddenCount = allAgents.length - neighbourhood.size;
  const textW = NODE_W - TEXT_X - TEXT_PAD_RIGHT;

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="DECK 03" value={`ORG · CENTER ${centerAgent.slug.toUpperCase()}`} className="mb-3" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface">
            {fullName(centerAgent)}'s neighbourhood.
          </h1>
          <Legend />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          <Link to={`/agents/${centerAgent.slug}`} className="text-wf-primary hover:underline">
            VIEW {centerAgent.slug.toUpperCase()} PROFILE →
          </Link>
          <span>
            showing {neighbourhood.size} of {allAgents.length}
            {hiddenCount > 0 ? ` (${hiddenCount} hidden — re-center to explore further)` : ''}
          </span>
          <span className="text-wf-tertiary">click any node to re-center</span>
        </div>
      </section>

      {/* DESKTOP: SVG DAG. */}
      <div className="hidden md:block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-2 overflow-auto">
        <svg
          width={laid.width}
          height={laid.height}
          viewBox={`0 0 ${laid.width} ${laid.height}`}
          className="mx-auto block"
          style={{ minWidth: laid.width }}
        >
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

          {laid.nodes.map((n) => {
            const dim = hoverSlug !== null && hoverSlug !== n.agent.slug;
            return (
              <g
                key={n.agent.slug}
                transform={`translate(${n.x}, ${n.y})`}
                onMouseEnter={() => setHoverSlug(n.agent.slug)}
                onMouseLeave={() => setHoverSlug((c) => (c === n.agent.slug ? null : c))}
                onClick={() => setCenter(n.agent.slug)}
                style={{ cursor: 'pointer', opacity: dim ? 0.45 : 1, transition: 'opacity 120ms' }}
                role="button"
                aria-label={`Re-center on ${n.agent.first_name} ${n.agent.last_name}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCenter(n.agent.slug);
                  }
                }}
              >
                <rect
                  x="0"
                  y="0"
                  width={NODE_W}
                  height={NODE_H}
                  fill={n.isCenter ? 'var(--wf-svg-surface-emphasis, var(--wf-svg-surface))' : 'var(--wf-svg-surface)'}
                  stroke={n.isCenter ? 'var(--wf-svg-tertiary)' : 'var(--wf-sigil-border)'}
                  strokeWidth={n.isCenter ? 2.5 : 1}
                  rx="8"
                />
                <foreignObject x="12" y={(NODE_H - SIGIL_SIZE) / 2} width={SIGIL_SIZE} height={SIGIL_SIZE}>
                  <Sigil slug={n.agent.slug} size={SIGIL_SIZE} />
                </foreignObject>
                <foreignObject x={TEXT_X} y="12" width={textW} height={NODE_H - 24}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      height: '100%',
                      width: '100%',
                      overflow: 'hidden',
                      color: 'var(--wf-svg-on-surface)',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div
                      className="font-wfmono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--wf-svg-on-surface-variant)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {n.agent.slug.toUpperCase()} · L{n.agent.depth}{n.isCenter ? ' · CENTER' : ''}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {n.agent.first_name} {n.agent.last_name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        lineHeight: 1.25,
                        color: 'var(--wf-svg-on-surface-variant)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {n.agent.role}
                    </div>
                    <div
                      className="font-wfmono"
                      style={{
                        fontSize: 10,
                        color: 'var(--wf-svg-on-surface-variant)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {n.agent.residence}
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>

      {/* MOBILE: parents / center / direct reports / lateral, in that order. */}
      <div className="md:hidden space-y-6">
        <NeighbourGroup
          label="REPORTS TO"
          agents={centerAgent.reports_to.map((s) => allAgents.find((a) => a.slug === s)).filter((a): a is WorkforceAgent => !!a)}
          onRecenter={setCenter}
        />
        <section>
          <Typeplate label="CENTER" value={centerAgent.slug.toUpperCase()} className="mb-2" />
          <NeighbourCard agent={centerAgent} isCenter onRecenter={() => navigate(`/agents/${centerAgent.slug}`)} ctaLabel="VIEW PROFILE →" />
        </section>
        <NeighbourGroup
          label="DIRECT REPORTS"
          agents={centerAgent.direct_reports.map((s) => allAgents.find((a) => a.slug === s)).filter((a): a is WorkforceAgent => !!a)}
          onRecenter={setCenter}
        />
        <NeighbourGroup
          label="LATERAL"
          agents={centerAgent.lateral.map((s) => allAgents.find((a) => a.slug === s)).filter((a): a is WorkforceAgent => !!a)}
          onRecenter={setCenter}
        />
      </div>
    </WorkforceLayout>
  );
}

function NeighbourGroup({
  label,
  agents,
  onRecenter,
}: {
  label: string;
  agents: WorkforceAgent[];
  onRecenter: (slug: string) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <section>
      <Typeplate label={label} value={`${agents.length}`} className="mb-2" />
      <ul className="space-y-2">
        {agents.map((a) => (
          <li key={a.slug}>
            <NeighbourCard agent={a} isCenter={false} onRecenter={() => onRecenter(a.slug)} ctaLabel="RECENTER →" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NeighbourCard({
  agent,
  isCenter,
  onRecenter,
  ctaLabel,
}: {
  agent: WorkforceAgent;
  isCenter: boolean;
  onRecenter: () => void;
  ctaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onRecenter}
      className={`w-full flex items-center gap-3 border rounded-wf-md p-3 text-left transition-colors ${
        isCenter
          ? 'border-wf-tertiary bg-wf-surface-container-hi'
          : 'border-wf-outline-variant bg-wf-surface-container-lo hover:bg-wf-surface-container-hi'
      }`}
    >
      <Sigil slug={agent.slug} size={48} />
      <div className="min-w-0 flex-1">
        <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {agent.slug.toUpperCase()} · L{agent.depth}{isCenter ? ' · CENTER' : ''}
        </div>
        <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
        <div className="text-xs text-wf-on-surface-variant truncate">{agent.role}</div>
      </div>
      <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary shrink-0">
        {ctaLabel}
      </span>
    </button>
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
        lateral
      </span>
    </div>
  );
}
