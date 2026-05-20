// Dot + label status indicator. The four canonical states map to the
// wf-running / wf-paused / wf-throwing / wf-archived tokens defined in
// tailwind.config.ts. Use 'throwing' for an agent whose last_run_status
// === 'throw' — that's the one painted with the tertiary accent.

import type { RunStatus } from '../../types/workforce-stats';

export type AgentStatus = 'running' | 'paused' | 'throwing' | 'archived';

interface Props {
  status: AgentStatus;
  /** Compact form drops the textual label and just renders the dot. */
  compact?: boolean;
  className?: string;
}

const META: Record<AgentStatus, { dotClass: string; textClass: string; label: string }> = {
  running:  { dotClass: 'bg-wf-running',  textClass: 'text-wf-running',  label: 'RUNNING' },
  paused:   { dotClass: 'bg-wf-paused',   textClass: 'text-wf-paused',   label: 'PAUSED'  },
  throwing: { dotClass: 'bg-wf-throwing', textClass: 'text-wf-throwing', label: 'THROWING' },
  archived: { dotClass: 'bg-wf-archived', textClass: 'text-wf-archived', label: 'ARCHIVED' },
};

/**
 * Maps a per-agent (paused, archived, last_run_status) triple into the
 * single AgentStatus the pill cares about. 'throwing' wins over 'paused'
 * because a throwing agent is the more urgent thing to surface.
 */
export function deriveStatus(input: { paused: boolean; archived: boolean; last_run_status: RunStatus }): AgentStatus {
  if (input.archived) return 'archived';
  if (input.last_run_status === 'throw' || input.last_run_status === 'dlq') return 'throwing';
  if (input.paused) return 'paused';
  return 'running';
}

export default function StatusPill({ status, compact = false, className = '' }: Props) {
  const m = META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] ${m.textClass} ${className}`}
      role="status"
      aria-label={m.label}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${m.dotClass}`} aria-hidden />
      {!compact && <span>{m.label}</span>}
    </span>
  );
}
