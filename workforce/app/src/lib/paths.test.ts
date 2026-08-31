// Route-parsing tests for the `/projects/*` wildcard remainder.
//
// The parser exists because a project id may contain `/`, so the view is
// a suffix rather than its own route segment (ADR-0027 §1). These cases
// pin the boundary between "part of the id" and "part of the view".

import { describe, it, expect } from 'vitest';
import { parseProjectRoute, projectPath } from './paths';

describe('parseProjectRoute', () => {
  it('reads a bare id as the overview', () => {
    expect(parseProjectRoute('asp-cloud')).toEqual({
      projectId: 'asp-cloud',
      view: 'overview',
    });
  });

  it('keeps slashes that belong to the project id', () => {
    expect(parseProjectRoute('self/ren')).toEqual({
      projectId: 'self/ren',
      view: 'overview',
    });
  });

  it('decodes a percent-encoded id', () => {
    expect(parseProjectRoute('self%2Fren')).toEqual({
      projectId: 'self/ren',
      view: 'overview',
    });
  });

  it('falls back to the raw value on malformed encoding', () => {
    expect(parseProjectRoute('100%').projectId).toBe('100%');
  });

  it('ignores a trailing slash', () => {
    expect(parseProjectRoute('asp-cloud/')).toEqual({
      projectId: 'asp-cloud',
      view: 'overview',
    });
  });

  it('splits the performance suffix', () => {
    expect(parseProjectRoute('asp-cloud/performance')).toEqual({
      projectId: 'asp-cloud',
      view: 'performance',
    });
  });

  it('splits the performance suffix off a slash-bearing id', () => {
    expect(parseProjectRoute('self/ren/performance')).toEqual({
      projectId: 'self/ren',
      view: 'performance',
    });
  });

  it('reads the tools index', () => {
    expect(parseProjectRoute('asp-cloud/tools')).toEqual({
      projectId: 'asp-cloud',
      view: 'tools',
    });
  });

  it('reads one tool', () => {
    expect(parseProjectRoute('asp-cloud/tools/user-research')).toEqual({
      projectId: 'asp-cloud',
      view: 'tools',
      toolId: 'user-research',
    });
  });

  it('reads one tool under a slash-bearing id', () => {
    expect(parseProjectRoute('self/ren/tools/problem-finding')).toEqual({
      projectId: 'self/ren',
      view: 'tools',
      toolId: 'problem-finding',
    });
  });

  it('treats a deeper tail as part of the project id, not a tool route', () => {
    // The split is anchored to the final two segments, so `/tools/` in the
    // middle of an id does not claim the route.
    expect(parseProjectRoute('asp-cloud/tools/user-research/extra')).toEqual({
      projectId: 'asp-cloud/tools/user-research/extra',
      view: 'overview',
    });
  });

  it('degrades to the tools index when the final segment is not a tool id', () => {
    expect(parseProjectRoute('asp-cloud/tools/User_Research')).toEqual({
      projectId: 'asp-cloud',
      view: 'tools',
    });
  });

  // ── pinned ambiguities (documented in parseProjectRoute's comment) ──
  // These are not defects to fix silently; they are the accepted cost of
  // letting project ids carry slashes on a wildcard route. A change in
  // either direction should break these tests and be argued for.

  it('pins: an id ending in /tools/{kebab} is read as a tool route', () => {
    expect(parseProjectRoute('self/tools/ren')).toEqual({
      projectId: 'self',
      view: 'tools',
      toolId: 'ren',
    });
  });

  it('pins: an id ending in /performance is read as the performance view', () => {
    expect(parseProjectRoute('self/performance')).toEqual({
      projectId: 'self',
      view: 'performance',
    });
  });


});

describe('projectPath', () => {
  it('round-trips every view through parseProjectRoute', () => {
    const cases: Array<[string, 'overview' | 'performance' | 'tools', string?]> = [
      ['asp-cloud', 'overview', undefined],
      ['asp-cloud', 'performance', undefined],
      ['asp-cloud', 'tools', undefined],
      ['asp-cloud', 'tools', 'insight-foundry'],
      ['self/ren', 'overview', undefined],
      ['self/ren', 'performance', undefined],
      ['self/ren', 'tools', 'task-process'],
    ];
    for (const [projectId, view, toolId] of cases) {
      const path = projectPath(projectId, view, toolId);
      const wildcard = path.replace(/^\/projects\//, '');
      expect(parseProjectRoute(wildcard)).toEqual(
        toolId ? { projectId, view, toolId } : { projectId, view },
      );
    }
  });

  it('percent-encodes the id so a slash-bearing id stays one segment', () => {
    expect(projectPath('self/ren')).toBe('/projects/self%2Fren');
  });
});
