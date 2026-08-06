// Per-agent indented org tree — the agent's 2-level reporting window
// (2 ancestors up + 2 descendants down) rendered as a clickable
// indented list. Replaces the older ReportingCard which only listed
// slugs in flat groups.
//
// Why 2-up + 2-down? Operator constraint — anything wider becomes
// noise on a single agent's page, and lateral peers already surface
// in the agent's profile data and in the whole-org chart at /org/chart.
//
// Clicking any row navigates to that agent's profile. The focused agent
// is shown in the tree too, in its correct hierarchical slot, marked
// CENTER.

import { Link } from 'react-router-dom';
import Sigil from './Sigil';
import Typeplate from './Typeplate';
import { fullName } from '../lib/agents';
import type { WorkforceAgent } from '../types/agent';

interface Props {
  agent: WorkforceAgent;
  /** Full roster — used to resolve slug references. */
  roster: WorkforceAgent[];
}

const UP_LIMIT = 2;
const DOWN_LIMIT = 2;
const INDENT_PX = 20;

type RailShape = 'vertical' | 'empty' | 'branch' | 'corner';

interface Row {
  agent: WorkforceAgent;
  indent: number;
  isFocus: boolean;
  // One entry per indent column. Last entry is the L-corner/branch at this
  // row; earlier entries continue (or skip) the ancestor rails passing through.
  railShapes: RailShape[];
}

function computeWindow(
  focusSlug: string,
  roster: WorkforceAgent[],
  upLimit: number,
  downLimit: number,
): Set<string> {
  const bySlug = new Map(roster.map((a) => [a.slug, a]));
  const visited = new Set<string>([focusSlug]);

  // Walk upward through reports_to.
  let frontier: string[] = [focusSlug];
  for (let i = 0; i < upLimit; i++) {
    const next: string[] = [];
    for (const s of frontier) {
      const a = bySlug.get(s);
      if (!a) continue;
      for (const p of a.reports_to) {
        if (!visited.has(p) && bySlug.has(p)) {
          visited.add(p);
          next.push(p);
        }
      }
    }
    frontier = next;
  }

  // Walk downward through direct_reports.
  frontier = [focusSlug];
  for (let i = 0; i < downLimit; i++) {
    const next: string[] = [];
    for (const s of frontier) {
      const a = bySlug.get(s);
      if (!a) continue;
      for (const c of a.direct_reports) {
        if (!visited.has(c) && bySlug.has(c)) {
          visited.add(c);
          next.push(c);
        }
      }
    }
    frontier = next;
  }

  return visited;
}

function buildRows(
  focusSlug: string,
  roster: WorkforceAgent[],
  visible: Set<string>,
): Row[] {
  const bySlug = new Map(roster.map((a) => [a.slug, a]));
  // Top-level rows in the window = visible agents whose parent is not visible.
  const tops = roster
    .filter((a) => visible.has(a.slug) && !a.reports_to.some((p) => visible.has(p)))
    .sort((a, b) => a.depth - b.depth || a.slug.localeCompare(b.slug));

  const rows: Row[] = [];
  const seen = new Set<string>();

  // siblingFlags[j] = does the ancestor on this row's path at depth j+1 have a
  // younger sibling? Last entry (j = depth-1) reflects this row itself.
  function dfs(a: WorkforceAgent, siblingFlags: boolean[]) {
    if (seen.has(a.slug)) return;
    seen.add(a.slug);
    const indent = siblingFlags.length;
    const railShapes: RailShape[] = [];
    for (let j = 0; j < indent - 1; j++) {
      railShapes.push(siblingFlags[j] ? 'vertical' : 'empty');
    }
    if (indent > 0) {
      railShapes.push(siblingFlags[indent - 1] ? 'branch' : 'corner');
    }
    rows.push({ agent: a, indent, isFocus: a.slug === focusSlug, railShapes });
    const children = a.direct_reports
      .map((s) => bySlug.get(s))
      .filter((c): c is WorkforceAgent => !!c && visible.has(c.slug))
      .sort((x, y) => x.slug.localeCompare(y.slug));
    for (let i = 0; i < children.length; i++) {
      const isLast = i === children.length - 1;
      dfs(children[i], [...siblingFlags, !isLast]);
    }
  }
  for (const t of tops) dfs(t, []);

  // Defensive: any visible agent not reachable via direct_reports.
  for (const a of roster) {
    if (visible.has(a.slug) && !seen.has(a.slug)) {
      rows.push({ agent: a, indent: 0, isFocus: a.slug === focusSlug, railShapes: [] });
      seen.add(a.slug);
    }
  }
  return rows;
}

