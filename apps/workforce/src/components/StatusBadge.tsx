// Single source of truth for rendering an EXEC row's `status` value.
//
// Story 6 (#95) cycle-3 closure of Dario A5 + Aoi C2 from cycle 1: the
// `failed_artefact_redaction` status that landed via PR #138 (Story 3,
// merged) needs an explicit case in the executions table render path.
// Previously the ProjectProfile.tsx page had an inline `EXEC_STATUS_TONE`
// map that handled only `ok` / `throw` / `skipped` — the new status fell
// through to the generic fallback, surfacing as a colourless dot with
// raw text. That's safe-but-uninformative; this component makes it
// distinct.
//
// Why a component (not just a map):
//   - The four ExecStatus values have different label conventions (the
//     `failed_artefact_redaction` value is too long to render verbatim
//     in a compact status cell; we want "REDACTED" instead).
//   - Failure variants want an optional `error` field surfaced via
//     `title=` so the operator can hover for the diagnostic without the
//     table layout exploding.
//   - Unknown statuses (forward-compat for any future ExecStatus value
//     that lands before this file is updated) get a graceful fallback
//     instead of a blank cell.
//
// Visual contract:
//   - Mono small-caps, ●-prefix, token-driven color.
//   - `wf-running` = success, `wf-throwing` = failure (both `throw` and
//     `failed_artefact_redaction`), `wf-archived` = inactive (skipped),
//     `wf-on-surface-variant` = unknown fallback.

import type { ExecStatus } from '../types/project';

interface Props {
  status: ExecStatus | string;
  /** Diagnostic string from the EXEC row's `error` field. Surfaced via
   *  the native `title` attribute on failure variants so the operator
   *  can hover for the redaction-pattern name / throw message without
   *  the table widening. */
  error?: string;
  /** Optional extra Tailwind classes the caller may want to add
   *  (e.g. `text-[10px]` for compact tables vs the default). */
  className?: string;
}

interface StatusSpec {
  label: string;
  tone: string;
  /** When true, the component prefers the `error` prop for the `title`
   *  attribute over the bare status name — surfaces the diagnostic on
   *  hover where the operator most needs it. */
  surfaceError: boolean;
}

const STATUS_SPECS: Record<string, StatusSpec> = {
  ok: { label: 'ok', tone: 'text-wf-running', surfaceError: false },
  throw: { label: 'throw', tone: 'text-wf-throwing', surfaceError: true },
  skipped: { label: 'skipped', tone: 'text-wf-archived', surfaceError: false },
  failed_artefact_redaction: {
    label: 'REDACTED',
    tone: 'text-wf-throwing',
    surfaceError: true,
  },
};

const FALLBACK: StatusSpec = {
  label: '?',
  tone: 'text-wf-on-surface-variant',
  surfaceError: false,
};

export default function StatusBadge({ status, error, className = '' }: Props) {
  const spec = STATUS_SPECS[status] ?? FALLBACK;
  const titleParts = [status];
  if (spec.surfaceError && error) titleParts.push(error);
  // For unknown statuses, render the raw value next to the `?` so the
  // operator sees what arrived from the API and can file a follow-up if
  // a new ExecStatus landed without a render-path update.
  const labelText = spec === FALLBACK ? `${spec.label} ${status}` : spec.label;
  return (
    <span
      className={`font-wfmono text-[10px] uppercase tracking-[0.14em] ${spec.tone} ${className}`.trim()}
      title={titleParts.join(' — ')}
    >
      ● {labelText}
    </span>
  );
}
