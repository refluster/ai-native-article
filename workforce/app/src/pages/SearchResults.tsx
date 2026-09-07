// /search?q=… — global search results across talent + skills (Epic-014
// Story 2). The GlobalNav box submits here; this page is the "see all"
// surface behind the typeahead dropdown. Two sections, Talent then
// Skills, each ranked by lib/search. A blank query prompts rather than
// dumping the whole roster.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { trackEvent } from '@kohuehara/shared/analytics'
import WorkforceLayout from '../components/WorkforceLayout'
import Typeplate from '../components/Typeplate'
import Sigil from '../components/Sigil'
import { loadWorkforceManifest, fullName } from '../lib/agents'
import { loadWorkforceSkillManifest } from '../lib/skills'
import { searchAgents, searchSkills, type MatchField } from '../lib/search'
import type { WorkforceAgentManifest } from '../types/agent'
import type { WorkforceSkillManifest } from '../types/skill'

/** Human-readable reason a row matched, for the "why" chip on each result. */
function matchLabel(field: MatchField): string {
  switch (field) {
    case 'slug': return 'slug'
    case 'name': return 'name'
    case 'role': return 'role'
    case 'residence': return 'location'
    case 'about': return 'profile'
    case 'skill': return 'skill name'
    case 'description': return 'description'
    case 'owner': return 'owner'
  }
}

export default function SearchResults() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [draft, setDraft] = useState(q)
  const [agentManifest, setAgentManifest] = useState<WorkforceAgentManifest | null>(null)
  const [skillManifest, setSkillManifest] = useState<WorkforceSkillManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = q ? `Workforce — Search “${q}”` : 'Workforce — Search'
  }, [q])

  // Keep the in-page input in sync when the URL query changes (e.g. the
  // user submits a fresh search from the GlobalNav box while already here).
  useEffect(() => { setDraft(q) }, [q])

  useEffect(() => {
    Promise.all([loadWorkforceManifest(), loadWorkforceSkillManifest()])
      .then(([a, s]) => { setAgentManifest(a); setSkillManifest(s) })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const agentHits = useMemo(
    () => (agentManifest ? searchAgents(agentManifest.agents, q) : []),
    [agentManifest, q],
  )
  const skillHits = useMemo(
    () => (skillManifest ? searchSkills(skillManifest.skills, q) : []),
    [skillManifest, q],
  )

  // F2 — one event per distinct query on this surface. Held until both
  // manifests resolve: before that the hit counts are zero because nothing
  // has loaded, not because the query missed.
  const loaded = agentManifest !== null && skillManifest !== null
  const loggedRef = useRef('')
  useEffect(() => {
    const query = q.trim()
    if (!query || !loaded) return
    if (loggedRef.current === query) return
    loggedRef.current = query
    trackEvent({
      name: 'global_search',
      params: { surface: 'page', has_results: agentHits.length + skillHits.length > 0 },
    })
  }, [q, loaded, agentHits.length, skillHits.length])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = draft.trim()
    setParams(next ? { q: next } : {}, { replace: false })
  }

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="SEARCH" value="TALENT · SKILLS" className="mb-3" />
        <form onSubmit={submit} className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface">
            {q ? <>Results for “{q}”.</> : <>Search the network.</>}
          </h1>
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Search talent and skills"
            placeholder="search talent / skills"
            className="font-wfmono text-xs px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full md:w-72 focus:outline-none focus:border-wf-primary"
          />
        </form>
      </section>

      {error && (
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load search index: {error}</div>
      )}

      {!error && !q && (
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
          Type a name, role, city, skill, or owner to search the network.
        </div>
      )}

      {!error && q && (!agentManifest || !skillManifest) && (
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Searching…</div>
      )}

      {!error && q && agentManifest && skillManifest && (
        <div className="space-y-10">
          {/* Talent */}
          <section>
            <h2 className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-on-surface-variant mb-3">
              Talent · {agentHits.length}
            </h2>
            {agentHits.length === 0 ? (
              <p className="text-sm text-wf-on-surface-variant">No talent matches “{q}”.</p>
            ) : (
              <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {agentHits.map(({ agent, matchedOn }) => (
                  <li key={agent.slug}>
                    <Link
                      to={`/agents/${agent.slug}`}
                      className="flex items-center gap-3 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-3 hover:bg-wf-surface-container-hi transition-colors"
                    >
                      <Sigil slug={agent.slug} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
                        <div className="text-xs text-wf-on-surface-variant truncate">{agent.role} · {agent.residence}</div>
                      </div>
                      <span className="shrink-0 font-wfmono text-[9px] uppercase tracking-[0.14em] px-2 py-0.5 border border-wf-outline-variant text-wf-on-surface-variant">
                        {matchLabel(matchedOn)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Skills */}
          <section>
            <h2 className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-on-surface-variant mb-3">
              Skills · {skillHits.length}
            </h2>
            {skillHits.length === 0 ? (
              <p className="text-sm text-wf-on-surface-variant">No skills match “{q}”.</p>
            ) : (
              <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {skillHits.map(({ skill, matchedOn }) => (
                  <li key={skill.name}>
                    <Link
                      to={`/skills/${skill.name}`}
                      className="block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-3 hover:bg-wf-surface-container-hi transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-headline text-lg font-black tracking-tight text-wf-on-surface truncate">{skill.name}</div>
                        <span className="shrink-0 font-wfmono text-[9px] uppercase tracking-[0.14em] px-2 py-0.5 border border-wf-outline-variant text-wf-on-surface-variant">
                          {matchLabel(matchedOn)}
                        </span>
                      </div>
                      <p className="text-xs text-wf-on-surface-variant line-clamp-2 mt-1">{skill.description}</p>
                      {skill.owners.length > 0 && (
                        <div className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                          {skill.owners.join(' · ')}
                        </div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {agentHits.length === 0 && skillHits.length === 0 && (
            <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
              Nothing matched “{q}”. Try a name, role (“engineer”), city, skill, or owner slug.
            </div>
          )}
        </div>
      )}
    </WorkforceLayout>
  )
}
