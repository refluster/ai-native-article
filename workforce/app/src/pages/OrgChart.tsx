// /org/chart — the whole workforce on one screen.
//
// The console's other two reporting views are deliberately narrow: the
// per-agent AgentOrgGraph shows ±2 hops, and /org shows a 1-hop egocentric
// spine. Both answer "who is around this agent?". Neither answers "what
// does the organisation look like?", and the obvious way to answer that —
// one indented tree — is a single column several screens tall at 50+
// agents, which is exactly the shape the operator asked us to stop
// producing.
//
// The layout rule here: **spend width, not height.** The root band sits at
// the top, and every division (a root-child and its subtree) becomes a
// self-contained card that tiles into balanced CSS columns. Column count
// falls out of the viewport width, so a 1440px desktop packs ~5 columns
// and a phone degrades to one. Inside a card the hierarchy is still an
// indented tree with the same rail glyphs AgentOrgGraph uses — the taste
// carries; only the packing changed.
//
// Two controls exist because "fits on one screen" is a property of the
// viewport, not of the data:
//   - DENSITY (compact / detail) trades the mono slug caption and the
//     residence line for row height.
//   - ZOOM scales the chart down AND widens its layout box by the inverse,
//     so shrinking reflows into *more* columns rather than leaving a
//     stripe of empty page on the right. FIT steps the zoom down until the
//     chart clears the viewport bottom (monotonic — it only ever steps
//     down within a pass, so it always terminates).
//
// Query text dims non-matching agents rather than removing them: an org
// chart whose boxes vanish as you type is no longer an org chart.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import { Skeleton } from '../components/Skeleton';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import { useAsync } from '../lib/useAsync';
import {
  buildOrgChart,
  columnCountFor,
  matchesOrgQuery,
  packDivisions,
  type OrgDivision,
  type OrgRow,
  type PackMetrics,
  type RailShape,
} from '../lib/orgTree';
import type { WorkforceAgent } from '../types/agent';

type Density = 'compact' | 'detail';

interface DensitySpec {
  /** Sigil px for the division lead / for a member row. */
  leadSigil: number;
  memberSigil: number;
  /** Width of one indent rail column, px. */
  indent: number;
  /** Narrowest a column may get before we drop one, px. */
  columnWidth: number;
  /** Show the mono `SLUG · Ln` caption + residence on member rows. */
  showCaption: boolean;
  /** Height model for column balancing — approximate, see PackMetrics. */
  metrics: PackMetrics;
}

const DENSITY: Record<Density, DensitySpec> = {
  compact: {
    leadSigil: 30,
    memberSigil: 22,
    indent: 12,
    columnWidth: 236,
    showCaption: false,
    metrics: { leadHeight: 62, rowHeight: 39, listPadding: 12, cardGap: 12, secondaryLineHeight: 14 },
  },
  detail: {
    leadSigil: 40,
    memberSigil: 30,
    indent: 16,
    columnWidth: 300,
    showCaption: true,
    metrics: { leadHeight: 80, rowHeight: 58, listPadding: 12, cardGap: 12, secondaryLineHeight: 14 },
  },
};

/** Gutter between packed columns, px. */
const COLUMN_GAP = 12;

// Zoom ladder, descending. FIT walks it forward one step at a time; the
// floor is the point past which the role lines stop being readable. The
// steps are deliberately fine — a coarse ladder overshoots and leaves a
// band of dead page under a chart that only needed 4% off.
const ZOOMS = [1, 0.96, 0.92, 0.88, 0.84, 0.79, 0.74, 0.69, 0.64, 0.6];

/** Slack under the chart when FIT decides whether it clears the fold.
 *  Covers WorkforceLayout's bottom padding (md:py-10) — without it the
 *  chart clears the fold but the container's own padding does not, and the
 *  page keeps a few pixels of scroll. */
const FIT_BOTTOM_GUTTER = 48;

/** Viewport width at or above which auto-fit is on by default. */
const FIT_MIN_VIEWPORT = 768;

