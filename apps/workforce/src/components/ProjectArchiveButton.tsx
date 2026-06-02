// Archive / unarchive button for the project profile hero.
//
// Project CRUD UI workstream (PR-δ — final piece of the project CRUD set).
// Renders ARCHIVE when the project is active, UNARCHIVE when archived.
// Click → confirm dialog citing the operational consequence (binding
// crons keep firing — archive is a list-visibility flag, not a pause),
// → PATCH /projects/{id+} via signedFetch → optimistic flip via the
// onStatusChange callback prop + non-modal banner on error/success.
//
// Pattern mirrors CredentialVault.tsx — same submit-guard, same disabled-
// state token swap with opacity/cursor, same role="alert" banner shape,
// same English modal copy.

import { useEffect, useRef, useState } from 'react';
import { patchProjectStatus, type ProjectStatus } from '../lib/projects';
import { SIGV4_IS_CONFIGURED } from '../config/auth';

interface Props {
  projectId: string;
  status: ProjectStatus;
  /** Parent callback so the hero re-renders with the new status.
   *  The component does NOT manage its own status state — the project
   *  detail lives on ProjectProfile.tsx and must round-trip through it
   *  to keep the hero, StatusChip, and the "archived ${date}" subtitle
   *  in sync. */
  onStatusChange: (next: ProjectStatus, archivedAt?: string) => void;
}

type ConfirmKind = 'archive' | 'unarchive' | null;

export default function ProjectArchiveButton({ projectId, status, onStatusChange }: Props) {
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Auto-dismiss the success banner after 4s (matches CredentialVault).
  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(id);
  }, [success]);

  // The SigV4 broker may not be configured locally (e.g. `npm run dev`
  // without VITE_COGNITO_IDENTITY_POOL_ID). Render the button but disable
  // it with a hover tooltip — matches the `credentialsApiConfigured()`
  // affordance pattern from the credential vault.
  const sigv4Ready = SIGV4_IS_CONFIGURED;
  const buttonLabel = status === 'active' ? 'ARCHIVE' : 'UNARCHIVE';
  const targetStatus: ProjectStatus = status === 'active' ? 'archived' : 'active';

  function openConfirm() {
    if (!sigv4Ready) return;
    setConfirm(status === 'active' ? 'archive' : 'unarchive');
  }

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);

    // Optimistic flip — parent re-renders with new status immediately.
    const previousStatus = status;
    const optimisticArchivedAt =
      targetStatus === 'archived' ? new Date().toISOString() : undefined;
    onStatusChange(targetStatus, optimisticArchivedAt);
    setConfirm(null);
    setSuccess(
      targetStatus === 'archived' ? 'Archived' : 'Restored to active',
    );

    try {
      const updated = await patchProjectStatus(projectId, targetStatus);
      // Reconcile with the server response — replaces the optimistic
      // timestamp with the canonical one (archive() returns the row's
      // post-write state; unarchive() clears archived_at).
      onStatusChange(updated.status, updated.archived_at);
    } catch (err) {
      // Revert on failure.
      onStatusChange(previousStatus);
      setSuccess(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openConfirm}
        disabled={!sigv4Ready || pending}
        title={
          !sigv4Ready
            ? 'sigv4 broker not configured — wire VITE_COGNITO_IDENTITY_POOL_ID'
            : `Flip project status to ${targetStatus}`
        }
        className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface hover:text-wf-primary hover:border-wf-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ● {buttonLabel}
      </button>

      {success && (
        <span
          role="status"
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-running ml-2"
        >
          {success}
        </span>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-3 border border-wf-throwing/40 bg-wf-throwing/10 rounded-wf-sm px-3 py-2 text-wf-throwing"
        >
          <span className="font-wfmono text-[10px] uppercase tracking-[0.14em]">
            API ERROR · {error}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="ml-auto font-wfmono text-[10px] text-wf-throwing hover:text-wf-on-surface"
          >
            ×
          </button>
        </div>
      )}

      {confirm !== null && (
        <ConfirmDialog
          kind={confirm}
          projectId={projectId}
          pending={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

interface ConfirmDialogProps {
  kind: 'archive' | 'unarchive';
  projectId: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ kind, projectId, pending, onCancel, onConfirm }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = 'project-archive-confirm-title';

  // Autofocus the confirm button; ESC closes.
  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  const title = kind === 'archive' ? 'Confirm archive' : 'Confirm activation';
  const body =
    kind === 'archive'
      ? `Archive project “${projectId}”. Its binding crontab keeps firing — archive only excludes it from the default list view (it does not stop execution). Continue?`
      : `Restore project “${projectId}” to active. It will reappear in the default list view. Continue?`;
  const submitLabel =
    kind === 'archive' ? 'Execute archive' : 'Execute activation';
  const submitTone =
    kind === 'archive'
      ? 'border-wf-throwing/60 text-wf-throwing hover:bg-wf-throwing hover:text-wf-surface'
      : 'border-wf-running/60 text-wf-running hover:bg-wf-running hover:text-wf-surface';

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-wf-on-surface/40 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="max-w-md w-full bg-wf-surface border border-wf-outline-variant rounded-wf-md p-6"
      >
        <h2
          id={titleId}
          className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant mb-3"
        >
          {title}
        </h2>
        <p className="text-sm text-wf-on-surface leading-relaxed mb-6">{body}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-2 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface-variant hover:text-wf-on-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-2 border rounded-wf-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${submitTone}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
