// Bindings editor — the skill × agent × project wiring surface on the
// agent profile (operator request, 2026-06-13: binding CRUD + cron-string
// editing from the UI; the API side has been live since ADR-0007).
//
// Reads render for everyone; the write affordances (cron edit / unbind /
// bind) light up only when the SigV4 broker is configured, mirroring
// ProjectArchiveButton. Every write PATCHes the FULL bindings[] via
// lib/agents.patchAgentBindings — append for new bindings (binding_idx is
// load-bearing for in-flight fires, so we never reorder), in-place
// replacement for cron edits, splice for unbind (with a confirm citing
// the index-shift consequence). Server-side validation (G1 cadence floor,
// R8 owners, S9 shape) is the real gate; 422 violations render inline.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BindingPatchError,
  fetchBindableSkills,
  patchAgentBindings,
} from '../lib/agents';
import { SIGV4_IS_CONFIGURED } from '../config/auth';
import type { AgentBinding } from '../types/agent';

interface Props {
  slug: string;
  bindings: AgentBinding[];
  /** Parent callback with the server's post-write bindings so the page
   *  (and the NEXT RUN fact) re-renders against authoritative state. */
  onUpdated: (next: AgentBinding[]) => void;
}

const CRON_SHAPE = /^cron\(.+\)$/;
const DEFAULT_PROJECT = 'agent-workforce';

/** The CCR-batched binding shape wf-orchestrator-tick dispatches —
 *  see workforce/docs/runbooks/bindings.md. */
function newCcrBinding(skill: string, cron: string, projectId: string): AgentBinding {
  return {
    skill,
    executor: 'claude-code-routine',
    trigger: {
      scheduler: 'external',
      invoked_by: 'api',
      fired_from: 'wf-orchestrator-tick',
      cron,
    },
    routine_spec: 'workforce/docs/routines/agent-runner.md',
    project_id: projectId,
    note: `Bound from the console on ${new Date().toISOString().slice(0, 10)}.`,
  };
}

