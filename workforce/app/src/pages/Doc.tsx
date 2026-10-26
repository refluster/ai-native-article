// One public document (/docs/:slug), in the public shell.
//
// The body is an HTML fragment loaded on demand for the edition being read
// (lib/docs-bodies.ts, one chunk per file), injected as-is and
// styled by `.docs-prose` (index.css) — the same tokens, type and spacing
// the rest of the public site uses. Links inside the body that point at
// this origin are routed through the SPA so a reader moving between the
// whitepaper and the founding story never reloads; `#anchor` links (the
// table of contents) are left to the browser.
//
// Every document has a Japanese and an English edition. The edition is
// resolved as on Research (`?lang=` → localStorage → browser → ja) and
// switched with the same JA / EN pill, placed at the right end of the
// breadcrumb row. What comes from the manifest (body, title, kicker, the
// cards under the body) follows the edition; the chrome around it stays
// English. A `?lang=` in the URL is carried onto every Docs link this page
// renders, so a shared link keeps its edition across documents. See
// workforce/docs/design/public-docs-bilingual.md.
//
// Pre-SPA spellings (`/docs/whitepaper.html`, `/docs/index.html`) reach
// this route through CloudFront's 404 fallback and are forwarded.

import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import LinkCard from '../components/public/LinkCard';
import LanguageToggle from '../components/public/LanguageToggle';
import { SkeletonText } from '../components/Skeleton';
import { CARD, KICKER, KICKER_ACCENT, TEXT_LINK } from '../components/public/styles';
import { SITE_DISPLAY_NAME } from '../config/site';
import {
  DOCS_FALLBACK_LANGUAGE,
  PUBLIC_DOCS,
  docEdition,
  docPath,
  docsIndexPath,
  findDoc,
  internalNavigationTarget,
  legacyDocRedirect,
  withEdition,
} from '../lib/docs';
import { loadDocBody } from '../lib/docs-bodies';
import { useAsync } from '../lib/useAsync';
import { useResearchLanguage } from '../lib/useResearchLanguage';

/**
 * The section the reader is in: the last `<section id>` whose top has
 * passed the viewport's top edge (with a little slack for the section's
 * own padding). Null above the first one.
 */
export function currentSectionId(sections: Iterable<{ id: string; top: number }>, slack = 24): string | null {
  let current: string | null = null;
  for (const s of sections) {
    if (s.top <= slack) current = s.id;
    else break;
  }
  return current;
}

/** `scrollIntoView` is missing from some embedders (jsdom); a page must
 *  still render there. */
function reveal(el: Element | null | undefined) {
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView();
}

