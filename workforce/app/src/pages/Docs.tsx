// Docs index — the public documents, one card each. Public, outside
// AuthBoundary, linked from the public header beside Research. Replaces
// the static /docs/index.html; the old URL forwards here (App.tsx).
//
// Every document has a Japanese and an English edition; the JA / EN pill
// in the hero is the Research surface's, resolving the edition the same
// way (`?lang=` → localStorage → browser → ja). The cards' words come
// from the manifest and follow the edition; the chrome around them
// (kicker, title, lede) is site chrome and stays English — see
// workforce/docs/design/public-docs-bilingual.md.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import PageHero from '../components/public/PageHero';
import LinkCard from '../components/public/LinkCard';
import LanguageToggle from '../components/public/LanguageToggle';
import { SITE_DISPLAY_NAME } from '../config/site';
import { DOCS_FALLBACK_LANGUAGE, PUBLIC_DOCS, docEdition, docPath } from '../lib/docs';
import { useResearchLanguage } from '../lib/useResearchLanguage';

export default function Docs() {
  const lang = useResearchLanguage(DOCS_FALLBACK_LANGUAGE);
  const { search } = useLocation();

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
        aside={<LanguageToggle value={lang} label="Document edition" />}
        lede="What this organization delivers, how it is built, and what it believes. The documents stand alone; read any first. Each is published in Japanese and English."
      />
      <section className="pb-6 grid gap-4">
        {PUBLIC_DOCS.map(doc => {
          const edition = docEdition(doc, lang);
          return (
            <LinkCard
              key={doc.slug}
              to={docPath(doc.slug, search)}
              kicker={edition.kicker}
              title={edition.title}
              description={edition.description}
              cta={edition.cta}
              lang={lang === 'ja' ? 'ja' : undefined}
              size="lg"
            />
          );
        })}
      </section>
    </PublicShell>
  );
}
