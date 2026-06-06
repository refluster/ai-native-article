// Article-side byline helpers. Loads just enough of the workforce
// manifest to render the AuthorChip on article pages without depending
// on the full workforce app code (which now lives in a separate
// workspace, builds for a different deploy target, and ships
// independently). The article build still fetches the shared manifest
// from its own /workforce-agents.json — see workforce/scripts/build-agent-manifest.mjs
// which emits a copy into newsletter/app/public/.

import { withBasePath } from './paths';

export interface AuthorRecord {
  slug: string;
  first_name: string;
  last_name: string;
  role: string;
}

interface Manifest {
  agents: AuthorRecord[];
}

let cache: Promise<Manifest> | null = null;

function load(): Promise<Manifest> {
  if (!cache) {
    cache = fetch(withBasePath('/workforce-agents.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-agents.json (${res.status})`);
        return res.json() as Promise<Manifest>;
      })
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

export async function findAuthor(slug: string): Promise<AuthorRecord | undefined> {
  const m = await load();
  return m.agents.find((a) => a.slug === slug);
}

export function fullName(author: Pick<AuthorRecord, 'first_name' | 'last_name'>): string {
  return `${author.first_name} ${author.last_name}`;
}

/** Deterministic HSL hue derived from the slug. Powers the circle avatar. */
export function slugHue(slug: string): number {
  let h = 7;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}
