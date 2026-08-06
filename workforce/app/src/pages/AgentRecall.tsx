// /workforce/agents/:slug/recall — the operator's recall console for one
// agent's execution history (Epic-010 Story 4, #93).
//
// The recall LIBRARY has existed since the Story-4 implementation
// (workforce/lambdas/shared/recall.ts) and the agents-api exposes it at
// `GET /agents/{slug}/recall?q=&k=`; what was still missing from the Story
// was the operator-facing surface. This page is that surface: a free-text
// query box over one agent's ledger, rendering the ranked hits with the
// fields the Story's acceptance criteria name — skill_name, started_at,
// status, summary — plus a deep-link to the artefact when the EXEC row
// carries one.
//
// Scope note (kept deliberately narrow, per the issue's "smallest correct
// change"): the route is SEMANTIC-only, because that is what the API
// exposes today. The Story also sketches structured filters
// (project/skill/time/status) in the panel; the recall library supports
// them and the route accepts them as query params, but wiring filter
// controls is a separate change and is called out in the PR follow-ups
// rather than half-built here.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import StatusBadge from '../components/StatusBadge';
import {
  apiConfigured,
  fetchAgentRecall,
  RECALL_K_MAX,
  type AgentRecallHit,
} from '../lib/agents';

const DEFAULT_K = 10;
const SUMMARY_CAP = 320;

/** Cosine similarity rendered as a stable 3-decimal string, so two hits a
 *  thousandth apart don't read as identical. */
export function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(3) : '—';
}

/** The body of a hit: the engagement summary if the row has one, else the
 *  artefact preview (CCR/legacy rows), else an honest placeholder. */
export function hitSummary(hit: Pick<AgentRecallHit, 'summary' | 'artifact_ref' | 'status'>): string {
  const raw = (hit.summary ?? hit.artifact_ref?.summary ?? '').trim();
  if (raw.length === 0) return hit.status === 'skipped' ? 'skipped' : 'no summary';
  return raw.length > SUMMARY_CAP ? `${raw.slice(0, SUMMARY_CAP)}…` : raw;
}

export default function AgentRecall() {
  const { slug } = useParams<{ slug: string }>();
  const [query, setQuery] = useState('');
  const [k, setK] = useState(DEFAULT_K);
  // `submitted` is what the results belong to — held separately from the
  // input so the heading doesn't re-label while the operator is typing the
  // next query.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [hits, setHits] = useState<AgentRecallHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runRecall(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!slug || q.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    setSubmitted(q);
    try {
      setHits(await fetchAgentRecall(slug, q, k));
    } catch (err) {
      // C-4: surface the failure, don't paint an empty result list that
      // reads as "nothing in this agent's history matched".
      setError(err instanceof Error ? err.message : String(err));
      setHits(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <WorkforceLayout>
      <div className="mb-4 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        <Link to="/" className="hover:text-wf-on-surface">HOME</Link>
        <span className="mx-2">/</span>
        <Link to="/agents" className="hover:text-wf-on-surface">CREW</Link>
        <span className="mx-2">/</span>
        <Link to={`/agents/${slug ?? ''}`} className="hover:text-wf-on-surface">
          {(slug ?? '').toUpperCase()}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-wf-on-surface">RECALL</span>
      </div>

      <Typeplate label="RECALL" value={(slug ?? '').toUpperCase()} className="mb-3" />
      <h1 className="font-headline text-3xl font-black tracking-tighter text-wf-on-surface">
        Semantic recall
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-wf-on-surface-variant">
        Free-text query over <span className="font-wfmono">{slug}</span>'s own execution ledger,
        ranked by cosine similarity. A recall is partitioned by the agent it is issued for, so it
        never returns another agent's runs.
      </p>

      {!apiConfigured() && (
        <p className="mt-6 font-wfmono text-xs text-wf-on-surface-variant">
          agents-api is not configured for this build — recall is unavailable.
        </p>
      )}

      <form onSubmit={runRecall} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[16rem]">
          <span className="block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
            QUERY
          </span>
          <input
            type="text"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="what did I conclude about truncation guards?"
            className="w-full border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md px-3 py-2 text-sm text-wf-on-surface"
          />
        </label>
        <label>
          <span className="block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
            K
          </span>
          <input
            type="number"
            min={1}
            max={RECALL_K_MAX}
            value={k}
            onChange={(ev) => setK(Number(ev.target.value))}
            className="w-20 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md px-3 py-2 text-sm text-wf-on-surface"
          />
        </label>
        <button
          type="submit"
          disabled={loading || query.trim().length === 0 || !apiConfigured()}
          className="border border-wf-outline-variant rounded-wf-md px-4 py-2 font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface disabled:opacity-40"
        >
          {loading ? 'RECALLING…' : 'RECALL'}
        </button>
      </form>

      <section className="mt-8 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
        <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3">
          <Typeplate label="HITS" value={submitted ? `“${submitted}”` : 'NO QUERY YET'} />
          {hits !== null && (
            <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant shrink-0">
              {hits.length} of k={k}
            </span>
          )}
        </div>
        <div className="p-4">
          {error !== null ? (
            <p className="font-wfmono text-xs text-wf-throwing">recall failed — {error}</p>
          ) : loading ? (
            <p className="font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
          ) : hits === null ? (
            <p className="font-wfmono text-xs text-wf-on-surface-variant">
              enter a query to search this agent's history.
            </p>
          ) : hits.length === 0 ? (
            <p className="font-wfmono text-xs text-wf-on-surface-variant">
              no embedded executions matched — rows written before the embed-at-write path, or with
              a failed embedding, are only reachable from the ACTIVITY ledger.
            </p>
          ) : (
            <ol className="space-y-4">
              {hits.map((hit) => (
                <li key={hit.exec_ulid} className="border-b border-wf-outline-variant pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-wfmono text-xs text-wf-on-surface font-semibold">
                      {hit.skill_name}
                    </span>
                    <StatusBadge status={hit.status} error={hit.error} />
                    <time
                      dateTime={hit.started_at}
                      className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant"
                    >
                      {hit.started_at}
                    </time>
                    <span
                      className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant"
                      title="cosine similarity against the query embedding"
                    >
                      SCORE {formatScore(hit.score)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-wf-on-surface">{hitSummary(hit)}</p>
                  {hit.artifact_ref?.uri && (
                    <a
                      href={hit.artifact_ref.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
                    >
                      ARTEFACT →
                    </a>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </WorkforceLayout>
  );
}
