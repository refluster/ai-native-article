// CredentialVault — project credentials panel on the project profile page.
//
// Five canonical credential types (anthropic / discord / github / notion /
// voyage) render as a fixed-order list, each in one of three local
// states:
//
//   - 'unprovisioned' — no row from LIST; offers a CREATE action.
//   - 'provisioned'   — backed by a real Secrets Manager row; offers
//                       ROTATE + DELETE.
//   - 'deleted'       — soft-deleted via Secrets Manager's recovery
//                       window (7 days); shows the recovery deadline as
//                       a badge. After a refetch the row reverts to
//                       'unprovisioned' (the LIST endpoint treats
//                       ResourceNotFound as not-in-list).
//
// All copy is English per the workforce console language. The
// "credentials write disabled" advisory mirrors the existing
// apiConfigured() advisory in ProjectProfile.tsx for consistency with
// operator-facing config-gap messaging.
//
// Optimistic-update strategy:
//   The mutation closes its modal + flips the row's local state
//   immediately, then issues the network call. On success the response
//   replaces the optimistic row; on failure we revert and surface an
//   error banner. A `pendingMutations` set blocks the REFETCH button
//   while any mutation is in flight (avoids a race between refetch
//   ground-truth and an in-progress write).

import { useEffect, useId, useRef, useState } from 'react';
import Typeplate from './Typeplate';
import {
  CREDENTIAL_TYPES,
  type CredentialTypeId,
  credentialsApiConfigured,
  deleteCredential,
  fetchCredentials,
  putCredential,
} from '../lib/credentials';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';
import type {
  CredentialMetadata,
  DeleteCredentialResponse,
  PutCredentialResponse,
} from '../types/project';

// ─── shape hints + display labels ─────────────────────────────────────

type FieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  type: 'password' | 'text';
};

const SHAPE_HINTS: Record<CredentialTypeId, FieldSpec[]> = {
  'anthropic.api_key': [
    { key: 'apiKey', label: 'apiKey', placeholder: 'sk-ant-...', type: 'password' },
  ],
  'discord.bot_token': [
    { key: 'token', label: 'token', placeholder: 'MTAxN...', type: 'password' },
  ],
  'github.token': [
    {
      key: 'token',
      label: 'token',
      placeholder: 'ghp_... or github_pat_...',
      type: 'password',
    },
  ],
  'notion.integration_token': [
    // apiKey only. The Notion database ids are non-secret constants baked
    // into the article-level2 skill (publish-notion.mjs / pick-l1-source.mjs,
    // env-overridable), so the operator never enters a databaseId here — the
    // only consumer reads credentials['notion.integration_token'].apiKey.
    { key: 'apiKey', label: 'apiKey', placeholder: 'secret_...', type: 'password' },
  ],
  'voyage.api_key': [
    { key: 'apiKey', label: 'apiKey', placeholder: 'pa-...', type: 'password' },
  ],
};

const CREDENTIAL_TYPE_LABELS: Record<CredentialTypeId, string> = {
  'anthropic.api_key': 'Anthropic API Key',
  'discord.bot_token': 'Discord Bot Token',
  'github.token': 'GitHub Token',
  'notion.integration_token': 'Notion Integration',
  'voyage.api_key': 'Voyage API Key',
};

// ─── local row + modal state ──────────────────────────────────────────

type LocalRow = Omit<CredentialMetadata, 'credential_type'> & {
  credential_type: CredentialTypeId;
  _localState: 'provisioned' | 'unprovisioned' | 'deleted';
  _recoverableUntil?: string;
};

type ModalState =
  | { kind: null }
  | { kind: 'rotate'; credentialType: CredentialTypeId }
  | { kind: 'create'; credentialType: CredentialTypeId }
  | { kind: 'delete'; credentialType: CredentialTypeId };

// ─── helpers ──────────────────────────────────────────────────────────

function formatRecoverableUntil(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}

function buildInitialRows(items: CredentialMetadata[]): LocalRow[] {
  const byType = new Map<string, CredentialMetadata>();
  for (const item of items) byType.set(item.credential_type, item);
  return CREDENTIAL_TYPES.map<LocalRow>((type) => {
    const match = byType.get(type);
    if (match) {
      return { ...match, credential_type: type, _localState: 'provisioned' as const };
    }
    return {
      credential_type: type,
      name: '',
      secret_arn: '',
      _localState: 'unprovisioned',
    };
  });
}