export default function Doc() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  const lang = useResearchLanguage(DOCS_FALLBACK_LANGUAGE);
  const legacy = legacyDocRedirect(slug, search, hash);
  const doc = legacy ? undefined : findDoc(slug);
  const edition = doc ? docEdition(doc, lang) : undefined;
  // The body carries the edition it was loaded for: between the toggle
  // press and the new body's arrival the route already says the new
  // language while the DOM still holds the old body, and the scroll
  // bookkeeping below must follow the DOM, not the route.
  const body = useAsync(
    async () => (doc ? { slug: doc.slug, lang, html: await loadDocBody(doc.slug, lang) } : null),
    [doc?.slug, lang],
  );
  const html = body.data?.html;
  const htmlSlug = body.data?.slug;
  const htmlLang = body.data?.lang;
  const articleRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<string | null>(null);
  const shown = useRef<{ slug: string; lang: string } | null>(null);

  useEffect(() => {
    if (!edition) return;
    document.title = `${edition.packTitle} — ${SITE_DISPLAY_NAME}`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, [edition]);

  // The moment the route's edition changes, note which section the reader
  // is in — while the body they were reading is still in the DOM and the
  // scroll position is still theirs. (A scroll listener would see the page
  // collapse to its skeleton and lose the section.) A switch of edition
  // then lands on that section of the other body: the two bodies differ
  // in length, so neither a kept pixel offset nor the top of the page
  // would be where they were.
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article || !shown.current || shown.current.lang === lang) return;
    sectionRef.current = currentSectionId(
      [...article.querySelectorAll<HTMLElement>('section[id]')].map(el => ({ id: el.id, top: el.getBoundingClientRect().top })),
    );
  }, [lang]);

  // Once a body is in the DOM: a fresh document opens at its top, or at
  // the section a `#s7` link names; a switch of edition on the same
  // document returns to the section the reader was in. The body arrives
  // asynchronously and this component stays mounted across documents, so
  // the bookkeeping follows the loaded body's slug and edition, never the
  // route's — between a click on `/docs/whitepaper#s10` and the
  // whitepaper's arrival, the route already says whitepaper while the DOM
  // still holds the previous document.
  useLayoutEffect(() => {
    if (!html || !htmlSlug || !htmlLang) return;
    const prev = shown.current;
    shown.current = { slug: htmlSlug, lang: htmlLang };
    if (!prev || prev.slug !== htmlSlug) {
      sectionRef.current = null;
      const target = hash ? document.getElementById(hash.slice(1)) : null;
      if (target) reveal(target);
      else window.scrollTo({ top: 0 });
    } else if (prev.lang !== htmlLang) {
      const id = sectionRef.current;
      reveal((id && document.getElementById(id)) || articleRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, htmlSlug, htmlLang]);

  if (legacy) return <Navigate to={legacy} replace />;

  function onBodyClick(e: MouseEvent<HTMLElement>) {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const to = internalNavigationTarget(anchor, window.location, e);
    if (!to) return;
    e.preventDefault();
    navigate(withEdition(to, search));
  }

  const indexPath = docsIndexPath(search);

  if (!doc || !edition) {
    return (
      <PublicShell>
        <nav className={`pt-8 ${KICKER}`} aria-label="Breadcrumb">
          <Link to={indexPath} className="hover:text-wf-on-surface underline underline-offset-2">
            Docs
          </Link>
        </nav>
        <div className={`mt-10 ${CARD} p-6`}>
          <p className={KICKER_ACCENT}>Not found</p>
          <h1 className="mt-2 font-headline font-bold text-2xl">There is no document called “{slug}”.</h1>
          <p className="mt-2 text-sm text-wf-on-surface-variant">The documents that exist are listed on the Docs index.</p>
          <Link to={indexPath} className={`inline-block mt-5 ${TEXT_LINK} underline underline-offset-2`}>
            ← All docs
          </Link>
        </div>
      </PublicShell>
    );
  }

  const others = PUBLIC_DOCS.filter(d => d.slug !== doc.slug);
  const cardLang = lang === 'ja' ? 'ja' : undefined;

  return (
    <PublicShell>
      <div className={doc.measure === 'narrow' ? 'max-w-[820px]' : ''}>
        <nav
          className={`pt-8 ${KICKER} flex flex-wrap items-center justify-between gap-x-6 gap-y-3`}
          aria-label="Breadcrumb"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Link to={indexPath} className="hover:text-wf-on-surface underline underline-offset-2">
              Docs
            </Link>
            <span aria-hidden>/</span>
            <span lang={cardLang}>{edition.kicker}</span>
          </div>
          <LanguageToggle value={lang} label="Document edition" />
        </nav>

        {body.error && (
          <div role="alert" className={`mt-8 ${CARD} p-6`}>
            <p className={KICKER_ACCENT}>Could not load this edition</p>
            <p className="mt-2 text-sm text-wf-on-surface-variant">{body.error}</p>
          </div>
        )}
        {body.loading && (
          <div className="pt-12" aria-busy="true" aria-live="polite" aria-label="Loading document">
            <SkeletonText lines={3} />
            <SkeletonText lines={8} className="mt-8" />
          </div>
        )}
        {/* The fragment is repo-authored and bundled at build time — the
            same trust as any component in src/ — so innerHTML is safe. */}
        {html && (
          <article
            ref={articleRef}
            className={`docs-prose${doc.measure === 'narrow' ? ' is-narrow' : ''}`}
            lang={htmlLang}
            onClick={onBodyClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        <section className="pt-10 pb-6" aria-label="Continue reading">
          <h2 className={KICKER}>Continue reading</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {others.map(d => {
              const e = docEdition(d, lang);
              return (
                <LinkCard
                  key={d.slug}
                  to={docPath(d.slug, search)}
                  kicker={e.kicker}
                  title={e.title}
                  description={e.description}
                  lang={cardLang}
                />
              );
            })}
          </div>
          <Link to={indexPath} className={`inline-block mt-6 ${TEXT_LINK}`}>
            ← All docs
          </Link>
        </section>
      </div>
    </PublicShell>
  );
}
