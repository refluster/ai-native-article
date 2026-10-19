// The public documents registry: what the Docs index lists, what a doc
// page injects, and where the pre-SPA URLs go.

import { describe, it, expect } from 'vitest';
import {
  DOC_LANGUAGES,
  DOCS_FALLBACK_LANGUAGE,
  PUBLIC_DOCS,
  docEdition,
  docPath,
  docsIndexPath,
  editionQuery,
  findDoc,
  internalNavigationTarget,
  legacyDocRedirect,
  validateDocRow,
  withEdition,
  type DocLanguage,
} from './docs';
import { loadDocBody } from './docs-bodies';

/** Every (document, edition) pair with its body. */
const EDITIONS = await Promise.all(
  PUBLIC_DOCS.flatMap(d =>
    DOC_LANGUAGES.map(async lang => ({ slug: d.slug, lang, edition: d.editions[lang], html: await loadDocBody(d.slug, lang) })),
  ),
);
const BODY = new Map(EDITIONS.map(e => [`${e.slug}/${e.lang}`, e.html]));
const docBody = (slug: string, lang: DocLanguage) => BODY.get(`${slug}/${lang}`)!;

/** The body's cover kicker, first `·` segment — what the manifest kicker must equal. */
function coverKicker(html: string): string {
  const m = html.match(/<div class="kicker">([^<]*)<\/div>/);
  return (m?.[1] ?? '').split('·')[0].trim();
}

/** The `id`s a body declares, in order — the skeleton a translation must keep. */
function idsOf(html: string): string[] {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
}

