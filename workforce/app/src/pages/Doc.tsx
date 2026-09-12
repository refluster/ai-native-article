// One public document (/docs/:slug), in the public shell.
//
// The body is a bundled HTML fragment (lib/docs-bodies.ts) injected as-is and
// styled by `.docs-prose` (index.css) — the same tokens, type and spacing
// the rest of the public site uses. Links inside the body that point at
// this origin are routed through the SPA so a reader moving between the
// whitepaper and the founding story never reloads; `#anchor` links (the
// table of contents) are left to the browser.
//
// Pre-SPA spellings (`/docs/whitepaper.html`, `/docs/index.html`) reach
// this route through CloudFront's 404 fallback and are forwarded.

import { useEffect, type MouseEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import LinkCard from '../components/public/LinkCard';
import { CARD, KICKER, KICKER_ACCENT, TEXT_LINK } from '../components/public/styles';
import { SITE_DISPLAY_NAME } from '../config/site';
import { PUBLIC_DOCS, docPath, findDoc, internalNavigationTarget, legacyDocRedirect } from '../lib/docs';
import { docBody } from '../lib/docs-bodies';

export default function Doc() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const legacy = legacyDocRedirect(slug);
  const doc = legacy ? undefined : findDoc(slug);

  useEffect(() => {
    if (!doc) return;
    document.title = `${doc.packTitle} — ${SITE_DISPLAY_NAME}`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, [doc]);

  // A fresh document opens at its top; a link into a section (`#s7`) opens
  // at that section. The body is synchronous, so the target exists on the
  // first paint and one scroll after mount is enough.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0 });
  }, [slug]);

  if (legacy) return <Navigate to={legacy} replace />;

  function onBodyClick(e: MouseEvent<HTMLElement>) {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const to = internalNavigationTarget(anchor, window.location, e);
    if (!to) return;
    e.preventDefault();
    navigate(to);
  }

  if (!doc) {
    return (
      <PublicShell>
        <nav className={`pt-8 ${KICKER}`} aria-label="Breadcrumb">
          <Link to="/docs" className="hover:text-wf-on-surface underline underline-offset-2">
            Docs
          </Link>
        </nav>
        <div className={`mt-10 ${CARD} p-6`}>
          <p className={KICKER_ACCENT}>Not found</p>
          <h1 className="mt-2 font-headline font-bold text-2xl">There is no document called “{slug}”.</h1>
          <p className="mt-2 text-sm text-wf-on-surface-variant">The documents that exist are listed on the Docs index.</p>
          <Link to="/docs" className={`inline-block mt-5 ${TEXT_LINK} underline underline-offset-2`}>
            ← All docs
          </Link>
        </div>
      </PublicShell>
    );
  }

  const others = PUBLIC_DOCS.filter(d => d.slug !== doc.slug);

  return (
    <PublicShell>
      <div className={doc.measure === 'narrow' ? 'max-w-[820px]' : ''}>
        <nav className={`pt-8 ${KICKER} flex items-center gap-1.5`} aria-label="Breadcrumb">
          <Link to="/docs" className="hover:text-wf-on-surface underline underline-offset-2">
            Docs
          </Link>
          <span aria-hidden>/</span>
          <span>{doc.kicker}</span>
        </nav>

        {/* The fragment is repo-authored and bundled at build time — the
            same trust as any component in src/ — so innerHTML is safe. */}
        <article
          className={`docs-prose${doc.measure === 'narrow' ? ' is-narrow' : ''}`}
          lang={doc.lang}
          onClick={onBodyClick}
          dangerouslySetInnerHTML={{ __html: docBody(doc.slug) }}
        />

        <section className="pt-10 pb-6" aria-label="Continue reading">
          <h2 className={KICKER}>Continue reading</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {others.map(d => (
              <LinkCard
                key={d.slug}
                to={docPath(d.slug)}
                kicker={d.kicker}
                title={d.title}
                description={d.description}
                lang={d.lang === 'ja' ? 'ja' : undefined}
              />
            ))}
          </div>
          <Link to="/docs" className={`inline-block mt-6 ${TEXT_LINK}`}>
            ← All docs
          </Link>
        </section>
      </div>
    </PublicShell>
  );
}