export default function BindingsEditor({ slug, bindings, onUpdated }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<Array<{ rule: string; msg: string }>>([]);
  const [success, setSuccess] = useState<string | null>(null);
  // Per-row cron drafts, keyed by binding index; absent = not editing.
  const [cronDrafts, setCronDrafts] = useState<Record<number, string>>({});
  const [confirmUnbind, setConfirmUnbind] = useState<number | null>(null);
  // Add form.
  const [adding, setAdding] = useState(false);
  const [bindableSkills, setBindableSkills] = useState<string[] | null>(null);
  const [addSkill, setAddSkill] = useState('');
  const [addCron, setAddCron] = useState('cron(0 1 ? * * *)');
  const [addProject, setAddProject] = useState(DEFAULT_PROJECT);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(id);
  }, [success]);

  // Lazy-load the R8-eligible skill list the first time the add form opens.
  useEffect(() => {
    if (!adding || bindableSkills !== null) return;
    fetchBindableSkills(slug)
      .then((names) => {
        setBindableSkills(names);
        const unbound = names.filter((n) => !bindings.some((b) => b.skill === n));
        if (unbound.length > 0) setAddSkill(unbound[0]!);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [adding, bindableSkills, slug, bindings]);

  async function write(next: AgentBinding[], successMsg: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    setViolations([]);
    try {
      const updated = await patchAgentBindings(slug, next);
      onUpdated(updated);
      setSuccess(successMsg);
      setCronDrafts({});
      setConfirmUnbind(null);
      setAdding(false);
    } catch (err) {
      if (err instanceof BindingPatchError) {
        setError(err.message);
        setViolations(err.violations.map((v) => ({ rule: v.rule, msg: v.msg })));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPending(false);
    }
  }

  function saveCron(idx: number) {
    const draft = (cronDrafts[idx] ?? '').trim();
    if (!CRON_SHAPE.test(draft)) {
      setError(`cron must be "cron(...)" form (got "${draft}")`);
      return;
    }
    const next = bindings.map((b, i) =>
      i === idx ? { ...b, trigger: { ...b.trigger, cron: draft } } : b,
    );
    void write(next, `${bindings[idx]!.skill} cron updated — next orchestrator tick picks it up`);
  }

  function unbind(idx: number) {
    const next = bindings.filter((_, i) => i !== idx);
    void write(next, `${bindings[idx]!.skill} unbound`);
  }

  function addBinding() {
    const cron = addCron.trim();
    if (!addSkill) {
      setError('pick a skill');
      return;
    }
    if (!CRON_SHAPE.test(cron)) {
      setError(`cron must be "cron(...)" form (got "${cron}")`);
      return;
    }
    void write(
      [...bindings, newCcrBinding(addSkill, cron, addProject.trim() || DEFAULT_PROJECT)],
      `${addSkill} bound — next orchestrator tick picks it up`,
    );
  }

  const inputCls =
    'font-wfmono text-[11px] bg-wf-surface-container border border-wf-outline-variant rounded-wf-sm px-2 py-1 text-wf-on-surface w-full sm:w-auto';
  const btnCls =
    'font-wfmono text-[10px] uppercase tracking-[0.12em] px-2 py-1 border rounded-wf-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3">
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          BINDINGS <span className="text-wf-on-surface">{bindings.length} cron×skill</span>
        </span>
        {SIGV4_IS_CONFIGURED && (
          <button
            type="button"
            disabled={pending}
            onClick={() => { setAdding((v) => !v); setError(null); }}
            className={`${btnCls} border-wf-outline-variant text-wf-on-surface hover:border-wf-on-surface-variant`}
          >
            {adding ? 'CANCEL' : '+ BIND SKILL'}
          </button>
        )}
      </div>

      {(error || success) && (
        <div
          role="alert"
          className={`px-4 py-2 text-xs border-b border-wf-outline-variant ${error ? 'text-wf-error' : 'text-wf-tertiary'}`}
        >
          {error ?? success}
          {violations.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {violations.map((v, i) => (
                <li key={i} className="font-wfmono text-[11px]">{v.rule}: {v.msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="divide-y divide-wf-outline-variant">
        {bindings.map((b, idx) => {
          const editing = idx in cronDrafts;
          return (
            <li key={idx} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm">
              <Link
                to={`/skills/${b.skill}`}
                className="font-wfmono text-xs px-2.5 py-1.5 border border-wf-outline-variant text-wf-on-surface bg-wf-surface-container hover:border-wf-on-surface-variant hover:bg-wf-surface-container-hi rounded-wf-sm transition-colors self-start"
              >
                {b.skill}
              </Link>
              {editing ? (
                <span className="flex items-center gap-2 flex-1">
                  <input
                    className={inputCls}
                    value={cronDrafts[idx]}
                    onChange={(e) => setCronDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                    spellCheck={false}
                    aria-label={`cron for ${b.skill}`}
                  />
                  <button type="button" disabled={pending} onClick={() => saveCron(idx)} className={`${btnCls} border-wf-tertiary text-wf-tertiary`}>SAVE</button>
                  <button type="button" disabled={pending} onClick={() => setCronDrafts(({ [idx]: _, ...rest }) => rest)} className={`${btnCls} border-wf-outline-variant text-wf-on-surface-variant`}>CANCEL</button>
                </span>
              ) : (
                <span className="font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                  {b.trigger.cron ?? b.trigger.scheduler}
                  {b.project_id ? ` · ${b.project_id}` : ''}
                </span>
              )}
              {!editing && b.note && <span className="text-wf-on-surface-variant text-xs flex-1">{b.note}</span>}
              {SIGV4_IS_CONFIGURED && !editing && (
                <span className="flex items-center gap-2 sm:ml-auto">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => { setCronDrafts((d) => ({ ...d, [idx]: b.trigger.cron ?? '' })); setError(null); }}
                    className={`${btnCls} border-wf-outline-variant text-wf-on-surface hover:border-wf-on-surface-variant`}
                  >
                    EDIT CRON
                  </button>
                  {confirmUnbind === idx ? (
                    <>
                      <button type="button" disabled={pending} onClick={() => unbind(idx)} className={`${btnCls} border-wf-error text-wf-error`}>CONFIRM UNBIND</button>
                      <button type="button" disabled={pending} onClick={() => setConfirmUnbind(null)} className={`${btnCls} border-wf-outline-variant text-wf-on-surface-variant`}>KEEP</button>
                    </>
                  ) : (
                    <button type="button" disabled={pending} onClick={() => { setConfirmUnbind(idx); setError(null); }} className={`${btnCls} border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-error hover:text-wf-error`}>UNBIND</button>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {bindings.length === 0 && (
          <li className="px-4 py-3 text-sm text-wf-on-surface-variant">No bindings — this agent has no scheduled cadence.</li>
        )}
      </ul>

      {adding && (
        <div className="border-t border-wf-outline-variant px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
          <select
            className={inputCls}
            value={addSkill}
            onChange={(e) => setAddSkill(e.target.value)}
            aria-label="skill to bind"
          >
            {bindableSkills === null && <option value="">loading…</option>}
            {bindableSkills?.length === 0 && <option value="">no bindable skills (add {slug} to a skill's owners first — R8)</option>}
            {bindableSkills?.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <input className={inputCls} value={addCron} onChange={(e) => setAddCron(e.target.value)} spellCheck={false} aria-label="cron expression (UTC)" placeholder="cron(0 1 ? * * *)" />
          <input className={inputCls} value={addProject} onChange={(e) => setAddProject(e.target.value)} spellCheck={false} aria-label="project id" placeholder={DEFAULT_PROJECT} />
          <button type="button" disabled={pending || !addSkill} onClick={addBinding} className={`${btnCls} border-wf-tertiary text-wf-tertiary`}>BIND</button>
        </div>
      )}

      {SIGV4_IS_CONFIGURED && (
        <p className="px-4 pb-3 pt-1 text-[11px] text-wf-on-surface-variant">
          Writes are audited config PATCHes (ADR-0007) — live on the next orchestrator tick, no deploy. Cron is UTC, hourly floor (G1); unbinding shifts later binding indices.
        </p>
      )}
    </section>
  );
}
