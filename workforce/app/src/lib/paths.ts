// Workforce app paths helper. Mirrors newsletter/app/src/lib/paths.ts in
// shape but uses the workforce SITE_BASE_PATH, which defaults to '/' so
// CloudFront serves the SPA at the apex of workforce.kohuehara.xyz.

import { SITE_BASE_PATH, SITE_BASENAME } from '../config/site';

export function withBasePath(path: string): string {
  return `${SITE_BASE_PATH}${path.replace(/^\/+/, '')}`;
}

export function routerBaseName(): string {
  return SITE_BASENAME;
}

// ─── project route parsing ────────────────────────────────────────────
//
// Project ids may contain `/` (e.g. `self/ren`), so App.tsx wires
// `/projects/*` as a wildcard and the whole remainder arrives as one
// route param. The view is therefore a *suffix* of that remainder, not a
// separate route segment — parsing it here rather than inline in
// ProjectProfile keeps the ambiguity in one tested place (ADR-0027 §1).

/** The project sub-pages, in tab order. */
export type ProjectView = 'overview' | 'performance' | 'tools';

export interface ProjectRoute {
  /** Decoded project id, with any view suffix removed. */
  projectId: string;
  view: ProjectView;
  /** Set only when the route addresses one tool: `/tools/{toolId}`. */
  toolId?: string;
}

/**
 * Split a `/projects/*` wildcard remainder into its project id, view, and
 * (for the tools view) tool id.
 *
 *   'self/ren'                    → { projectId: 'self/ren', view: 'overview' }
 *   'asp-cloud/performance'       → { projectId: 'asp-cloud', view: 'performance' }
 *   'asp-cloud/tools'             → { projectId: 'asp-cloud', view: 'tools' }
 *   'asp-cloud/tools/user-research'
 *                                 → { …, view: 'tools', toolId: 'user-research' }
 *
 * Known ambiguity, carried over from the pre-ADR-0027 inline parser: a
 * project whose id genuinely ends in `/performance` or `/tools` is
 * unreachable, because the suffix always wins. Accepted rather than
 * fixed — disambiguating would need a route shape that no longer lets
 * ids carry slashes, and the id namespace is operator-assigned under C-3.
 *
 * A tool id is matched conservatively (kebab-case, the registry's own id
 * shape), so `.../tools/anything/else` degrades to the tools index rather
 * than inventing a tool id out of an arbitrary tail.
 */
const TOOL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseProjectRoute(rawWildcard: string): ProjectRoute {
  let rest = rawWildcard;
  try {
    rest = decodeURIComponent(rawWildcard);
  } catch {
    /* malformed percent-encoding: fall back to the raw value */
  }
  // Trailing slashes are noise — '/projects/asp-cloud/' is the overview.
  rest = rest.replace(/\/+$/, '');

  const PERF = '/performance';
  if (rest.endsWith(PERF)) {
    return { projectId: rest.slice(0, -PERF.length), view: 'performance' };
  }

  const TOOLS = '/tools';
  if (rest.endsWith(TOOLS)) {
    return { projectId: rest.slice(0, -TOOLS.length), view: 'tools' };
  }
  const toolMatch = rest.lastIndexOf(`${TOOLS}/`);
  if (toolMatch !== -1) {
    const toolId = rest.slice(toolMatch + TOOLS.length + 1);
    return TOOL_ID.test(toolId)
      ? { projectId: rest.slice(0, toolMatch), view: 'tools', toolId }
      : { projectId: rest.slice(0, toolMatch), view: 'tools' };
  }

  return { projectId: rest, view: 'overview' };
}

/** Build the console path for a project view. Inverse of `parseProjectRoute`. */
export function projectPath(
  projectId: string,
  view: ProjectView = 'overview',
  toolId?: string,
): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (view === 'performance') return `${base}/performance`;
  if (view === 'tools') return toolId ? `${base}/tools/${toolId}` : `${base}/tools`;
  return base;
}