function RailCell({ shape }: { shape: RailShape }) {
  // Lines overshoot the row's top/bottom by 2px to bridge the space-y-0.5 gap
  // between adjacent TreeRows so the rail reads as continuous.
  const line = 'absolute bg-[var(--wf-sigil-border)] left-1/2';
  return (
    <span
      className="relative shrink-0 self-stretch"
      style={{ width: INDENT_PX }}
      aria-hidden="true"
    >
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

function TreeRow({ row }: { row: Row }) {
  const cardBase =
    'flex-1 flex items-center gap-2.5 px-2 py-2 rounded-wf-sm transition-colors min-w-0';
  const focusClass = row.isFocus
    ? 'border border-wf-tertiary bg-wf-surface-container-hi'
    : 'border border-transparent group-hover:bg-wf-surface-container-hi';
  return (
    <Link to={`/agents/${row.agent.slug}`} className="group flex items-stretch min-w-0">
      {row.railShapes.map((shape, i) => (
        <RailCell key={i} shape={shape} />
      ))}
      <div className={`${cardBase} ${focusClass}`}>
        <Sigil slug={row.agent.slug} size={32} />
        <div className="min-w-0 flex-1">
          <div className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
            {row.agent.slug.toUpperCase()} · L{row.agent.depth}{row.isFocus ? ' · CENTER' : ''}
          </div>
          <div className="text-sm font-semibold text-wf-on-surface truncate">{fullName(row.agent)}</div>
          <div className="text-xs text-wf-on-surface-variant truncate">{row.agent.role}</div>
        </div>
      </div>
    </Link>
  );
}

export default function AgentOrgGraph({ agent, roster }: Props) {
  const visible = computeWindow(agent.slug, roster, UP_LIMIT, DOWN_LIMIT);
  const rows = buildRows(agent.slug, roster, visible);
  const laterals = agent.lateral
    .map((s) => roster.find((r) => r.slug === s))
    .filter((a): a is WorkforceAgent => !!a);

  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="ORG" value={`±${UP_LIMIT} FROM L${agent.depth}`} />
      </div>
      <div className="p-2 space-y-0.5">
        {rows.length === 0 && (
          <div className="font-wfmono text-xs text-wf-on-surface-variant px-2 py-2">
            no reporting edges recorded.
          </div>
        )}
        {rows.map((r) => (
          <TreeRow key={r.agent.slug} row={r} />
        ))}
      </div>
      {laterals.length > 0 && (
        <div className="border-t border-wf-outline-variant p-2">
          <Typeplate label="LATERAL" value={`${laterals.length}`} size="sm" className="px-2 mb-1" />
          <div className="space-y-0.5">
            {laterals.map((a) => (
              <Link
                key={a.slug}
                to={`/agents/${a.slug}`}
                className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-wf-surface-container-hi transition-colors rounded-wf-sm"
              >
                <Sigil slug={a.slug} size={24} />
                <div className="min-w-0">
                  <div className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                    {a.slug.toUpperCase()}
                  </div>
                  <div className="text-sm text-wf-on-surface truncate">{fullName(a)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="border-t border-wf-outline-variant px-4 py-2 flex flex-wrap gap-x-4 gap-y-1">
        {/* One destination now. The sibling link went to /org?center=,
            the egocentric 1-hop view, which has been retired — so the
            label-ambiguity fix that once lived here (wf:freya F1) is moot:
            there is nothing left to tell it apart from. */}
        <Link
          to="/org/chart"
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
        >
          WHOLE-ORG CHART ({roster.length}) →
        </Link>
      </div>
    </div>
  );
}
