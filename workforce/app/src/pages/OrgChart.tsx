// /org/chart — the whole workforce on one screen.
//
// The console's other reporting view is deliberately narrow: the
// per-agent AgentOrgGraph shows ±2 hops around one agent, answering "who
// is around this agent?". It does not answer "what does the organisation
// look like?", and the obvious way to answer that — one indented tree —
// is a single column several screens tall at 50+ agents, which is exactly
// the shape the operator asked us to stop producing.
//
// This is now the ONLY org-wide view. An egocentric 1-hop spine lived at
// /org and was retired once this page covered the same question better;
// /org redirects here.
//
// The layout rule here: **spend width, not height.** The root band sits at
// the top, and every division (a root-child and its subtree) becomes a
// self-contained card that tiles into explicit, width-filling columns.
// Column count falls out of the viewport width, so a 1920px desktop packs
// ~7 columns and a phone degrades to one. Inside a card the hierarchy is
// still an indented tree with the same rail glyphs AgentOrgGraph uses —
// the taste carries; only the packing changed. The page opts out of
// WorkforceLayout's 1440px container (`contained={false}`) and owns its
// gutters, because a max-width cap would spend the width this page exists
// to spend and force FIT to buy the fold with type size instead.
//
// Two controls exist because "fits on one screen" is a property of the
// viewport, not of the data:
//   - DENSITY (compact / detail) trades the mono slug caption and the
//     residence line for row height.
//   - ZOOM scales the chart down AND widens its layout box by the inverse,
//     so shrinking reflows into *more* columns rather than leaving a
//     stripe of empty page on the right. FIT steps the zoom down until the
//     chart clears the viewport bottom (monotonic — it only ever steps
//     down within a pass, so it always terminates), and stops at
//     FIT_FLOOR_IDX so auto-fit can never shrink the type below ~8px. The
//     manual stepper still reaches the ladder floor for a shape-only
//     glance; the difference is that the page never *chooses* illegible
//     for you.
//
// Query text dims non-matching agents rather than removing them: an org
// chart whose boxes vanish as you type is no longer an org chart.
//
// This view is **structure only** — it reads the roster, never /stats, so
// it says nothing about whether any of these agents are running. The stat
// band says so and points at the crew index, because an undisclosed
// omission on a page titled "the whole workforce" reads as "all healthy".

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import { Skeleton } from '../components/Skeleton';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import { useAsync } from '../lib/useAsync';
import {
  buildOrgChart,
  columnCountFor,
  estimateDivisionHeight,
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
  /** Narrowest a column may get before we drop one, px. */
  columnWidth: number;
  /** Width of one indent rail column, px. */
  indent: number;
  /** Show the mono `SLUG · Ln` caption + residence on member rows. */
  showCaption: boolean;
  /** Height model for column balancing — approximate, see PackMetrics. */
  metrics: PackMetrics;
}

// Avatar sizes are density-INDEPENDENT on purpose. Sigil derives its
// DiceBear URL from the pixel size, so a per-density size meant every
// density toggle re-fetched the whole roster's avatars from a third-party
// host — 54 requests becoming 108 on a control press, 300 becoming 600 as
// the org grows (wf:dario D8). One size per role, one request per agent.
const LEAD_SIGIL = 34;
const MEMBER_SIGIL = 24;

const DENSITY: Record<Density, DensitySpec> = {
  compact: {
    columnWidth: 236,
    indent: 12,
    showCaption: false,
    metrics: { leadHeight: 62, rowHeight: 39, listPadding: 12, cardGap: 12, secondaryLineHeight: 14 },
  },
  detail: {
    columnWidth: 300,
    indent: 16,
    showCaption: true,
    metrics: { leadHeight: 80, rowHeight: 58, listPadding: 12, cardGap: 12, secondaryLineHeight: 14 },
  },
};

/** Gutter between packed columns, px. */
const COLUMN_GAP = 12;

