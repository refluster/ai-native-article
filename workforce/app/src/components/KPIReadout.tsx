// The 4-up display-hero tile that anchors the Dashboard hero. Each tile
// renders a giant numeric in font-wfmono with a small mono cap above and
// a delta/sublabel below. The "throwing" variant uses wf-tertiary as the
// ink colour for the value; everything else stays in wf-on-surface.

import Typeplate from './Typeplate';

interface KPIProps {
  cap: string;
  /** The headline number / metric. Already-formatted string. */
  value: string;
  /** Sub-line under the value (e.g. "vs $4.20 last mo"). */
  sub?: string;
  /** Render the value in the tertiary throwing colour. */
  alarm?: boolean;
}

export function KPITile({ cap, value, sub, alarm = false }: KPIProps) {
  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container-lo p-4 sm:p-5 flex flex-col gap-2 rounded-wf-md">
      <Typeplate label={cap} value="" accent={alarm} size="sm" />
      <div
        className={`font-wfmono font-medium leading-none tracking-tight ${
          alarm ? 'text-wf-tertiary' : 'text-wf-on-surface'
        } text-3xl sm:text-4xl md:text-5xl`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-wf-on-surface-variant font-wfmono">{sub}</div>}
    </div>
  );
}

interface KPIReadoutProps {
  items: KPIProps[];
  className?: string;
}

/**
 * 4-up KPI grid. Wraps to 2 cols on small screens, single col on the
 * narrowest viewports.
 */
export default function KPIReadout({ items, className = '' }: KPIReadoutProps) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 ${className}`}>
      {items.map((it) => (
        <KPITile key={it.cap} {...it} />
      ))}
    </div>
  );
}
