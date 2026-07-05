// /workforce/org — the reporting graph as an **egocentric 1-hop chart**.
// One agent is the focus; we show only their immediate neighbourhood:
// the manager(s) they report to, the agent itself, and their direct
// reports. Clicking any visible node re-centers (clicking the focus opens
// its profile).
//
// Why 1-hop (manager → focus → reports) rather than a deeper indented
// tree? Past one hop the connector lines crossed behind cards and the
// "where does this T-junction go?" question got harder, not easier. The
// shallow spine keeps every junction in open space so the structure reads
// at a glance; deeper exploration is one click away via re-centering.
//
// Layout: a single vertical spine runs down the left gutter. Managers and
// the focus sit at indent 0 (the spine passes to their left, surfacing as
// a tick in the gap between stacked cards). Direct reports are indented
// one step to the right, each hanging off the spine by a horizontal stub —
// so every parent→child junction is a clean, fully-visible T.
//
// URL params:
//   ?center=<slug>   the focus agent (default: first root, typically maya)

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import type { WorkforceAgent, WorkforceAgentManifest } from '../types/agent';

type Relation = 'manager' | 'focus' | 'report';

interface Node {
  agent: WorkforceAgent;
  relation: Relation;
  /** Row index (top to bottom). */
  i: number;
  /** Left edge x of this card. */
  x: number;
  /** Top y of this card. */
  y: number;
}

const PADDING = 24;
const ROW_H = 84;
const ROW_GAP = 16;
const CARD_W = 420;
const SIGIL_SIZE = 56;
const SIGIL_X = 16;
const TEXT_X = SIGIL_X + SIGIL_SIZE + 14;
const TEXT_PAD_RIGHT = 16;
const CHILD_INDENT = 64;
// The vertical spine sits under the avatar centre of the indent-0 cards.
// Direct reports indent past it (CHILD_X > SPINE_X) so each horizontal
// stub — and the T-junction it forms — lands in open gutter, never behind
// a card.
const SPINE_X = PADDING + SIGIL_X + SIGIL_SIZE / 2;
const CHILD_X = PADDING + CHILD_INDENT;

const RELATION_LABEL: Record<Relation, string> = {
  manager: 'REPORTS TO',
  focus: 'THIS AGENT',
  report: 'DIRECT REPORT',
};

function pickDefaultCenter(agents: WorkforceAgent[]): string {
  const roots = agents.filter((a) => a.reports_to.length === 0);
  if (roots.length > 0) return [...roots].sort((a, b) => a.slug.localeCompare(b.slug))[0].slug;
  return [...agents].sort((a, b) => a.slug.localeCompare(b.slug))[0].slug;
}

