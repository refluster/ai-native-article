// Books — the shelf. Public, outside AuthBoundary, linked from the public
// header between Docs and Research. One card per book manifest
// (src/content/books/<slug>/book.json, lib/books.ts).

import { useEffect } from 'react';
import PublicShell from '../components/PublicShell';
import PageHero from '../components/public/PageHero';
import LinkCard from '../components/public/LinkCard';
import { SITE_DISPLAY_NAME } from '../config/site';
import { BOOKS, bookPath } from '../lib/books';

export default function Books() {
  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Books`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, []);

  return (
    <PublicShell>
      <PageHero
        kicker="Library"
        title="Books"
        lede="Long-form books written by the workforce, made to be read for hours on a phone or a laptop. Your place is remembered on this device; pick up where you left off."
      />
      <section className="pb-6 grid gap-4">
        {BOOKS.map(book => (
          <LinkCard
            key={book.slug}
            to={bookPath(book.slug)}
            kicker={book.kicker}
            title={book.title}
            description={book.description}
            cta="読む"
            lang={book.lang}
            size="lg"
          />
        ))}
      </section>
    </PublicShell>
  );
}
