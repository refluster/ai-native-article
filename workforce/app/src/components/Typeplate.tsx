// Typeplate — the mono header strip used across the workforce console.
// Renders a left-padded label + value pair with the JetBrains Mono stack
// and the tertiary accent dot. Behaves like a heading; never a link.

interface Props {
  /** Short uppercase label, e.g. "AGENT" or "OVERVIEW". */
  label: string;
  /** The value to display next to the label. */
  value: string;
  /** When set, renders an accent dot at the start using wf-tertiary. */
  accent?: boolean;
  /** Optional className for layout (margins, widths). */
  className?: string;
  /** Optional size variant. md is the default; sm shrinks to caption scale. */
  size?: 'sm' | 'md' | 'lg';
}

export default function Typeplate({ label, value, accent = true, className = '', size = 'md' }: Props) {
  const scale =
    size === 'sm'
      ? 'text-[10px]'
      : size === 'lg'
        ? 'text-sm'
        : 'text-xs';
  return (
    <div className={`flex items-center gap-2 font-wfmono uppercase tracking-[0.12em] ${scale} ${className}`}>
      {accent && <span className="inline-block w-1.5 h-1.5 bg-wf-tertiary" aria-hidden />}
      <span className="text-wf-on-surface-variant">{label}</span>
      <span className="text-wf-on-surface font-semibold">{value}</span>
    </div>
  );
}