function byDepthThenSlug(a: WorkforceAgent, b: WorkforceAgent) {
  return a.depth - b.depth || a.slug.localeCompare(b.slug);
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
    const agents = manifest.agents;
    const bySlug = new Map(agents.map((a) => [a.slug, a]));
    const defaultCenter = pickDefaultCenter(agents);
    const center =
      requestedCenter && bySlug.has(requestedCenter) ? requestedCenter : defaultCenter;
    const centerAgent = bySlug.get(center)!;

    const resolve = (slugs: string[]) =>
      slugs.map((s) => bySlug.get(s)).filter((a): a is WorkforceAgent => !!a);

    const managers = resolve(centerAgent.reports_to).sort(byDepthThenSlug);
    const reports = resolve(centerAgent.direct_reports).sort((a, b) => a.slug.localeCompare(b.slug));
    const laterals = resolve(centerAgent.lateral).sort((a, b) => a.slug.localeCompare(b.slug));

    // Row order: managers, focus, reports. Managers + focus at indent 0;
    // reports indented one step.
    const ordered: { agent: WorkforceAgent; relation: Relation }[] = [
      ...managers.map((a) => ({ agent: a, relation: 'manager' as const })),
      { agent: centerAgent, relation: 'focus' as const },
      ...reports.map((a) => ({ agent: a, relation: 'report' as const })),
    ];
    const rowY = (i: number) => PADDING + i * (ROW_H + ROW_GAP);
    const nodes: Node[] = ordered.map((r, i) => ({
      agent: r.agent,
      relation: r.relation,
      i,
      x: r.relation === 'report' ? CHILD_X : PADDING,
      y: rowY(i),
    }));

    const focusIndex = managers.length;
    const rowCenter = (i: number) => rowY(i) + ROW_H / 2;

    // One continuous vertical spine + one horizontal stub per direct report.
    const spineTopY = managers.length > 0 ? rowCenter(0) : rowCenter(focusIndex);
    const spineBottomY =
      reports.length > 0 ? rowCenter(focusIndex + reports.length) : rowCenter(focusIndex);
    const hasSpine = managers.length > 0 || reports.length > 0;
    const reportStubsY = reports.map((_, k) => rowCenter(focusIndex + 1 + k));

    const totalRows = ordered.length;
    const rightmostX = reports.length > 0 ? CHILD_X : PADDING;
    const width = rightmostX + CARD_W + PADDING;
    const height = PADDING + totalRows * ROW_H + Math.max(0, totalRows - 1) * ROW_GAP + PADDING;

    const shownCount = managers.length + 1 + reports.length + laterals.length;

    return {
      center,
      centerAgent,
      managers,
      reports,
      laterals,
      nodes,
      spine: { hasSpine, spineTopY, spineBottomY, reportStubsY },
      width,
      height,
      shownCount,
      allAgents: agents,
    };
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

  const { centerAgent, managers, reports, laterals, nodes, spine, width, height, shownCount, allAgents } =
    view;
  const hiddenCount = allAgents.length - shownCount;
  const textW = CARD_W - TEXT_X - TEXT_PAD_RIGHT;

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="ORG" value={`ORG · CENTER ${centerAgent.slug.toUpperCase()}`} className="mb-3" />
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
            showing {shownCount} of {allAgents.length}
            {hiddenCount > 0 ? ` (${hiddenCount} hidden — re-center to explore further)` : ''}
          </span>
          <span className="text-wf-primary">click any row to re-center</span>
        </div>
      </section>

      {/* DESKTOP: egocentric spine chart. */}
      <div className="hidden md:block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-2 overflow-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          style={{ minWidth: width }}
        >
          {/* Connectors drawn first so cards paint over the spine's hidden
              (behind-card) segments; every visible junction is in open gutter. */}
          {spine.hasSpine && (
            <path
              d={`M ${SPINE_X} ${spine.spineTopY} L ${SPINE_X} ${spine.spineBottomY}`}
              fill="none"
              stroke="var(--wf-sigil-border)"
              strokeWidth={1.5}
            />
          )}
          {spine.reportStubsY.map((cy, k) => (
            <path
              key={`stub-${k}`}
              d={`M ${SPINE_X} ${cy} L ${CHILD_X} ${cy}`}
              fill="none"
              stroke="var(--wf-sigil-border)"
              strokeWidth={1.5}
            />
          ))}

          {nodes.map((n) => {
            const isCenter = n.relation === 'focus';
            const dim = hoverSlug !== null && hoverSlug !== n.agent.slug;
            return (
              <g
                key={n.agent.slug}
                transform={`translate(${n.x}, ${n.y})`}
                onMouseEnter={() => setHoverSlug(n.agent.slug)}
                onMouseLeave={() => setHoverSlug((c) => (c === n.agent.slug ? null : c))}
                onClick={() =>
                  isCenter ? navigate(`/agents/${n.agent.slug}`) : setCenter(n.agent.slug)
                }
                style={{ cursor: 'pointer', opacity: dim ? 0.55 : 1, transition: 'opacity 120ms' }}
                role="button"
                aria-label={
                  isCenter
                    ? `Open ${fullName(n.agent)}'s profile`
                    : `Re-center on ${fullName(n.agent)}`
                }
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    isCenter ? navigate(`/agents/${n.agent.slug}`) : setCenter(n.agent.slug);
                  }
                }}
              >
                <rect
                  x="0"
                  y="0"
                  width={CARD_W}
                  height={ROW_H}
                  fill={isCenter ? 'var(--wf-svg-surface-emphasis)' : 'var(--wf-svg-surface)'}
                  stroke={isCenter ? 'var(--wf-svg-primary)' : 'var(--wf-sigil-border)'}
                  strokeWidth={isCenter ? 2.5 : 1}
                  rx="8"
                />
                <foreignObject x={SIGIL_X} y={(ROW_H - SIGIL_SIZE) / 2} width={SIGIL_SIZE} height={SIGIL_SIZE}>
                  <Sigil slug={n.agent.slug} size={SIGIL_SIZE} />
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
                        color: 'var(--wf-svg-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {RELATION_LABEL[n.relation]} · L{n.agent.depth}
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

        {laterals.length > 0 && (
          <div className="mt-3 border-t border-wf-outline-variant pt-3">
            <Typeplate label="LATERAL" value={`${laterals.length}`} className="mb-2" />
            <ul className="flex flex-wrap gap-2">
              {laterals.map((a) => (
                <li key={a.slug}>
                  <button
                    type="button"
                    onClick={() => setCenter(a.slug)}
                    className="flex items-center gap-2 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-sm px-2.5 py-1.5 hover:bg-wf-surface-container-hi transition-colors"
                  >
                    <Sigil slug={a.slug} size={24} />
                    <span className="text-left">
                      <span className="block font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                        {a.slug.toUpperCase()} · L{a.depth}
                      </span>
                      <span className="block text-sm text-wf-on-surface truncate max-w-[180px]">{fullName(a)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* MOBILE: managers / focus / direct reports / lateral, in that order. */}
      <div className="md:hidden space-y-6">
        <NeighbourGroup label="REPORTS TO" agents={managers} onRecenter={setCenter} />
        <section>
          <Typeplate label="THIS AGENT" value={centerAgent.slug.toUpperCase()} className="mb-2" />
          <NeighbourCard agent={centerAgent} isCenter onRecenter={() => navigate(`/agents/${centerAgent.slug}`)} ctaLabel="VIEW PROFILE →" />
        </section>
        <NeighbourGroup label="DIRECT REPORTS" agents={reports} onRecenter={setCenter} />
        <NeighbourGroup label="LATERAL" agents={laterals} onRecenter={setCenter} />
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
          ? 'border-wf-primary bg-wf-surface-container-hi'
          : 'border-wf-outline-variant bg-wf-surface-container-lo hover:bg-wf-surface-container-hi'
      }`}
    >
      <Sigil slug={agent.slug} size={48} />
      <div className="min-w-0 flex-1">
        <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary">
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
