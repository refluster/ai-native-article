// Small relational card — shows who an agent reports to, who reports to
// them, and who they pair with laterally. Used in the Profile sidebar
// and (in a more compact form) inside the Org DAG node tooltip.

import { Link } from 'react-router-dom';
import Sigil from './Sigil';
import Typeplate from './Typeplate';
import { fullName } from '../lib/agents';
import type { WorkforceAgent } from '../types/agent';

interface Props {
  agent: WorkforceAgent;
  /** Full roster — used to resolve slug references in reports_to / lateral / direct_reports. */
  roster: WorkforceAgent[];
}

function lookup(roster: WorkforceAgent[], slug: string): WorkforceAgent | undefined {
  return roster.find((r) => r.slug === slug);
}

function MiniLink({ to, agent }: { to: string; agent: WorkforceAgent }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 px-2 py-2 hover:bg-wf-surface-container-hi transition-colors rounded-wf-sm"
    >
      <Sigil slug={agent.slug} size={28} />
      <div className="min-w-0">
        <div className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
          {agent.slug.toUpperCase()}
        </div>
        <div className="text-sm text-wf-on-surface truncate">{fullName(agent)}</div>
      </div>
    </Link>
  );
}

function Group({ cap, slugs, roster }: { cap: string; slugs: string[]; roster: WorkforceAgent[] }) {
  const resolved = slugs.map((s) => lookup(roster, s)).filter((a): a is WorkforceAgent => !!a);
  if (resolved.length === 0) return null;
  return (
    <div>
      <Typeplate label={cap} value={`${resolved.length}`} size="sm" className="px-2 mb-1" />
      <div className="space-y-0.5">
        {resolved.map((a) => (
          <MiniLink key={a.slug} to={`/agents/${a.slug}`} agent={a} />
        ))}
      </div>
    </div>
  );
}

export default function ReportingCard({ agent, roster }: Props) {
  const noEdges =
    agent.reports_to.length === 0 && agent.direct_reports.length === 0 && agent.lateral.length === 0;

  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="DECK · ORG" value={agent.tier.toUpperCase()} />
      </div>
      <div className="p-3 space-y-3">
        {noEdges && (
          <div className="font-wfmono text-xs text-wf-on-surface-variant px-2 py-2">
            no reporting edges recorded.
          </div>
        )}
        <Group cap="REPORTS TO"      slugs={agent.reports_to}     roster={roster} />
        <Group cap="LATERAL"         slugs={agent.lateral}        roster={roster} />
        <Group cap="DIRECT REPORTS"  slugs={agent.direct_reports} roster={roster} />
      </div>
      <div className="border-t border-wf-outline-variant px-4 py-2">
        <Link
          to="/org"
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
        >
          VIEW FULL ORG →
        </Link>
      </div>
    </div>
  );
}