// ─── main component ───────────────────────────────────────────────────

export default function CredentialVault({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<LocalRow[]>(() => buildInitialRows([]));
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: null });
  // pendingMutations tracks per-type writes in flight. The REFETCH button
  // is disabled when any are active so refetch ground-truth doesn't race
  // an in-progress write. Refetch semantics: re-call LIST and rebuild
  // local state from scratch — a previously-deleted row may flip back to
  // 'unprovisioned' (the LIST endpoint treats ResourceNotFound as not in
  // the list), and a re-CREATE attempt within the 7-day Secrets Manager
  // recovery window will surface as `API ERROR · ResourceExistsException`.
  const [pendingMutations, setPendingMutations] = useState<Set<string>>(new Set());

  // Auto-dismiss success banners after 4s. Errors stick until dismissed
  // by the operator (or replaced by a new attempt).
  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(id);
  }, [success]);

  const refetch = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const items = await fetchCredentials(projectId, WORKFORCE_AGENTS_API_BASE);
      setRows(buildInitialRows(items));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    fetchCredentials(projectId, WORKFORCE_AGENTS_API_BASE)
      .then((items) => {
        if (cancelled) return;
        setRows(buildInitialRows(items));
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const provisionedCount = rows.filter((r) => r._localState === 'provisioned').length;
  const writesDisabled = !credentialsApiConfigured();

  // ─── mutation handlers ────────────────────────────────────────────

  const markPending = (type: CredentialTypeId) => {
    setPendingMutations((prev) => {
      const next = new Set(prev);
      next.add(type);
      return next;
    });
  };

  const unmarkPending = (type: CredentialTypeId) => {
    setPendingMutations((prev) => {
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
  };

  const applyRowUpdate = (
    type: CredentialTypeId,
    updater: (row: LocalRow) => LocalRow,
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.credential_type === type ? updater(r) : r)),
    );
  };

  const handleRotate = async (
    credentialType: CredentialTypeId,
    value: Record<string, string>,
  ) => {
    const snapshot = rows.find((r) => r.credential_type === credentialType);
    if (!snapshot) return;
    const nowIso = new Date().toISOString();
    applyRowUpdate(credentialType, (row) => ({
      ...row,
      last_changed_at: nowIso,
    }));
    setModal({ kind: null });
    setError(null);
    setSuccess('Rotated');
    markPending(credentialType);
    try {
      const res: PutCredentialResponse = await putCredential(
        projectId,
        credentialType,
        value,
      );
      applyRowUpdate(credentialType, () => ({
        credential_type: credentialType,
        name: res.name,
        secret_arn: res.secret_arn,
        last_changed_at: res.last_changed_at,
        _localState: 'provisioned',
      }));
    } catch (err) {
      applyRowUpdate(credentialType, () => snapshot);
      setSuccess(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unmarkPending(credentialType);
    }
  };

  const handleCreate = async (
    credentialType: CredentialTypeId,
    value: Record<string, string>,
  ) => {
    const snapshot = rows.find((r) => r.credential_type === credentialType);
    if (!snapshot) return;
    const nowIso = new Date().toISOString();
    applyRowUpdate(credentialType, (row) => ({
      ...row,
      last_changed_at: nowIso,
      created_date: nowIso,
      _localState: 'provisioned',
    }));
    setModal({ kind: null });
    setError(null);
    setSuccess('Created');
    markPending(credentialType);
    try {
      const res: PutCredentialResponse = await putCredential(
        projectId,
        credentialType,
        value,
      );
      applyRowUpdate(credentialType, () => ({
        credential_type: credentialType,
        name: res.name,
        secret_arn: res.secret_arn,
        last_changed_at: res.last_changed_at,
        _localState: 'provisioned',
      }));
    } catch (err) {
      applyRowUpdate(credentialType, () => ({
        ...snapshot,
        _localState: 'unprovisioned',
      }));
      setSuccess(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unmarkPending(credentialType);
    }
  };

  const handleDelete = async (credentialType: CredentialTypeId) => {
    const snapshot = rows.find((r) => r.credential_type === credentialType);
    if (!snapshot) return;
    const optimisticUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
    applyRowUpdate(credentialType, (row) => ({
      ...row,
      _localState: 'deleted',
      _recoverableUntil: optimisticUntil,
    }));
    setModal({ kind: null });
    setError(null);
    setSuccess(
      `Deleted — recoverable until ${formatRecoverableUntil(optimisticUntil)}`,
    );
    markPending(credentialType);
    try {
      const res: DeleteCredentialResponse = await deleteCredential(
        projectId,
        credentialType,
      );
      applyRowUpdate(credentialType, (row) => ({
        ...row,
        _localState: 'deleted',
        _recoverableUntil: res.deletion_date,
      }));
    } catch (err) {
      applyRowUpdate(credentialType, () => snapshot);
      setSuccess(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unmarkPending(credentialType);
    }
  };

  // ─── render ───────────────────────────────────────────────────────

  const activeModalType = modal.kind ? modal.credentialType : null;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md">
      <header className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3">
        <Typeplate
          label="CREDENTIALS"
          value={`${provisionedCount} / 5 provisioned`}
        />
        <button
          type="button"
          onClick={() => {
            void refetch();
          }}
          disabled={loading || pendingMutations.size > 0}
          title="REFETCH"
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline disabled:text-wf-on-surface-variant disabled:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          REFETCH
        </button>
      </header>

      <div className="p-4 space-y-3">
        {writesDisabled && (
          <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            credentials write disabled — wire VITE_WORKFORCE_CREDENTIALS_API_BASE
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="border border-wf-throwing/40 bg-wf-throwing/10 text-wf-throwing rounded-wf-sm px-3 py-2 flex items-start justify-between gap-3"
          >
            <span className="font-wfmono text-xs leading-relaxed">
              <span className="font-semibold uppercase tracking-[0.14em]">API ERROR · </span>
              {error}
            </span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] hover:underline"
            >
              ×
            </button>
          </div>
        )}

        {success && (
          <div
            role="status"
            className="border border-wf-running/40 bg-wf-running/10 text-wf-running rounded-wf-sm px-3 py-2 font-wfmono text-xs"
          >
            {success}
          </div>
        )}

        {loading && (
          <p className="font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
        )}

        {!loading && fetchError && (
          <div role="alert" className="space-y-2">
            <p className="font-wfmono text-xs text-wf-throwing">
              Failed to load credentials.
            </p>
            <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              {fetchError}
            </p>
            <button
              type="button"
              onClick={() => {
                void refetch();
              }}
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              REFETCH
            </button>
          </div>
        )}

        {!loading && !fetchError && (
          <>
            {provisionedCount === 0 && (
              <p className="text-sm text-wf-on-surface-variant leading-relaxed">
                No credentials registered yet. Use “CREATE” on each type below.
              </p>
            )}
            <ul role="list" className="divide-y divide-wf-outline-variant">
              {rows.map((row) => (
                <CredentialRow
                  key={row.credential_type}
                  row={row}
                  disabled={writesDisabled || pendingMutations.has(row.credential_type)}
                  onRotate={() =>
                    setModal({
                      kind: 'rotate',
                      credentialType: row.credential_type,
                    })
                  }
                  onCreate={() =>
                    setModal({
                      kind: 'create',
                      credentialType: row.credential_type,
                    })
                  }
                  onDelete={() =>
                    setModal({
                      kind: 'delete',
                      credentialType: row.credential_type,
                    })
                  }
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {modal.kind === 'rotate' && activeModalType && (
        <CredentialModal
          key={`rotate-${activeModalType}`}
          mode="rotate"
          credentialType={activeModalType}
          onClose={() => setModal({ kind: null })}
          onSubmit={(value) => {
            void handleRotate(activeModalType, value);
          }}
        />
      )}
      {modal.kind === 'create' && activeModalType && (
        <CredentialModal
          key={`create-${activeModalType}`}
          mode="create"
          credentialType={activeModalType}
          onClose={() => setModal({ kind: null })}
          onSubmit={(value) => {
            void handleCreate(activeModalType, value);
          }}
        />
      )}
      {modal.kind === 'delete' && activeModalType && (
        <DeleteConfirmDialog
          credentialType={activeModalType}
          onClose={() => setModal({ kind: null })}
          onConfirm={() => {
            void handleDelete(activeModalType);
          }}
        />
      )}
    </section>
  );
}

// ─── row ──────────────────────────────────────────────────────────────

function formatDateShort(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}

interface CredentialRowProps {
  row: LocalRow;
  onRotate: () => void;
  onCreate: () => void;
  onDelete: () => void;
  disabled: boolean;
}

function CredentialRow({
  row,
  onRotate,
  onCreate,
  onDelete,
  disabled,
}: CredentialRowProps) {
  const label = CREDENTIAL_TYPE_LABELS[row.credential_type];
  return (
    <li className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-wfmono text-xs text-wf-on-surface truncate">{label}</div>
        <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {row.credential_type}
        </div>
        {row._localState === 'provisioned' && (
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mt-1">
            changed {formatDateShort(row.last_changed_at)}
          </div>
        )}
        {row._localState === 'deleted' && (
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-throwing mt-1">
            DELETED — recoverable until {formatDateShort(row._recoverableUntil)}
          </div>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-1 sm:gap-2 shrink-0">
        {row._localState === 'provisioned' && (
          <>
            <button
              type="button"
              onClick={onRotate}
              disabled={disabled}
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline disabled:text-wf-on-surface-variant disabled:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ROTATE
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-throwing hover:underline disabled:text-wf-on-surface-variant disabled:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              DELETE
            </button>
          </>
        )}
        {row._localState === 'unprovisioned' && (
          <button
            type="button"
            onClick={onCreate}
            disabled={disabled}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline disabled:text-wf-on-surface-variant disabled:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            CREATE
          </button>
        )}
      </div>
    </li>
  );
}

// ─── modal ────────────────────────────────────────────────────────────

interface CredentialModalProps {
  mode: 'rotate' | 'create';
  credentialType: CredentialTypeId;
  onClose: () => void;
  onSubmit: (value: Record<string, string>) => void;
}

function CredentialModal({
  mode,
  credentialType,
  onClose,
  onSubmit,
}: CredentialModalProps) {
  const fields = SHAPE_HINTS[credentialType];
  const titleId = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  );
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const allFieldsFilled = fields.every((f) => values[f.key]?.trim().length > 0);
  const confirmGate = mode === 'rotate' ? confirmText.trim() === 'ROTATE' : true;
  const canSubmit = allFieldsFilled && confirmGate;

  const title =
    mode === 'rotate'
      ? `ROTATE — ${credentialType}`
      : `CREATE — ${credentialType}`;
  const submitLabel = mode === 'rotate' ? 'Execute rotate' : 'Execute create';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-wf-on-surface/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-wf-surface border border-wf-outline-variant rounded-wf-md max-w-lg w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface"
        >
          {title}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || submitting) return;
            setSubmitting(true);
            const trimmed = Object.fromEntries(
              fields.map((f) => [f.key, (values[f.key] ?? '').trim()]),
            );
            onSubmit(trimmed);
            // (no need to flip back — modal will unmount on success)
          }}
          className="space-y-3"
        >
          {fields.map((field, idx) => (
            <label key={field.key} className="block space-y-1">
              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                {field.label}
              </span>
              <input
                ref={idx === 0 ? firstInputRef : undefined}
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                autoComplete="off"
                className="w-full border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface font-mono text-sm rounded-wf-sm px-2 py-1"
              />
            </label>
          ))}
          {mode === 'rotate' && (
            <label className="block space-y-1">
              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                Type “ROTATE” to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                className="w-full border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface font-mono text-sm rounded-wf-sm px-2 py-1"
              />
            </label>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:underline"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline disabled:text-wf-on-surface-variant disabled:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── delete confirm ───────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  credentialType: CredentialTypeId;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteConfirmDialog({
  credentialType,
  onClose,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-wf-on-surface/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-wf-surface border border-wf-outline-variant rounded-wf-md max-w-md w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface"
        >
          Confirm deletion
        </h2>
        <p className="text-sm text-wf-on-surface leading-relaxed">
          This will delete the secret value for {credentialType}. AWS Secrets
          Manager’s recovery window keeps it recoverable for 7 days. Continue?
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:underline"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              if (submitting) return;
              setSubmitting(true);
              onConfirm();
              // (no need to flip back — dialog will unmount)
            }}
            disabled={submitting}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-throwing hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Execute delete
          </button>
        </div>
      </div>
    </div>
  );
}

// Internal helpers exported for tests only. The render path uses these
// helpers but they aren't part of the public component contract.
export const __TEST_ONLY__ = {
  buildInitialRows,
  formatRecoverableUntil,
};
