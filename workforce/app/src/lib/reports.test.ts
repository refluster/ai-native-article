import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import {
  extractMermaidSource,
  fetchProjectReports,
  fetchReportBody,
  fetchReportManifest,
  reportPath,
  sortReports,
  type ReportMeta,
} from './reports';

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

describe('runtime API fetches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchReportManifest fans out over active projects and merges newest-first', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/projects\?status=active$/.test(url)) {
        return {
          ok: true,
          json: async () => ({ items: [{ project_id: 'project-ind' }, { project_id: 'asp-cloud' }] }),
        };
      }
      if (/\/projects\/project-ind\/reports$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            items: [{ project_id: 'project-ind', slug: 'w1', title: 't', date: '2026-07-01' }],
          }),
        };
      }
      if (/\/projects\/asp-cloud\/reports$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            items: [{ project_id: 'asp-cloud', slug: 'w2', title: 't', date: '2026-07-21' }],
          }),
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { reports, failedProjects } = await fetchReportManifest();
    expect(reports.map(r => `${r.project}/${r.slug}`)).toEqual(['asp-cloud/w2', 'project-ind/w1']);
    expect(failedProjects).toEqual([]);
  });

  it('fetchReportManifest isolates a failing project instead of blanking the index', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/projects\?status=active$/.test(url)) {
        return {
          ok: true,
          json: async () => ({ items: [{ project_id: 'project-ind' }, { project_id: 'conference' }] }),
        };
      }
      if (/\/projects\/project-ind\/reports$/.test(url)) {
        return {
          ok: true,
          json: async () => ({
            items: [{ project_id: 'project-ind', slug: 'w1', title: 't', date: '2026-07-21' }],
          }),
        };
      }
      return { ok: false, status: 500 };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { reports, failedProjects } = await fetchReportManifest();
    expect(reports.map(r => r.slug)).toEqual(['w1']);
    expect(failedProjects).toEqual(['conference']);
  });

  it('fetchReportManifest throws on a non-OK projects response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchReportManifest()).rejects.toThrow('HTTP 404');
  });

  it('fetchProjectReports maps project_id to project and throws on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [{ project_id: 'project-ind', slug: 'w1', title: 't', date: '2026-07-21' }] }),
      }),
    );
    expect(await fetchProjectReports('project-ind')).toEqual([
      { project: 'project-ind', slug: 'w1', title: 't', date: '2026-07-21' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(fetchProjectReports('project-ind')).rejects.toThrow('HTTP 502');
  });

  it('fetchReportBody returns text and throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '# body' }));
    expect(await fetchReportBody('project-ind', 'w1')).toBe('# body');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchReportBody('project-ind', 'missing')).rejects.toThrow('HTTP 500');
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
