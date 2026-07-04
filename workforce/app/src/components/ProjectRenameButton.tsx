// Rename button for the project profile hero.
//
// The display `name` is decoupled from the immutable `project_id` slug —
// renaming never moves the URL, the DDB partition, or the Secrets Manager
// prefix, and any characters within the 1..80 length bound are allowed.
// Click → dialog with a text input → PATCH /projects/{id} { name } via
// signedFetch → optimistic update via the onNameChange callback prop.
//
// Pattern mirrors ProjectArchiveButton.tsx — same SigV4 gate, same
// disabled-state affordance, same banner shapes.

import { useEffect, useRef, useState } from 'react';
import { patchProjectName } from '../lib/projects';
import { SIGV4_IS_CONFIGURED } from '../config/auth';

interface Props {
  projectId: string;
  name?: string;
  /** Parent callback so the hero re-renders with the new name. */
  onNameChange: (next: string) => void;
}

export default function ProjectRenameButton({ projectId, name, onNameChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(id);
  }, [success]);

  const sigv4Ready = SIGV4_IS_CONFIGURED;

  async function handleSubmit(next: string) {
    const trimmed = next.trim();
    if (pending || trimmed.length === 0 || trimmed.length > 80) return;
    setPending(true);
    setError(null);

    const previous = name;
    onNameChange(trimmed); // optimistic
    setOpen(false);
    setSuccess('Renamed');

    try {
      const updated = await patchProjectName(projectId, trimmed);
      if (updated.name) onNameChange(updated.name);
    } catch (err) {
      if (previous !== undefined) onNameChange(previous);
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
        onClick={() => sigv4Ready && setOpen(true)}
        disabled={!sigv4Ready || pending}
        title={
          !sigv4Ready
            ? 'sigv4 broker not configured — wire VITE_COGNITO_IDENTITY_POOL_ID'
            : 'Rename the display name (the project id / URL never changes)'
        }
        className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface hover:text-wf-primary hover:border-wf-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ✎ RENAME
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

      {open && (
        <RenameDialog
          projectId={projectId}
          initial={name ?? ''}
          pending={pending}
          onCancel={() => setOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}

interface RenameDialogProps {
  projectId: string;
  initial: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (next: string) => void;
}

function RenameDialog({ projectId, initial, pending, onCancel, onSubmit }: RenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const titleId = 'project-rename-title';
  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 80;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-wf-on-surface/40 flex items-center justify-center p-4"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(value);
        }}
        className="max-w-md w-full bg-wf-surface border border-wf-outline-variant rounded-wf-md p-6"
      >
        <h2
          id={titleId}
          className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant mb-3"
        >
          Rename project
        </h2>
        <p className="text-sm text-wf-on-surface leading-relaxed mb-4">
          Display name for <code className="font-mono">{projectId}</code>. The project id (URL,
          keys, credentials path) never changes — this is a label, 1–80 characters, any script.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          placeholder="Display name"
          className="w-full mb-6 px-3 py-2 bg-wf-surface-container-lo border border-wf-outline-variant rounded-wf-sm text-sm text-wf-on-surface focus:outline-none focus:border-wf-primary"
        />
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
            type="submit"
            disabled={pending || !valid}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-2 border rounded-wf-sm transition-colors border-wf-running/60 text-wf-running hover:bg-wf-running hover:text-wf-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save name
          </button>
        </div>
      </form>
    </div>
  );
}
