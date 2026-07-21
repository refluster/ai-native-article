import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { extractMermaidSource, reportPath, sortReports, type ReportMeta } from './reports';

const meta = (over: Partial<ReportMeta>): ReportMeta => ({
  project: 'project-ind',
  slug: 'r',
  title: 't',
  date: '2026-07-21',
  ...over,
});

describe('sortReports', () => {
  it('orders newest first, then by project/slug for stability', () => {
    const rows = [
      meta({ slug: 'b', date: '2026-07-01' }),
      meta({ slug: 'a', date: '2026-07-21' }),
      meta({ project: 'asp-cloud', slug: 'c', date: '2026-07-21' }),
    ];
    expect(sortReports(rows).map(r => `${r.project}/${r.slug}`)).toEqual([
      'asp-cloud/c',
      'project-ind/a',
      'project-ind/b',
    ]);
  });
});

describe('reportPath', () => {
  it('builds the route for a report', () => {
    expect(reportPath(meta({ slug: '2026-07-21-weekly' }))).toBe('/reports/project-ind/2026-07-21-weekly');
  });
});

describe('extractMermaidSource', () => {
  it('returns the source of a language-mermaid code child', () => {
    const code = createElement('code', { className: 'language-mermaid' }, 'graph TD; A-->B;');
    expect(extractMermaidSource([code])).toBe('graph TD; A-->B;');
  });

  it('ignores non-mermaid code blocks and non-elements', () => {
    const code = createElement('code', { className: 'language-ts' }, 'const x = 1;');
    expect(extractMermaidSource([code])).toBeNull();
    expect(extractMermaidSource('plain text')).toBeNull();
  });
});
