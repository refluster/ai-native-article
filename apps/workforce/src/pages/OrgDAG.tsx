// /workforce/org — the reporting graph as an **indented tree**, rendered
// egocentrically: one agent is the focus, and only their immediate
// 2-hop neighbourhood is shown. Clicking any visible node re-centers.
//
// Why an indented tree (not a horizontal DAG)? The previous horizontal
// layout grew unboundedly wide as direct-report counts increased, and
// past a depth of ~3 the columns ran off-screen. An indented vertical
// list is the same layout every file explorer uses for the same reason:
// depth lives on the X axis (cheap, small increments), siblings live on
// the Y axis (free, scrollable). Lateral peers are no longer drawn as
// inter-card lines — they surface in the mobile section and in each
// agent's profile sidebar, which is where the operator actually acts on
// them anyway.
//
// URL params:
//   ?center=<slug>   the focus agent (default: first root, typically maya)
//
// Each visible parent→child pair is drawn as a tree-view L-connector
// (vertical rail from the parent, horizontal stub into the child). The
// rail anchors on the parent's avatar so it visually originates from
// the parent regardless of card width.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import type { WorkforceAgent, WorkforceAgentManifest } from '../types/agent';

interface TreeRow {
  agent: WorkforceAgent;
  indent: number;
  /** Slug of the visible parent we descended from (null for top-level rows). */
  parentSlug: string | null;
  /** Y position of this row's centre line within the canvas. */
  y: number;
  isCenter: boolean;
}

const INDENT_STEP = 36;
const ROW_H = 84;
const ROW_GAP = 12;
const PADDING = 24;
const CARD_W = 420;
const SIGIL_SIZE = 56;
const SIGIL_X = 12;
const TEXT_X = SIGIL_X + SIGIL_SIZE + 12;
const TEXT_PAD_RIGHT = 12;
const RAIL_OFFSET = SIGIL_X + SIGIL_SIZE / 2;
const HOPS = 2;

