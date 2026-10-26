// The public documents' bodies, one lazy chunk per edition file.
//
// `import.meta.glob` over src/content/docs/*.html turns each body into its
// own `?raw` chunk, fetched when a reader opens that document in that
// edition — so reading one edition of one document costs that body
// (28–200 KB), not every edition of every document. The glob is also the
// only registry of bodies: a new document is one manifest row plus its two
// files, nothing to edit here.
//
// Every manifest edition must have a file in the glob — a missing one
// throws at module load (C-4), before any reader can hit it, rather than
// rendering an empty document.
//
// The asp-cloud development review (asp-cloud-dev-review) is the first
// document whose numbers come from an external project's repo — the
// source report is PSVL/asp-cloud docs/reports/dev-review-pr1000-2026-10-10.md.

import { DOC_LANGUAGES, PUBLIC_DOCS, type DocLanguage } from './docs';

const LOADERS = import.meta.glob<string>('../content/docs/*.html', { query: '?raw', import: 'default' });

/** Loader per bare file name (`capabilities.en.html`). */
const BY_FILE: ReadonlyMap<string, () => Promise<string>> = new Map(
  Object.entries(LOADERS).map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1), load]),
);

for (const d of PUBLIC_DOCS) {
  for (const lang of DOC_LANGUAGES) {
    const file = d.editions[lang].file;
    if (!BY_FILE.has(file)) throw new Error(`docs: no bundled body for "${d.slug}" (${lang}: ${file})`);
  }
}

/** The document body in one edition: a sequence of `<section>`s, the
 *  first one `.cover`. Rejects for an unknown document. */
export function loadDocBody(slug: string, lang: DocLanguage): Promise<string> {
  const doc = PUBLIC_DOCS.find(d => d.slug === slug);
  const load = doc && BY_FILE.get(doc.editions[lang].file);
  if (!load) return Promise.reject(new Error(`docs: unknown document "${slug}" (${lang})`));
  return load();
}
