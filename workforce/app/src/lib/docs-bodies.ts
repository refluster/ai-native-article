// The public documents' bodies, bundled with Vite's `?raw` import.
//
// Kept apart from lib/docs.ts (the metadata) so only the document page
// pulls the ~250 KB of HTML into its chunk; App.tsx lazy-loads that page.
// Every manifest row must have a body here — a missing one throws at
// module load (C-4) rather than rendering an empty document.

import { PUBLIC_DOCS } from './docs';
import capabilities from '../content/docs/capabilities.html?raw';
import whitepaper from '../content/docs/whitepaper.html?raw';
import foundingStory from '../content/docs/founding-story.html?raw';
import manifesto from '../content/docs/manifesto.html?raw';
import bookProduction from '../content/docs/book-production.html?raw';

const BODIES: Readonly<Record<string, string>> = {
  capabilities,
  whitepaper,
  'founding-story': foundingStory,
  manifesto,
  'book-production': bookProduction,
};

for (const d of PUBLIC_DOCS) {
  if (!BODIES[d.slug]) throw new Error(`docs: no bundled body for "${d.slug}" (${d.file})`);
}

/** The document body: a sequence of `<section>`s, the first one `.cover`. */
export function docBody(slug: string): string {
  const html = BODIES[slug];
  if (!html) throw new Error(`docs: unknown document "${slug}"`);
  return html;
}
