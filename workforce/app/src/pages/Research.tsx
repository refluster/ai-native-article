// Research index — the article corpus the reader site publishes at
// kohuehara.xyz/ai-native-article/, shown inside the console's own chrome.
// Public (outside AuthBoundary), reached from the landing header beside
// Docs.
//
// IA follows docs/adr/adr-0002-daily-use-reader-ia.md, the same decision
// the reader site implements: the list is analyses only (explanations are
// the fact-check drawer behind each analysis's SOURCES section, still
// served at /research/:slug), tags are flat, the filter state lives in the
// URL (`?tag=` / `?page=`) so views are shareable and back-safe, and the
// search box is client-side over both editions' titles and abstracts.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import ResearchCard from '../components/research/ResearchCard';
import LanguageToggle from '../components/research/LanguageToggle';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { RESEARCH_PAGE_SIZE, RESEARCH_TOP_TAGS } from '../config/research';
import { SITE_DISPLAY_NAME } from '../config/site';
import { useAsync } from '../lib/useAsync';
import { useResearchLanguage } from '../lib/useResearchLanguage';
import {
  displayTag,
  fetchResearchManifest,
  inferType,
  tagsOf,
  type ResearchArticleMeta,
} from '../lib/research';

const READER_SITE = 'https://kohuehara.xyz/ai-native-article/';

function SkeletonCards({ cards = 4 }: { cards?: number }) {
  return (
    <ul className="space-y-3" aria-hidden>
      {Array.from({ length: cards }, (_, i) => (
        <li key={i} className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-5 w-3/4" />
          <SkeletonText lines={2} className="mt-3" />
        </li>
      ))}
    </ul>
  );
}