// ── Connector rails ────────────────────────────────────────────────────
// One cell per indent column. Lines overshoot the row box by 2px so the
// rail reads as continuous across the gap between stacked rows — same
// trick (and the same token) as AgentOrgGraph's RailCell.
function RailCell({ shape, width }: { shape: RailShape; width: number }) {
  const line = 'absolute bg-[var(--wf-sigil-border)] left-1/2';
  return (
    <span className="relative shrink-0 self-stretch" style={{ width }} aria-hidden="true">
      {(shape === 'vertical' || shape === 'branch') && (
        <span className={`${line} w-px`} style={{ top: -2, bottom: -2 }} />
      )}
      {shape === 'corner' && (
        <span className={`${line} w-px`} style={{ top: -2, height: 'calc(50% + 2px)' }} />
      )}
      {(shape === 'branch' || shape === 'corner') && (
        <span className={`${line} top-1/2 right-0 h-px`} />
      )}
    </span>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────
function MemberRow({ row, spec, dim }: { row: OrgRow; spec: DensitySpec; dim: boolean }) {
  const a = row.agent;
  return (
    <li role="treeitem" aria-level={row.level + 1} aria-selected={false}>
      <Link
        to={`/agents/${a.slug}`}
        className="group flex items-stretch min-w-0 transition-opacity"
        style={{ opacity: dim ? 0.25 : 1 }}
        title={`${fullName(a)} — ${a.role}`}
      >
        {row.railShapes.map((shape, i) => (
          <RailCell key={i} shape={shape} width={spec.indent} />
        ))}
        <span className="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1 rounded-wf-sm border border-transparent group-hover:border-wf-outline-variant group-hover:bg-wf-surface-container-hi transition-colors">
          <Sigil slug={a.slug} size={spec.memberSigil} />
          <span className="min-w-0 flex-1">
            {spec.showCaption && (
              <span className="block font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant truncate">
                {a.slug.toUpperCase()} · L{a.depth}
              </span>
            )}
            <span className="block text-[12px] font-semibold leading-tight text-wf-on-surface truncate">
              {fullName(a)}
            </span>
            <span className="block text-[10px] leading-tight text-wf-on-surface-variant truncate">
              {a.role}
            </span>
            {spec.showCaption && a.residence && (
              <span className="block font-wfmono text-[9px] text-wf-on-surface-variant truncate">
                {a.residence}
              </span>
            )}
          </span>
        </span>
      </Link>
      {row.alsoReportsTo.length > 0 && (
        // A second reporting line can't be drawn as a rail without the
        // node appearing twice, so it is named instead of drawn.
        <span
          className="block font-wfmono text-[9px] uppercase tracking-[0.12em] text-wf-tertiary truncate"
          style={{ paddingLeft: (row.railShapes.length + 1) * spec.indent }}
        >
          ⇄ also reports to {row.alsoReportsTo.join(', ')}
        </span>
      )}
    </li>
  );
}

function DivisionCard({
  division,
  spec,
  query,
}: {
  division: OrgDivision;
  spec: DensitySpec;
  query: string;
}) {
  const [lead, ...members] = division.rows;
  const leadDim = !matchesOrgQuery(lead.agent, query);
  const hits = division.rows.filter((r) => matchesOrgQuery(r.agent, query)).length;
  const searching = query.trim().length > 0;

  return (
    <article
      className={`mb-3 border rounded-wf-md bg-wf-surface-container-lo ${
        division.orphan ? 'border-wf-tertiary' : 'border-wf-outline-variant'
      }`}
      aria-label={`${fullName(division.lead)} division, ${division.size} agents`}
    >
      <Link
        to={`/agents/${division.lead.slug}`}
        className="group flex items-start gap-2.5 px-2.5 pt-2.5 pb-2 border-b border-wf-outline-variant transition-opacity"
        style={{ opacity: leadDim && searching && hits === 0 ? 0.25 : 1 }}
      >
        <Sigil slug={division.lead.slug} size={spec.leadSigil} />
        <span className="min-w-0 flex-1">
          <span className="block font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant truncate">
            {division.lead.slug.toUpperCase()} · L{division.lead.depth}
            {division.size > 1 ? ` · ${division.size} PPL` : ''}
            {division.orphan ? ' · UNPLACED' : ''}
          </span>
          <span className="block text-[13px] font-bold leading-tight text-wf-on-surface truncate group-hover:text-wf-primary">
            {fullName(division.lead)}
          </span>
          <span className="block text-[10px] leading-tight text-wf-on-surface-variant line-clamp-2">
            {division.lead.role}
          </span>
        </span>
      </Link>

      {members.length > 0 && (
        <ul role="tree" aria-label={`${fullName(division.lead)}'s reports`} className="p-1.5 space-y-0.5">
          {members.map((row) => (
            <MemberRow
              key={row.agent.slug}
              row={row}
              spec={spec}
              dim={searching && !matchesOrgQuery(row.agent, query)}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

/** Divisions packed into explicit, width-filling columns. */
function PackedColumns({
  divisions,
  columns,
  spec,
  query,
}: {
  divisions: OrgDivision[];
  columns: number;
  spec: DensitySpec;
  query: string;
}) {
  const packed = packDivisions(divisions, columns, spec.metrics);
  return (
    <div className="flex items-start" style={{ gap: COLUMN_GAP }}>
      {packed.map((column, i) => (
        // `flex-1 basis-0` makes the columns share the width evenly, so the
        // chart reaches the right edge instead of stopping at N ×
        // columnWidth. `min-w-0` lets the role lines truncate rather than
        // forcing the track wider.
        <div key={i} className="flex-1 basis-0 min-w-0">
          {column.map((d) => (
            <DivisionCard key={d.key} division={d} spec={spec} query={query} />
          ))}
        </div>
      ))}
    </div>
  );
}

function RootCard({ agent, dim }: { agent: WorkforceAgent; dim: boolean }) {
  return (
    <Link
      to={`/agents/${agent.slug}`}
      className="group inline-flex items-center gap-3 border border-wf-tertiary bg-wf-surface-container-hi rounded-wf-md px-4 py-2.5 transition-opacity"
      style={{ opacity: dim ? 0.25 : 1 }}
    >
      <Sigil slug={agent.slug} size={44} />
      <span className="min-w-0">
        <span className="block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {agent.slug.toUpperCase()} · L{agent.depth} · ROOT
        </span>
        <span className="block text-base font-black tracking-tight text-wf-on-surface group-hover:text-wf-primary">
          {fullName(agent)}
        </span>
        <span className="block text-[11px] text-wf-on-surface-variant">{agent.role}</span>
      </span>
    </Link>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function OrgChart() {
  const [density, setDensity] = useState<Density>('compact');
  const [query, setQuery] = useState('');
  const [zoomIdx, setZoomIdx] = useState(0);
  // Auto-fit is a desktop default. On a phone, squeezing 50+ agents under
  // the fold means 7px role lines — there, scrolling a full-size chart is
  // the better trade, and FIT is one tap away if the operator disagrees.
  const [fit, setFit] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= FIT_MIN_VIEWPORT,
  );
  const [innerHeight, setInnerHeight] = useState(0);
  const [outerWidth, setOuterWidth] = useState(0);

  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Workforce — Org chart';
  }, []);

  const roster = useAsync(() => loadWorkforceManifest(), []);
  const spec = DENSITY[density];
  const zoom = ZOOMS[zoomIdx];

  const model = useMemo(
    () => (roster.data ? buildOrgChart(roster.data.agents) : null),
    [roster.data],
  );

  const matchCount = useMemo(() => {
    if (!roster.data || !query.trim()) return null;
    return roster.data.agents.filter((a) => matchesOrgQuery(a, query)).length;
  }, [roster.data, query]);

  // Track the chart's UNSCALED layout height. offsetHeight is unaffected
  // by the transform, so this is a one-way measurement: zoom → layout
  // width → height, never height → zoom directly.
  const measure = useCallback(() => {
    if (innerRef.current) setInnerHeight(innerRef.current.offsetHeight);
    if (outerRef.current) setOuterWidth(outerRef.current.clientWidth);
  }, []);

  useLayoutEffect(() => {
    measure();
    const inner = innerRef.current;
    const outer = outerRef.current;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (inner) ro.observe(inner);
    if (outer) ro.observe(outer);
    return () => ro.disconnect();
  }, [measure, model, density]);

  // The chart's layout box is widened by 1/zoom before being scaled back
  // down, so shrinking buys COLUMNS, not empty margin. Column count is
  // therefore derived from the widened box, not from the viewport.
  const columns = columnCountFor(outerWidth / zoom, spec.columnWidth, COLUMN_GAP);

  // FIT: step the zoom down until the chart clears the fold. Each pass
  // only ever decreases zoomIdx, so it converges on the ladder's floor at
  // worst. Resizing / changing density restarts the pass from 100%.
  useEffect(() => {
    if (!fit) return;
    const el = outerRef.current;
    if (!el || innerHeight === 0) return;
    const available = window.innerHeight - el.getBoundingClientRect().top - FIT_BOTTOM_GUTTER;
    if (available <= 0) return;
    if (innerHeight * zoom > available && zoomIdx < ZOOMS.length - 1) {
      setZoomIdx(zoomIdx + 1);
    }
  }, [fit, innerHeight, zoom, zoomIdx]);

  useEffect(() => {
    if (!fit) return;
    setZoomIdx(0);
  }, [fit, density]);

  useEffect(() => {
    if (!fit) return;
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setZoomIdx(0), 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [fit]);

  const stepZoom = (delta: number) => {
    setFit(false);
    setZoomIdx((i) => Math.min(ZOOMS.length - 1, Math.max(0, i + delta)));
  };

  if (roster.error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load org: {roster.error}</div>
      </WorkforceLayout>
    );
  }

  const chartHeight = innerHeight > 0 ? Math.ceil(innerHeight * zoom) : undefined;

  return (
    <WorkforceLayout>
      <section className="mb-4 sm:mb-5">
        {model ? (
          <Typeplate
            label="ORG"
            value={`WHOLE WORKFORCE · ${model.total} AGENTS`}
            className="mb-2"
          />
        ) : (
          <Skeleton className="h-4 w-52 mb-2" />
        )}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-headline text-2xl sm:text-3xl md:text-4xl font-black tracking-tighter leading-[1.05] text-wf-on-surface">
              The whole org, one screen.
            </h1>
            {model && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                {model.levelCounts.map((n, level) => (
                  <span key={level}>
                    L{level} <span className="text-wf-on-surface font-semibold">{n}</span>
                  </span>
                ))}
                <span>
                  divisions <span className="text-wf-on-surface font-semibold">{model.divisions.length}</span>
                </span>
                <Link to="/org" className="text-wf-primary hover:underline">
                  1-HOP VIEW →
                </Link>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="highlight by slug / role / city"
              aria-label="Highlight agents"
              className="font-wfmono text-[11px] px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full sm:w-60 focus:outline-none focus:border-wf-primary"
            />
            <div className="flex items-center" role="group" aria-label="Row density">
              {(['compact', 'detail'] as Density[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDensity(d)}
                  aria-pressed={density === d}
                  className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 border transition-colors ${
                    density === d
                      ? 'border-wf-tertiary text-wf-tertiary'
                      : 'border-wf-outline-variant text-wf-on-surface-variant hover:text-wf-on-surface'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="flex items-center" role="group" aria-label="Zoom">
              <button
                type="button"
                onClick={() => stepZoom(1)}
                aria-label="Zoom out"
                className="font-wfmono text-[11px] px-2.5 py-1.5 border border-wf-outline-variant text-wf-on-surface-variant hover:text-wf-on-surface"
              >
                −
              </button>
              <span className="font-wfmono text-[10px] tabular-nums px-2 py-1.5 border-y border-wf-outline-variant text-wf-on-surface-variant min-w-[3.25rem] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                aria-label="Zoom in"
                className="font-wfmono text-[11px] px-2.5 py-1.5 border border-wf-outline-variant text-wf-on-surface-variant hover:text-wf-on-surface"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setFit((f) => !f)}
                aria-pressed={fit}
                className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 ml-1 border transition-colors ${
                  fit
                    ? 'border-wf-tertiary text-wf-tertiary'
                    : 'border-wf-outline-variant text-wf-on-surface-variant hover:text-wf-on-surface'
                }`}
              >
                fit
              </button>
            </div>
          </div>
        </div>
        {matchCount !== null && (
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            {matchCount} of {model?.total ?? 0} highlighted
          </p>
        )}
      </section>

      {!model ? (
        <div
          role="status"
          aria-live="polite"
          className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant"
        >
          Loading org…
        </div>
      ) : (
        <div ref={outerRef} className="overflow-hidden" style={{ height: chartHeight }}>
          <div
            ref={innerRef}
            style={{
              width: `${100 / zoom}%`,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            {/* Root band. The stem + rule stand in for per-division
                connectors, which balanced columns make impossible to
                align honestly — the rule says "everything under this line
                reports up through here" without drawing lines that lie. */}
            <section className="text-center">
              <div className="flex flex-wrap justify-center items-stretch gap-3">
                {model.roots.map((r) => (
                  <RootCard key={r.slug} agent={r} dim={!matchesOrgQuery(r, query)} />
                ))}
              </div>
              <div className="relative h-5" aria-hidden>
                <span className="absolute left-1/2 top-0 h-5 w-px bg-[var(--wf-sigil-border)]" />
              </div>
              <div className="h-px w-full bg-[var(--wf-sigil-border)] mb-3" aria-hidden />
            </section>

            {/* Divisions, packed into width-filling columns. Same markup on
                a phone (1 column) and a 4K display — only `columns`
                changes. */}
            <PackedColumns divisions={model.divisions} columns={columns} spec={spec} query={query} />

            {model.orphans.length > 0 && (
              // C-4: a cycle or a detached cluster is a data fault. Show
              // it loudly on the page whose whole job is showing the graph.
              <section className="mt-4 border-t border-wf-tertiary pt-3">
                <Typeplate
                  label="UNPLACED"
                  value={`${model.orphans.reduce((n, d) => n + d.size, 0)} AGENTS UNREACHABLE FROM A ROOT`}
                  className="mb-2 text-wf-tertiary"
                />
                <PackedColumns divisions={model.orphans} columns={columns} spec={spec} query={query} />
              </section>
            )}
          </div>
        </div>
      )}
    </WorkforceLayout>
  );
}
