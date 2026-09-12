// Docs index — the public documents, one card each. Public, outside
// AuthBoundary, linked from the public header beside Research. Replaces
// the static /docs/index.html; the old URL forwards here (App.tsx).

import { useEffect } from 'react';
import PublicShell from '../components/PublicShell';
import PageHero from '../components/public/PageHero';
import LinkCard from '../components/public/LinkCard';
import { SITE_DISPLAY_NAME } from '../config/site';
import { PUBLIC_DOCS, docPath } from '../lib/docs';

export default function Docs() {
  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Docs`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, []);

  return (
    <PublicShell>
      <PageHero
        kicker="Documentation"
        title="Docs"
        lede="How this organization is built, and what it believes. The documents stand alone; read any first. The founding story is in Japanese."
      />
      <section className="pb-6 grid gap-4">
        {PUBLIC_DOCS.map(doc => (
          <LinkCard
            key={doc.slug}
            to={docPath(doc.slug)}
            kicker={doc.kicker}
            title={doc.title}
            description={doc.description}
            cta={doc.cta}
            lang={doc.lang === 'ja' ? 'ja' : undefined}
            size="lg"
          />
        ))}
      </section>
    </PublicShell>
  );
}