describe('PUBLIC_DOCS', () => {
  it('resolves the book-production process page, written in Japanese, in both editions', () => {
    const doc = findDoc('book-production');
    expect(doc?.original).toBe('ja');
    expect(docEdition(doc!, 'ja').packTitle).toBe('本をつくる工程');
    const ja = docBody('book-production', 'ja');
    expect(ja).toContain('<section class="cover">');
    expect(ja).toContain('工程図');
    expect(ja.length).toBeGreaterThan(10_000);
    const en = docBody('book-production', 'en');
    expect(en).toContain('<section class="cover">');
    expect(en).not.toContain('工程図');
    expect(docEdition(doc!, 'en').packTitle).not.toBe(docEdition(doc!, 'ja').packTitle);
  });

  it('registers the six documents, each with a bundled body in both languages', async () => {
    expect(PUBLIC_DOCS.map(d => d.slug)).toEqual([
      'capabilities',
      'whitepaper',
      'founding-story',
      'manifesto',
      'book-production',
      'asp-cloud-dev-review',
    ]);
    for (const e of EDITIONS) {
      expect(e.html.length, `${e.slug} ${e.lang} body`).toBeGreaterThan(10_000);
      expect(e.html.trimStart().startsWith('<section class="cover">'), `${e.slug} ${e.lang} opens with its cover`).toBe(true);
      expect(e.edition.file, `${e.slug} ${e.lang} file name`).toBe(`${e.slug}.${e.lang}.html`);
    }
    await expect(loadDocBody('roadmap', 'en')).rejects.toThrow(/unknown document/);
  });

  it('refuses a malformed manifest row at load (C-4)', () => {
    const good = () => JSON.parse(JSON.stringify(PUBLIC_DOCS[0])) as Record<string, unknown>;
    expect(validateDocRow(good()).slug).toBe('capabilities');
    const bad: [string, (m: Record<string, unknown>) => void][] = [
      ['no editions', m => delete m.editions],
      ['no en edition', m => delete (m.editions as Record<string, unknown>).en],
      ['no ja edition', m => delete (m.editions as Record<string, unknown>).ja],
      ['an empty cta', m => (((m.editions as Record<string, Record<string, unknown>>).ja.cta = ''), undefined)],
      ['no file', m => delete (m.editions as Record<string, Record<string, unknown>>).en.file],
      ['no packTitle', m => delete (m.editions as Record<string, Record<string, unknown>>).en.packTitle],
      ['a bad original', m => (m.original = 'fr')],
      ['a bad measure', m => (m.measure = 'huge')],
      ['no slug', m => delete m.slug],
    ];
    for (const [name, mutate] of bad) {
      const row = good();
      mutate(row);
      expect(() => validateDocRow(row), name).toThrow(/malformed row/);
    }
    expect(() => validateDocRow(null)).toThrow(/malformed row/);
  });

  it('falls back to English for a reader who names neither language', () => {
    expect(DOCS_FALLBACK_LANGUAGE).toBe('en');
  });

  it('names the founding story with the numeral and no trailing full stop', () => {
    const doc = findDoc('founding-story')!;
    expect(doc.original).toBe('ja');
    expect(docEdition(doc, 'ja').title).toBe('人間ひとり、AI 58体');
    expect(docBody('founding-story', 'ja')).toContain('<h1>人間ひとり、<br>AI 58体</h1>');
    expect(docBody('founding-story', 'ja')).not.toContain('五十八');
  });

  // A translation is the same document in other words: the two editions
  // must declare the same anchors (sections, figures) in the same order so
  // a deep link (`#s7`) and the table of contents mean the same thing in
  // either language, and must link to the same documents.
  it('the two editions of a document share one skeleton of ids and cross-links', () => {
    for (const d of PUBLIC_DOCS) {
      const ja = docBody(d.slug, 'ja');
      const en = docBody(d.slug, 'en');
      expect(idsOf(en), `${d.slug}: ids`).toEqual(idsOf(ja));
      const links = (html: string) => [...html.matchAll(/href="(\/docs\/[^"]+)"/g)].map(m => m[1]);
      expect(links(en), `${d.slug}: /docs links`).toEqual(links(ja));
      expect((en.match(/<section\b/g) ?? []).length, `${d.slug}: section count`).toBe((ja.match(/<section\b/g) ?? []).length);
    }
  });

  it('each edition is written in its own language', () => {
    const cjk = (html: string) => (html.replace(/<[^>]+>/g, ' ').match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
    for (const d of PUBLIC_DOCS) {
      const ja = cjk(docBody(d.slug, 'ja'));
      const en = cjk(docBody(d.slug, 'en'));
      expect(ja, `${d.slug}: Japanese edition has Japanese text`).toBeGreaterThan(1_000);
      expect(en, `${d.slug}: English edition has no Japanese body text`).toBeLessThan(ja / 20);
      for (const lang of DOC_LANGUAGES as DocLanguage[]) {
        const e = d.editions[lang];
        expect(e.kicker, `${d.slug} ${lang}: no language marker in the kicker`).not.toMatch(/日本語|Japanese|English/);
        expect(e.kicker, `${d.slug} ${lang}: manifest kicker = cover kicker's first segment`).toBe(coverKicker(docBody(d.slug, lang)));
      }
    }
  });

  // The fragments were lifted out of standalone pages. Anything of that
  // page's own chrome or typography left inside would fight the shell's
  // (a second <header>, a page <footer>, a <title>, the old font stack).
  it('bodies carry no page chrome from their static-page days', () => {
    for (const e of EDITIONS) {
      const outsideSvg = e.html.replace(/<svg[\s\S]*?<\/svg>/g, '');
      expect(outsideSvg, `${e.slug} ${e.lang}: header/footer`).not.toMatch(/<(header|footer|html|head|body)\b/);
      expect(outsideSvg, `${e.slug} ${e.lang}: <title>`).not.toMatch(/<title\b/);
      expect(outsideSvg, `${e.slug} ${e.lang}: page <style>`).not.toMatch(/<style\b/);
      expect(e.html, `${e.slug} ${e.lang}: old typefaces`).not.toMatch(/Familjen|Source Sans|IBM Plex/);
    }
  });

  // Links between documents go through the router, and every one of them
  // must resolve — a dead cross-reference is a content bug, caught here
  // rather than by a reader.
  it('cross-links between documents point at registered slugs, not .html objects', () => {
    for (const e of EDITIONS) {
      const hrefs = [...e.html.matchAll(/href="\/docs\/([^"#]+)/g)].map(m => m[1]);
      for (const target of hrefs) {
        expect(target, `${e.slug} ${e.lang} → ${target}`).not.toMatch(/\.html$/);
        expect(findDoc(target), `${e.slug} ${e.lang} links to unknown doc "${target}"`).toBeDefined();
      }
    }
  });

  it('table-of-contents anchors resolve to a section id in the same body', () => {
    for (const e of EDITIONS) {
      const anchors = [...e.html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
      for (const id of anchors) {
        expect(e.html, `${e.slug} ${e.lang}: #${id}`).toMatch(new RegExp(`id="${id}"`));
      }
    }
  });
});

describe('legacyDocRedirect', () => {
  it('forwards the old S3 object names to the router routes', () => {
    expect(legacyDocRedirect('index.html')).toBe('/docs');
    expect(legacyDocRedirect('whitepaper.html')).toBe('/docs/whitepaper');
    expect(legacyDocRedirect('founding-story.html')).toBe('/docs/founding-story');
  });
  it('keeps the edition and the section of a shared legacy link', () => {
    expect(legacyDocRedirect('founding-story.html', '?lang=en', '#s3')).toBe('/docs/founding-story?lang=en#s3');
    expect(legacyDocRedirect('index.html', '?lang=ja', '')).toBe('/docs?lang=ja');
  });
  it('leaves current slugs alone', () => {
    expect(legacyDocRedirect('whitepaper')).toBeNull();
    expect(legacyDocRedirect('')).toBeNull();
  });
  it('docPath encodes', () => {
    expect(docPath('founding-story')).toBe('/docs/founding-story');
  });
});

describe('edition carry-over', () => {
  it('reads only a valid ?lang= from the current URL', () => {
    expect(editionQuery('?lang=en')).toBe('?lang=en');
    expect(editionQuery('?tag=x&lang=ja')).toBe('?lang=ja');
    expect(editionQuery('?lang=EN')).toBe('');
    expect(editionQuery('?lang=fr')).toBe('');
    expect(editionQuery('')).toBe('');
  });
  it('adds the edition to a target that names none, after the query and before the hash', () => {
    expect(withEdition('/docs/whitepaper', '?lang=en')).toBe('/docs/whitepaper?lang=en');
    expect(withEdition('/docs/whitepaper#s10', '?lang=en')).toBe('/docs/whitepaper?lang=en#s10');
    expect(withEdition('/docs/whitepaper?x=1#s10', '?lang=ja')).toBe('/docs/whitepaper?x=1&lang=ja#s10');
    expect(withEdition('/docs/whitepaper?lang=ja', '?lang=en')).toBe('/docs/whitepaper?lang=ja');
    expect(withEdition('/docs/whitepaper#s10', '')).toBe('/docs/whitepaper#s10');
  });
  it('docPath and docsIndexPath carry the current edition', () => {
    expect(docPath('manifesto', '?lang=en')).toBe('/docs/manifesto?lang=en');
    expect(docPath('manifesto', '?page=2')).toBe('/docs/manifesto');
    expect(docsIndexPath('?lang=ja')).toBe('/docs?lang=ja');
    expect(docsIndexPath()).toBe('/docs');
  });
  it('no document body hard-codes an edition into a link', () => {
    for (const e of EDITIONS) expect(e.html, `${e.slug} ${e.lang}`).not.toMatch(/href="[^"]*[?&]lang=/);
  });
});

describe('internalNavigationTarget', () => {
  const here = { origin: 'https://workforce.example', pathname: '/docs/whitepaper' };
  const plainClick = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };
  const anchor = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({
    href,
    target: extra.target ?? '',
    hasAttribute: (name: string) => name === 'download' && Boolean(extra.download),
  });

  it('routes a same-origin document link through the SPA', () => {
    expect(internalNavigationTarget(anchor('https://workforce.example/docs/manifesto'), here, plainClick)).toBe('/docs/manifesto');
    expect(internalNavigationTarget(anchor('https://workforce.example/docs/founding-story#s4'), here, plainClick)).toBe(
      '/docs/founding-story#s4',
    );
  });
  it('leaves a same-page anchor (the table of contents) to the browser', () => {
    expect(internalNavigationTarget(anchor('https://workforce.example/docs/whitepaper#s7'), here, plainClick)).toBeNull();
  });
  it('leaves other origins, new tabs, downloads and modified clicks to the browser', () => {
    expect(internalNavigationTarget(anchor('https://kohuehara.xyz/ai-native-article/'), here, plainClick)).toBeNull();
    expect(internalNavigationTarget(anchor('https://workforce.example/docs/manifesto', { target: '_blank' }), here, plainClick)).toBeNull();
    expect(internalNavigationTarget(anchor('https://workforce.example/x.pdf', { download: true }), here, plainClick)).toBeNull();
    expect(internalNavigationTarget(anchor('https://workforce.example/docs/manifesto'), here, { ...plainClick, metaKey: true })).toBeNull();
    expect(internalNavigationTarget(anchor('https://workforce.example/docs/manifesto'), here, { ...plainClick, button: 1 })).toBeNull();
  });
});