function pickDefaultCenter(agents: WorkforceAgent[]): string {
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

function buildTree(
  agents: WorkforceAgent[],
  visible: Set<string>,
  centerSlug: string,
): { rows: TreeRow[]; width: number; height: number } {
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  // Top-level rows: visible agents whose parent is NOT visible. Stable
  // sort by (absolute depth, slug) so the topmost ancestor renders first.
  const tops = agents
    .filter((a) => visible.has(a.slug) && !a.reports_to.some((p) => visible.has(p)))
    .sort((a, b) => a.depth - b.depth || a.slug.localeCompare(b.slug));

  const rows: TreeRow[] = [];
  const seen = new Set<string>();

  function dfs(agent: WorkforceAgent, indent: number, parentSlug: string | null) {
    if (seen.has(agent.slug)) return;
    seen.add(agent.slug);
    const y = PADDING + rows.length * (ROW_H + ROW_GAP);
    rows.push({ agent, indent, parentSlug, y, isCenter: agent.slug === centerSlug });
    const children = agent.direct_reports
      .map((s) => bySlug.get(s))
      .filter((c): c is WorkforceAgent => !!c && visible.has(c.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    for (const c of children) dfs(c, indent + 1, agent.slug);
  }
  for (const t of tops) dfs(t, 0, null);

  // Defensive: pick up any visible agent that wasn't reachable via
  // direct_reports from a top (e.g., orphaned by a missing edge).
  for (const a of agents) {
    if (visible.has(a.slug) && !seen.has(a.slug)) {
      const y = PADDING + rows.length * (ROW_H + ROW_GAP);
      rows.push({ agent: a, indent: 0, parentSlug: null, y, isCenter: a.slug === centerSlug });
      seen.add(a.slug);
    }
  }

  const maxIndent = rows.reduce((m, r) => Math.max(m, r.indent), 0);
  const width = PADDING + maxIndent * INDENT_STEP + CARD_W + PADDING;
  const height = PADDING + rows.length * ROW_H + Math.max(0, rows.length - 1) * ROW_GAP + PADDING;
  return { rows, width, height };
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
    const tree = buildTree(manifest.agents, neighbourhood, center);
    const centerAgent = manifest.agents.find((a) => a.slug === center)!;
    return { center, centerAgent, neighbourhood, tree, allAgents: manifest.agents };
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

  const { tree, centerAgent, neighbourhood, allAgents } = view;
  const rowBySlug = new Map(tree.rows.map((r) => [r.agent.slug, r]));

  // Each visible parent → child becomes one L-connector. We anchor the
  // vertical rail at the parent's avatar centre (RAIL_OFFSET from the
  // parent's card x) so the line clearly originates from the parent.
  const edges = tree.rows
    .filter((r) => r.parentSlug)
    .map((child) => {
      const parent = rowBySlug.get(child.parentSlug!);
      if (!parent) return null;
      const parentX = PADDING + parent.indent * INDENT_STEP;
      const childX = PADDING + child.indent * INDENT_STEP;
      const railX = parentX + RAIL_OFFSET;
      const fromY = parent.y + ROW_H; // bottom of parent card
      const toY = child.y + ROW_H / 2; // middle of child card
      const toX = childX; // left edge of child card
      return { child, parent, railX, fromY, toY, toX };
    })
    .filter((e): e is NonNullable<typeof e> => !!e);

  const hiddenCount = allAgents.length - neighbourhood.size;
  const textW = CARD_W - TEXT_X - TEXT_PAD_RIGHT;

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
          <span className="text-wf-tertiary">click any row to re-center</span>
        </div>
      </section>

      {/* DESKTOP: indented tree. */}
      <div className="hidden md:block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-2 overflow-auto">
        <svg
          width={tree.width}
          height={tree.height}
          viewBox={`0 0 ${tree.width} ${tree.height}`}
          className="block"
          style={{ minWidth: tree.width }}
        >
          {edges.map(({ child, parent, railX, fromY, toY, toX }, i) => {
            const dim = hoverSlug && hoverSlug !== parent.agent.slug && hoverSlug !== child.agent.slug;
            return (
              <path
                key={`e-${i}`}
                d={`M ${railX} ${fromY} L ${railX} ${toY} L ${toX} ${toY}`}
                fill="none"
                stroke="var(--wf-sigil-border)"
                strokeWidth={dim ? 1 : 1.5}
                opacity={dim ? 0.4 : 1}
              />
            );
          })}

          {tree.rows.map((r) => {
            const dim = hoverSlug !== null && hoverSlug !== r.agent.slug;
            const x = PADDING + r.indent * INDENT_STEP;
            return (
              <g
                key={r.agent.slug}
                transform={`translate(${x}, ${r.y})`}
                onMouseEnter={() => setHoverSlug(r.agent.slug)}
                onMouseLeave={() => setHoverSlug((c) => (c === r.agent.slug ? null : c))}
                onClick={() => setCenter(r.agent.slug)}
                style={{ cursor: 'pointer', opacity: dim ? 0.5 : 1, transition: 'opacity 120ms' }}
                role="button"
                aria-label={`Re-center on ${r.agent.first_name} ${r.agent.last_name}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCenter(r.agent.slug);
                  }
                }}
              >
                <rect
                  x="0"
                  y="0"
                  width={CARD_W}
                  height={ROW_H}
                  fill={r.isCenter ? 'var(--wf-svg-surface-emphasis, var(--wf-svg-surface))' : 'var(--wf-svg-surface)'}
                  stroke={r.isCenter ? 'var(--wf-svg-tertiary)' : 'var(--wf-sigil-border)'}
                  strokeWidth={r.isCenter ? 2.5 : 1}
                  rx="8"
                />
                <foreignObject x={SIGIL_X} y={(ROW_H - SIGIL_SIZE) / 2} width={SIGIL_SIZE} height={SIGIL_SIZE}>
                  <Sigil slug={r.agent.slug} size={SIGIL_SIZE} />
                </foreignObject>
                <foreignObject x={TEXT_X} y="12" width={textW} height={ROW_H - 24}>
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
                      {r.agent.slug.toUpperCase()} · L{r.agent.depth}{r.isCenter ? ' · CENTER' : ''}
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
                      {r.agent.first_name} {r.agent.last_name}
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
                      {r.agent.role}
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
                      {r.agent.residence}
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
    </div>
  );
}