/**
 * The height model the column balancer should use, given the density and
 * whether captions are actually rendered.
 *
 * Exported so the rule is testable without layout: jsdom cannot measure a
 * row, so a test can only check that the right model was *chosen*. A live
 * query forces captions on regardless of density, adding two lines per row
 * — and the balancer was still optimising against compact's shorter model,
 * so the columns went ragged exactly while the operator was searching
 * (wf:aoi A14).
 */
export function packMetricsFor(density: Density, showCaption: boolean): PackMetrics {
  return showCaption ? DENSITY.detail.metrics : DENSITY[density].metrics;
}

// Zoom ladder, descending. The steps are deliberately fine — a coarse
// ladder overshoots and leaves a band of dead page under a chart that only
// needed 4% off.
const ZOOMS = [1, 0.96, 0.92, 0.88, 0.84, 0.79, 0.74, 0.69, 0.64, 0.6];

// Where AUTO-fit stops. The smallest type on a compact row is the 10px
// role line, so 0.84 keeps it at 8.4px; below that the page would be
// choosing illegible on the operator's behalf, which is the same trade the
// sub-768px branch already refuses to make (wf:aoi A2 / wf:freya F4). The
// manual stepper is unbounded by this and still reaches ZOOMS' floor.
const FIT_FLOOR_IDX = 4;

/** Slack under the chart when FIT decides whether it clears the fold.
 *  Covers the page's own bottom padding — without it the chart clears the
 *  fold but the padding does not, and the page keeps a few pixels of
 *  scroll. */
const FIT_BOTTOM_GUTTER = 48;

/** Viewport width at or above which auto-fit is on by default. */
const FIT_MIN_VIEWPORT = 768;

/** Opacity of a row that does not match the highlight query. It composites
 *  to roughly 2.3:1, so these rows are **de-emphasised, not readable** — an
 *  earlier version of this comment claimed "readable", which the contrast
 *  maths does not support. They stay in the accessibility tree and regain
 *  full opacity on focus; they leave the tab order instead (wf:aoi A3). */
