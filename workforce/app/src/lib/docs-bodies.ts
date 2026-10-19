// The public documents' bodies, both editions, bundled with Vite's `?raw`
// import. The asp-cloud development review (asp-cloud-dev-review) is the
// first document whose numbers come from an external project's repo — the
// source report is PSVL/asp-cloud docs/reports/dev-review-pr1000-2026-10-10.md.
//
// Kept apart from lib/docs.ts (the metadata) so only the document page
// pulls the ~1 MB of HTML into its chunk; App.tsx lazy-loads that page.
// Every manifest edition must have a body here — a missing one throws at
// module load (C-4) rather than rendering an empty document.

import { DOC_LANGUAGES, PUBLIC_DOCS, type DocLanguage } from './docs';
import capabilitiesEn from '../content/docs/capabilities.en.html?raw';
import capabilitiesJa from '../content/docs/capabilities.ja.html?raw';
import whitepaperEn from '../content/docs/whitepaper.en.html?raw';
import whitepaperJa from '../content/docs/whitepaper.ja.html?raw';
import foundingStoryJa from '../content/docs/founding-story.ja.html?raw';
import foundingStoryEn from '../content/docs/founding-story.en.html?raw';
import manifestoEn from '../content/docs/manifesto.en.html?raw';
import manifestoJa from '../content/docs/manifesto.ja.html?raw';
import bookProductionJa from '../content/docs/book-production.ja.html?raw';
import bookProductionEn from '../content/docs/book-production.en.html?raw';
import aspCloudDevReviewJa from '../content/docs/asp-cloud-dev-review.ja.html?raw';
import aspCloudDevReviewEn from '../content/docs/asp-cloud-dev-review.en.html?raw';

/** Keyed by the edition's `file` name in manifest.json. */
const BODIES: Readonly<Record<string, string>> = {
  'capabilities.en.html': capabilitiesEn,
  'capabilities.ja.html': capabilitiesJa,
  'whitepaper.en.html': whitepaperEn,
  'whitepaper.ja.html': whitepaperJa,
  'founding-story.ja.html': foundingStoryJa,
  'founding-story.en.html': foundingStoryEn,
  'manifesto.en.html': manifestoEn,
  'manifesto.ja.html': manifestoJa,
  'book-production.ja.html': bookProductionJa,
  'book-production.en.html': bookProductionEn,
  'asp-cloud-dev-review.ja.html': aspCloudDevReviewJa,
  'asp-cloud-dev-review.en.html': aspCloudDevReviewEn,
};

for (const d of PUBLIC_DOCS) {
  for (const lang of DOC_LANGUAGES) {
    const file = d.editions[lang].file;
    if (!BODIES[file]) throw new Error(`docs: no bundled body for "${d.slug}" (${lang}: ${file})`);
  }
}

/** The document body in one edition: a sequence of `<section>`s, the
 *  first one `.cover`. */
export function docBody(slug: string, lang: DocLanguage): string {
  const doc = PUBLIC_DOCS.find(d => d.slug === slug);
  const html = doc && BODIES[doc.editions[lang].file];
  if (!html) throw new Error(`docs: unknown document "${slug}" (${lang})`);
  return html;
}
