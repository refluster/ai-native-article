// The public documents registry: what the Docs index lists, what a doc
// page injects, and where the pre-SPA URLs go.

import { describe, it, expect } from 'vitest';
import { PUBLIC_DOCS, docPath, findDoc, internalNavigationTarget, legacyDocRedirect } from './docs';
import { docBody } from './docs-bodies';

const DOCS = PUBLIC_DOCS.map(d => ({ ...d, html: docBody(d.slug) }));

describe('PUBLIC_DOCS', () => {
  it('registers the three documents, each with a bundled body', () => {
    expect(PUBLIC_DOCS.map(d => d.slug)).toEqual(['whitepaper', 'founding-story', 'manifesto']);
    for (const d of DOCS) {
      expect(d.html.length, `${d.slug} body`).toBeGreaterThan(10_000);
      expect(d.html.trimStart().startsWith('<section class="cover">'), `${d.slug} opens with its cover`).toBe(true);
    }
    expect(() => docBody('roadmap')).toThrow(/unknown document/);
  });

  // The fragments were lifted out of standalone pages. Anything of that
  // page's own chrome or typography left inside would fight the shell's
  // (a second <header>, a page <footer>, a <title>, the old font stack).
  it('bodies carry no page chrome from their static-page days', () => {
    for (const d of DOCS) {
      const outsideSvg = d.html.replace(/<svg[\s\S]*?<\/svg>/g, '');
      expect(outsideSvg, `${d.slug}: header/footer`).not.toMatch(/<(header|footer|html|head|body)\b/);
      expect(outsideSvg, `${d.slug}: <title>`).not.toMatch(/<title\b/);
      expect(outsideSvg, `${d.slug}: page <style>`).not.toMatch(/<style\b/);
      expect(d.html, `${d.slug}: old typefaces`).not.toMatch(/Familjen|Source Sans|IBM Plex/);
    }
  });

  // Links between documents go through the router, and every one of them
  // must resolve — a dead cross-reference is a content bug, caught here
  // rather than by a reader.
  it('cross-links between documents point at registered slugs, not .html objects', () => {
    for (const d of DOCS) {
      const hrefs = [...d.html.matchAll(/href="\/docs\/([^"#]+)/g)].map(m => m[1]);
      for (const target of hrefs) {
        expect(target, `${d.slug} → ${target}`).not.toMatch(/\.html$/);
        expect(findDoc(target), `${d.slug} links to unknown doc "${target}"`).toBeDefined();
      }
    }
  });

  it('table-of-contents anchors resolve to a section id in the same body', () => {
    for (const d of DOCS) {
      const anchors = [...d.html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
      for (const id of anchors) {
        expect(d.html, `${d.slug}: #${id}`).toMatch(new RegExp(`id="${id}"`));
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
  it('leaves current slugs alone', () => {
    expect(legacyDocRedirect('whitepaper')).toBeNull();
    expect(legacyDocRedirect('')).toBeNull();
  });
  it('docPath encodes', () => {
    expect(docPath('founding-story')).toBe('/docs/founding-story');
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