const DIM_OPACITY = 0.45;

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
// Plain <ul>/<li>. An earlier revision carried role="tree"/"treeitem",
// which promised an arrow-key roving-focus model this page does not
// implement, started at aria-level 2 (the lead is rendered outside the
// list), and advertised a selection model via aria-selected that does not
// exist. AgentOrgGraph draws the same rails with plain markup; matching it
// is both more honest and less code (wf:aoi A8).
function MemberRow({
  row,
  spec,
  showCaption,
  dim,
}: {
  row: OrgRow;
  spec: DensitySpec;
  showCaption: boolean;
  dim: boolean;
}) {
  const a = row.agent;
  return (
    <li>
      <Link
        to={`/agents/${a.slug}`}
        // A dimmed row leaves the tab order — after a query matching 3 of
        // 54, a keyboard operator should not walk 51 de-emphasised stops —
        // but focus restores full opacity, so a row reached any other way
        // is never an unreadable focus target (wf:freya F9).
        tabIndex={dim ? -1 : undefined}
        className="group flex items-stretch min-w-0 transition-opacity focus:!opacity-100"
        style={{ opacity: dim ? DIM_OPACITY : 1 }}
        title={`${fullName(a)} — ${a.role}`}
      >
        {row.railShapes.map((shape, i) => (
          <RailCell key={i} shape={shape} width={spec.indent} />
        ))}
        <span className="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1 rounded-wf-sm border border-transparent group-hover:border-wf-outline-variant group-hover:bg-wf-surface-container-hi transition-colors">
          <Sigil slug={a.slug} size={MEMBER_SIGIL} />
          <span className="min-w-0 flex-1">
            {showCaption && (
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
            {showCaption && a.residence && (
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
  showCaption,
  query,
}: {
  division: OrgDivision;
  spec: DensitySpec;
  showCaption: boolean;
  query: string;
}) {
  const [lead, ...members] = division.rows;
  const searching = query.trim().length > 0;
  const leadDim = searching && !matchesOrgQuery(lead.agent, query);
  // MEMBERS only. Counting the lead produced "· 1 HITS" for a lead that
  // matched alone — plural grammar on one, restating what the un-dimmed
  // lead already says (wf:aoi A15). The chip's job is "this card contains
  // matches you cannot see from the header".
  const hits = searching
    ? members.filter((r) => matchesOrgQuery(r.agent, query)).length
    : 0;

  return (
    <article
      className={`mb-3 border rounded-wf-md bg-wf-surface-container-lo ${
        division.orphan ? 'border-wf-tertiary' : 'border-wf-outline-variant'
      }`}
      aria-label={`${fullName(division.lead)} division, ${division.size} agents`}
    >
      {/* The HITS chip sits OUTSIDE the link that dims. Inside it, the one
          case the chip exists for — lead does not match, some reports do —
          rendered it at DIM_OPACITY, suppressing the signal exactly when it
          carried information (wf:aoi A13). Row opacity answers "does this
          agent match"; the card answers "does this division contain one". */}
      <div className="relative border-b border-wf-outline-variant">
        {hits > 0 && (
          <span className="absolute top-2 right-2 z-10 font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-tertiary">
            {hits} HIT{hits === 1 ? '' : 'S'}
          </span>
        )}
        <Link
          to={`/agents/${division.lead.slug}`}
          // Dimmed by the lead's OWN match state, like every other row. It
          // used to stay lit whenever any report matched, so one opacity
          // meant "matched" on member rows and "contains a match" on lead
          // rows — and the count of lit boxes disagreed with the readout
          // above the chart (wf:aoi A4 / wf:freya F2).
          tabIndex={leadDim ? -1 : undefined}
          className="group flex items-start gap-2.5 px-2.5 pt-2.5 pb-2 transition-opacity focus:!opacity-100"
          style={{ opacity: leadDim ? DIM_OPACITY : 1 }}
        >
          <Sigil slug={division.lead.slug} size={LEAD_SIGIL} />
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
      </div>

      {members.length > 0 && (
        <ul aria-label={`${fullName(division.lead)}'s reports`} className="p-1.5 space-y-0.5">
          {members.map((row) => (
            <MemberRow
              key={row.agent.slug}
              row={row}
              spec={spec}
              showCaption={showCaption}
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
  metrics,
  showCaption,
  query,
}: {
  divisions: OrgDivision[];
  columns: number;
  spec: DensitySpec;
  metrics: PackMetrics;
  showCaption: boolean;
  query: string;
}) {
  // Memoised on the divisions, the column count and the effective height
  // model — never on the query text itself, so it does not re-run per
  // keystroke (wf:dario D7). `metrics` does flip when a query turns the
  // captions on, which is the point: the balancer must model the rows that
  // are actually rendered. `packDivisions` clamps the column count to the
  // number of cards itself, so a near-empty section (UNPLACED) fills the
  // row instead of rendering as a sliver.
  const packed = useMemo(
    () => packDivisions(divisions, columns, metrics),
    [divisions, columns, metrics],
  );
  return (
    <div className="flex items-start" style={{ gap: COLUMN_GAP }}>
      {packed.map((column, i) => (
        // `flex-1 basis-0` makes the columns share the width evenly, so the
        // chart reaches the right edge instead of stopping at N ×
        // columnWidth. `min-w-0` lets the role lines truncate rather than
        // forcing the track wider.
        <div key={i} className="flex-1 basis-0 min-w-0">
          {column.map((d) => (
            <DivisionCard
              key={d.key}
              division={d}
              spec={spec}
              showCaption={showCaption}
              query={query}
            />
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
      tabIndex={dim ? -1 : undefined}
      className="group inline-flex items-center gap-3 border border-wf-tertiary bg-wf-surface-container-hi rounded-wf-md px-4 py-2.5 transition-opacity focus:!opacity-100"
      style={{ opacity: dim ? DIM_OPACITY : 1 }}
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

const CHIP_ON = 'border-wf-tertiary text-wf-tertiary';
const CHIP_OFF =
  'border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface';

// ── Page ───────────────────────────────────────────────────────────────
export default function OrgChart() {
  // Query + density live in the URL: this
  // page's whole purpose is to be configured until it shows you something,
  // and that configuration should survive a click into an agent profile
  // and Back, and be pasteable (wf:freya F6). Zoom/fit are viewport-derived
  // and stay local.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const density: Density = searchParams.get('density') === 'detail' ? 'detail' : 'compact';

  const setParam = useCallback(
    (key: string, value: string, fallback: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === fallback) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [zoomIdx, setZoomIdx] = useState(0);
  // Auto-fit is a desktop default. On a phone, squeezing 50+ agents under
  // the fold means unreadable role lines — there, scrolling a full-size
  // chart is the better trade, and FIT is one tap away if the operator
  // disagrees.
  const [fit, setFit] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= FIT_MIN_VIEWPORT,
  );
  const [innerHeight, setInnerHeight] = useState(0);
  const [outerWidth, setOuterWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Workforce — Org chart';
  }, []);

  const roster = useAsync(() => loadWorkforceManifest(), []);
  const spec = DENSITY[density];
  const zoom = ZOOMS[zoomIdx];
  const searching = query.trim().length > 0;
  // The caption carries slug and residence — two of the three fields the
  // query matches. Suppressing them in compact density meant typing "oslo"
  // lit up rows with no visible reason, so a highlight forces them on
  // regardless of density (wf:aoi A5 / wf:freya F3).
  const showCaption = spec.showCaption || searching;
  // The height model follows the captions that are actually rendered, not
  // the density that nominally requested them — see packMetricsFor.
  const metrics = packMetricsFor(density, showCaption);

  const model = useMemo(
    () => (roster.data ? buildOrgChart(roster.data.agents) : null),
    [roster.data],
  );

  const matchCount = useMemo(() => {
    if (!roster.data || !searching) return null;
    return roster.data.agents.filter((a) => matchesOrgQuery(a, query)).length;
  }, [roster.data, query, searching]);

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
    // `showCaption` sits here for the same reason `density` does: both
    // change every row's height, so the measurement is stale until it
    // re-runs. The ResizeObserver would catch it in a browser; this keeps
    // the two paths honest and makes the behaviour observable in a test.
  }, [measure, model, density, showCaption]);

  // The chart's layout box is widened by 1/zoom before being scaled back
  // down, so shrinking buys COLUMNS, not empty margin. Column count is
  // therefore derived from the widened box, not from the viewport.
  const columns = columnCountFor(outerWidth / zoom, spec.columnWidth, COLUMN_GAP);

  /** Space between the top of the chart and the fold, measured from the
   *  DOCUMENT, not the viewport. `getBoundingClientRect().top` is
   *  viewport-relative and this page scrolls the document, so once the
   *  operator had scrolled, `top` went negative, `available` inflated by
   *  exactly the scroll offset, and FIT concluded an overflowing chart fit
   *  (wf:dario D1). The property being asserted is "the page does not
   *  scroll from the top", so the measurement has to be from the top. */
  const availableHeight = useCallback((el: HTMLElement) => {
    const docTop = el.getBoundingClientRect().top + window.scrollY;
    return window.innerHeight - docTop - FIT_BOTTOM_GUTTER;
  }, []);

  // FIT: step the zoom down until the chart clears the fold. Each pass only
  // ever decreases zoomIdx and stops at FIT_FLOOR_IDX, so it converges on
  // that floor at worst. Resizing / changing density restarts the pass.
  useEffect(() => {
    if (!fit) return;
    const el = outerRef.current;
    if (!el || innerHeight === 0) return;
    const available = availableHeight(el);
    // Clear the flag rather than freezing it at its last value — a viewport
    // short enough to hit this branch would otherwise leave a stale
    // at-floor message on screen (wf:dario D13).
    if (available <= 0) {
      setOverflowing(false);
      return;
    }
    const over = innerHeight * zoom > available;
    setOverflowing(over);
    if (over && zoomIdx < FIT_FLOOR_IDX) setZoomIdx(zoomIdx + 1);
  }, [fit, innerHeight, zoom, zoomIdx, availableHeight]);

  // `searching` belongs here alongside `density` (wf:aoi A14 / wf:freya F10
  // / wf:dario D9): a live query forces the captions on, which grows every
  // row. Without it the FIT descent was a one-way ratchet — type a query,
  // the chart shrinks to the floor; clear it, and it stays there
  // permanently with dead page beneath it.
  useEffect(() => {
    if (!fit) return;
    setZoomIdx(0);
  }, [fit, density, searching]);

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
    const next = Math.min(ZOOMS.length - 1, Math.max(0, zoomIdx + delta));
    // A press that would clamp is a no-op, and a no-op must not silently
    // drop the operator out of FIT mode (wf:aoi A6).
    if (next === zoomIdx) return;
    setFit(false);
    setZoomIdx(next);
  };

  if (roster.error) {
    // Same gutters as the success branch — the failure state should not
    // sit in a differently-inset container (noted by wf:aoi alongside A1).
    return (
      <WorkforceLayout contained={false}>
        <div className="px-3 sm:px-6 md:px-8 py-5 sm:py-8 md:py-10 font-wfmono text-sm text-wf-tertiary">
          Could not load org: {roster.error}
        </div>
      </WorkforceLayout>
    );
  }

  const chartHeight = innerHeight > 0 ? Math.ceil(innerHeight * zoom) : undefined;
  const unplaced = model ? model.orphans.reduce((n, d) => n + d.size, 0) : 0;
  // When FIT has spent its budget and the chart still overflows, name the
  // constraint: a column can never be shorter than its tallest card, so the
  // tallest card is the bound (wf:freya F5).
  //
  // By HEIGHT, not row count, and across orphans too (wf:dario D10). Taking
  // `divisions[0]` named the card with the most rows, which is a different
  // card once secondary-reporting lines are in play — and on an all-orphan
  // roster it was `undefined`, so the explanation vanished at exactly the
  // moment the page was most broken.
  const largest = model
    ? [...model.divisions, ...model.orphans].reduce<OrgDivision | undefined>(
        (tallest, d) =>
          !tallest || estimateDivisionHeight(d, metrics) > estimateDivisionHeight(tallest, metrics)
            ? d
            : tallest,
        undefined,
      )
    : undefined;
  const atFitFloor = fit && overflowing && zoomIdx >= FIT_FLOOR_IDX;

  return (
    <WorkforceLayout contained={false}>
      {/* Own gutters, no max-width — see the header comment (wf:aoi A1). */}
      <div className="px-3 sm:px-6 md:px-8 py-5 sm:py-8 md:py-10">
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
                <div
                  aria-label="Org summary"
                  className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant"
                >
                  {model.levelCounts.map((n, level) => (
                    <span key={level}>
                      L{level} <span className="text-wf-on-surface font-semibold">{n}</span>
                    </span>
                  ))}
                  <span>
                    divisions{' '}
                    <span className="text-wf-on-surface font-semibold">{model.divisions.length}</span>
                  </span>
                  {unplaced > 0 && (
                    // The fault lives at the bottom of a chart that may be
                    // scaled down; the operator's eye is on this band
                    // (wf:freya F8).
                    <span className="text-wf-tertiary">
                      unplaced <span className="font-semibold">{unplaced}</span>
                    </span>
                  )}
                  <span>
                    structure only ·{' '}
                    <Link to="/agents" className="text-wf-primary hover:underline">
                      run health on the crew index →
                    </Link>
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setParam('q', e.target.value, '')}
                placeholder="highlight by slug / role / city"
                aria-label="Highlight agents"
                className="font-wfmono text-[11px] px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full sm:w-60 focus:outline-none focus:border-wf-primary"
              />
              <div className="flex items-center" role="group" aria-label="Row density">
                {(['compact', 'detail'] as Density[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setParam('density', d, 'compact')}
                    aria-pressed={density === d}
                    className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 border transition-colors ${
                      density === d ? CHIP_ON : CHIP_OFF
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
                  disabled={zoomIdx === ZOOMS.length - 1}
                  aria-label="Zoom out"
                  className="font-wfmono text-[11px] px-2.5 py-1.5 border border-wf-outline-variant text-wf-on-surface-variant hover:text-wf-on-surface disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  −
                </button>
                <span className="font-wfmono text-[10px] tabular-nums px-2 py-1.5 border-y border-wf-outline-variant text-wf-on-surface-variant min-w-[3.25rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => stepZoom(-1)}
                  disabled={zoomIdx === 0}
                  aria-label="Zoom in"
                  className="font-wfmono text-[11px] px-2.5 py-1.5 border border-wf-outline-variant text-wf-on-surface-variant hover:text-wf-on-surface disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setFit((f) => !f)}
                  aria-pressed={fit}
                  className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 ml-1 border transition-colors ${
                    fit ? CHIP_ON : CHIP_OFF
                  }`}
                >
                  fit
                </button>
              </div>
            </div>
          </div>
          <div
            role="status"
            aria-live="polite"
            className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant empty:mt-0"
          >
            {matchCount !== null && `${matchCount} of ${model?.total ?? 0} highlighted`}
            {atFitFloor && largest && (
              <span className="text-wf-tertiary">
                {matchCount !== null ? ' · ' : ''}
                at readable-zoom floor · largest division {largest.key} is {largest.size} rows
              </span>
            )}
          </div>
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
                  connectors, which packed columns make impossible to align
                  honestly — the rule says "everything under this line
                  reports up through here" without drawing lines that lie.
                  With more than one root the centred stem would descend
                  from the gap BETWEEN cards and connect nothing, which is
                  the exact class of line this comment disclaims, so it is
                  dropped and the rule carries the reading alone
                  (wf:aoi A11). */}
              <section className="text-center">
                <div className="flex flex-wrap justify-center items-stretch gap-3">
                  {model.roots.map((r) => (
                    <RootCard key={r.slug} agent={r} dim={searching && !matchesOrgQuery(r, query)} />
                  ))}
                </div>
                {model.roots.length === 1 ? (
                  <div className="relative h-5" aria-hidden>
                    <span className="absolute left-1/2 top-0 h-5 w-px bg-[var(--wf-sigil-border)]" />
                  </div>
                ) : (
                  <div className="h-5" aria-hidden />
                )}
                <div className="h-px w-full bg-[var(--wf-sigil-border)] mb-3" aria-hidden />
              </section>

              {/* Divisions, packed into width-filling columns. Same markup
                  on a phone (1 column) and a 4K display — only `columns`
                  changes. */}
              <PackedColumns
                divisions={model.divisions}
                columns={columns}
                spec={spec}
                metrics={metrics}
                showCaption={showCaption}
                query={query}
              />

              {model.orphans.length > 0 && (
                // C-4: a cycle or a detached cluster is a data fault. Show
                // it loudly on the page whose whole job is showing the graph.
                <section className="mt-4 border-t border-wf-tertiary pt-3">
                  <Typeplate
                    label="UNPLACED"
                    value={`${unplaced} AGENTS UNREACHABLE FROM A ROOT`}
                    className="mb-2 text-wf-tertiary"
                  />
                  <PackedColumns
                    divisions={model.orphans}
                    columns={columns}
                    spec={spec}
                    metrics={metrics}
                    showCaption={showCaption}
                    query={query}
                  />
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </WorkforceLayout>
  );
}
