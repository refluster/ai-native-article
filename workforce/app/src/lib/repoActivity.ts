// Loader for the bundled Repository Performance snapshot (2026-07-24
// operator request, requirement 5). Real GitHub data, built offline by
// workforce/scripts/build-repo-performance.mjs — there is no live endpoint
// and no illustrative fallback (unlike lib/performance.ts): a project whose
// token couldn't be resolved this run is simply absent from the dataset, and
// the dataset's own `generated_at` + `$comment` (surfaced by the panel) tell
// the reader how fresh the snapshot is and whether any project was skipped.

import type { RepoActivityDataset } from '../types/repoActivity';
import { withBasePath } from './paths';

let cache: Promise<RepoActivityDataset> | null = null;

export function loadRepoActivity(): Promise<RepoActivityDataset> {
  if (!cache) {
    cache = fetch(withBasePath('/workforce-mock-repo-activity.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-mock-repo-activity.json (${res.status})`);
        return res.json() as Promise<RepoActivityDataset>;
      })
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}