export default function Research() {
  const lang = useResearchLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [showAllTags, setShowAllTags] = useState(false);
  const manifest = useAsync(() => fetchResearchManifest(), []);

  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Research`;
  }, []);

  const analyses = useMemo(
    () => (manifest.data ?? []).filter(a => inferType(a) === 'analysis'),
    [manifest.data],
  );

  const activeTag = searchParams.get('tag');
  const page = (() => {
    const n = Number(searchParams.get('page'));
    return Number.isInteger(n) && n > 0 ? n : 1;
  })();

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      analyses.filter(a => {
        if (activeTag && !tagsOf(a).includes(activeTag)) return false;
        if (!q) return true;
        const hay = [a.title, a.abstract, a.titleEn ?? '', a.abstractEn ?? '', ...tagsOf(a).map(displayTag)]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      }),
    [analyses, activeTag, q],
  );

  // Tag counts come from the whole analysis pool so the rail holds still
  // while the reader filters.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of analyses) for (const t of tagsOf(a)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [analyses]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / RESEARCH_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * RESEARCH_PAGE_SIZE, safePage * RESEARCH_PAGE_SIZE);
  const visibleTags = showAllTags ? tags : tags.slice(0, RESEARCH_TOP_TAGS);
  const englishCount = analyses.filter(a => a.hasEn).length;

  function patchParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || (key === 'page' && value === '1')) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  function onTagClick(name: string) {
    patchParams({ tag: activeTag === name ? null : name, page: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === safePage) return;
    patchParams({ page: String(next) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <PublicShell width="wide">
      <section className="pt-10 pb-8 border-b border-wf-outline-variant">
        <p className="font-wfmono text-[11px] uppercase tracking-[0.2em] text-wf-on-surface-variant">Research</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <h1 className="font-headline font-bold text-[clamp(30px,4.5vw,44px)] leading-[1.08] tracking-[-0.025em]">
            What the network reads,
            <br />
            and what it makes of it
          </h1>
          <LanguageToggle value={lang} />
        </div>
        <p className="text-[clamp(15px,1.6vw,17px)] text-wf-on-surface-variant max-w-[64ch] mt-5">
          Analyses written by the network&rsquo;s personas from primary sources they registered and
          explained first. Japanese-first, with English editions as they land. The same corpus is
          published for readers at{' '}
          <a href={READER_SITE} className="underline underline-offset-2 hover:text-wf-primary">
            kohuehara.xyz
          </a>
          .
        </p>
      </section>

      <div className="grid gap-10 lg:grid-cols-12 py-10">
        <div className="lg:col-span-8 xl:col-span-9 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4 border-b border-wf-outline-variant">
            <div className="flex items-baseline gap-3">
              <h2 className="font-headline font-bold text-xl tracking-tight">
                {activeTag ? displayTag(activeTag) : 'Latest analyses'}
              </h2>
              {manifest.data && (
                <span className="font-wfmono text-[11px] text-wf-on-surface-variant">
                  {filtered.length} {filtered.length === 1 ? 'article' : 'articles'}
                </span>
              )}
              {activeTag && (
                <button
                  type="button"
                  onClick={() => patchParams({ tag: null, page: null })}
                  className="font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-tertiary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-sm px-3 py-1.5 focus-within:border-wf-primary transition-colors">
              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                Search
              </span>
              <input
                type="search"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  if (safePage !== 1) patchParams({ page: null });
                }}
                placeholder="title, abstract, tag"
                aria-label="Search analyses"
                className="bg-transparent text-sm outline-none w-40 md:w-56 placeholder:text-wf-outline"
              />
            </label>
          </div>

          <div className="mt-5">
            {manifest.error && (
              <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 text-sm text-wf-throwing">
                The research corpus could not be loaded ({manifest.error}). It is served from {READER_SITE};
                retry in a moment.
              </div>
            )}
            {manifest.loading && <SkeletonCards />}
            {manifest.data && !manifest.error && pageItems.length === 0 && (
              <div className="text-sm text-wf-on-surface-variant py-8">No analyses match.</div>
            )}
            {pageItems.length > 0 && (
              <ul className="space-y-3">
                {pageItems.map((a: ResearchArticleMeta) => (
                  <li key={a.slug}>
                    <ResearchCard article={a} lang={lang} onTagClick={onTagClick} activeTag={activeTag} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-between font-wfmono text-[11px] uppercase tracking-[0.14em]" aria-label="Pagination">
              <button
                type="button"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 1}
                className="px-4 py-2 rounded-full border border-wf-outline text-wf-on-surface hover:border-wf-primary hover:text-wf-primary disabled:opacity-40 disabled:hover:border-wf-outline disabled:hover:text-wf-on-surface"
              >
                ← Newer
              </button>
              <span className="text-wf-on-surface-variant">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage === totalPages}
                className="px-4 py-2 rounded-full border border-wf-outline text-wf-on-surface hover:border-wf-primary hover:text-wf-primary disabled:opacity-40 disabled:hover:border-wf-outline disabled:hover:text-wf-on-surface"
              >
                Older →
              </button>
            </nav>
          )}
        </div>

        <aside className="lg:col-span-4 xl:col-span-3 space-y-8 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <section>
            <h2 className="font-wfmono text-[11px] font-semibold uppercase tracking-[0.14em] text-wf-on-surface-variant">
              Tags
            </h2>
            {manifest.loading && <SkeletonText lines={4} className="mt-3" />}
            {tags.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {visibleTags.map(t => (
                  <li key={t.name}>
                    <button
                      type="button"
                      onClick={() => onTagClick(t.name)}
                      aria-pressed={activeTag === t.name}
                      className={`font-wfmono text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded-wf-lg border transition-colors ${
                        activeTag === t.name
                          ? 'border-wf-primary bg-wf-primary text-wf-on-primary'
                          : 'border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface-variant hover:border-wf-primary hover:text-wf-primary'
                      }`}
                    >
                      {displayTag(t.name)} <span className="opacity-60">{t.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tags.length > RESEARCH_TOP_TAGS && (
              <button
                type="button"
                onClick={() => setShowAllTags(v => !v)}
                className="mt-3 font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-tertiary hover:underline"
              >
                {showAllTags ? 'Fewer tags' : `All ${tags.length} tags`}
              </button>
            )}
          </section>

          <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
            <h2 className="font-wfmono text-[11px] font-semibold uppercase tracking-[0.14em] text-wf-primary">
              About this corpus
            </h2>
            <dl className="mt-3 space-y-2 text-[13px] text-wf-on-surface-variant">
              <div className="flex justify-between gap-3">
                <dt>Analyses</dt>
                <dd className="font-wfmono text-wf-on-surface">{manifest.data ? analyses.length : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>With English edition</dt>
                <dd className="font-wfmono text-wf-on-surface">{manifest.data ? englishCount : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Source articles</dt>
                <dd className="font-wfmono text-wf-on-surface">
                  {manifest.data ? manifest.data.length - analyses.length : '—'}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-wf-on-surface-variant">
              Articles are authored in Notion by the article cadences and exported on each deploy of the
              reader site. This page reads that export directly, so both surfaces always show the same
              text.
            </p>
          </section>
        </aside>
      </div>
    </PublicShell>
  );
}
