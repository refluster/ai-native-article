// ADR-0019/ADR-0020 — the semantic MEMORY.md content contract, shared by
// the authenticated write route (POST /agents/{slug}/memory) and mirrored
// by the operator-side writer (workforce/scripts/curate-agent-memory.mjs)
// and the memory-curation skill's update-memory.mjs. The server-side copy
// here is the authoritative gate: a curation write that fails the contract
// is rejected 422, never partially applied (W-4).
//
// The contract is deliberately structural, not editorial — it verifies the
// document is a plausible MEMORY.md (title, curation date, the mandatory
// MVV anchor, non-hollow, bounded), not that its content is wise. Editorial
// quality is owned by the curation skill's judgment body + the AUDIT trail.

// Mirrors PROFILE_BLOCK_MAX_CHARS in shared/agent-config.ts (S17): the
// serialized {last_updated, body} block must stay under the profile-block
// ceiling the PATCH path enforces for the same field.
export const MEMORY_BLOCK_MAX_CHARS = 16 * 1024;

// A curation that shrinks an existing memory below this ratio of its prior
// length is refused unless the caller explicitly declares the shrink
// (allow_shrink). Guards the degenerate-output failure mode — an LLM
// writing a hollow revision must not silently wipe a persona's memory.
export const MEMORY_SHRINK_FLOOR = 0.5;

// Refuse documents that are too short to be a real memory — a fraction of
// even the smallest pilot document (~2.3 KB).
export const MEMORY_MIN_CHARS = 200;

export interface MemoryDocCheck {
  violations: string[];
  /** Parsed from the mandatory `Curated: YYYY-MM-DD` token; null if absent. */
  last_updated: string | null;
}

/** Validate a MEMORY.md document body against the ADR-0019 contract. */
export function validateMemoryDocument(body: string): MemoryDocCheck {
  const violations: string[] = [];
  if (!/^# MEMORY — /m.test(body)) {
    violations.push('missing "# MEMORY — <Name> (<Role>)" title');
  }
  const curated = body.match(/Curated:\s*(\d{4}-\d{2}-\d{2})/);
  if (!curated) {
    violations.push('missing machine-readable "Curated: YYYY-MM-DD" token');
  }
  if (!/^## Mission anchor$/m.test(body)) {
    violations.push('missing "## Mission anchor" section (the MVV anchor is mandatory)');
  }
  if (body.trim().length < MEMORY_MIN_CHARS) {
    violations.push(`body under ${MEMORY_MIN_CHARS} chars — refusing a hollow memory`);
  }
  if (body.length > MEMORY_BLOCK_MAX_CHARS) {
    violations.push(`body exceeds the ${MEMORY_BLOCK_MAX_CHARS}-char S17 ceiling`);
  }
  return { violations, last_updated: curated?.[1] ?? null };
}

/**
 * The shrink guard: given the persona's existing memory body (if any) and
 * the proposed revision, decide whether the revision needs an explicit
 * allow_shrink declaration. Absent/empty existing memory never triggers it.
 */
export function isSuspiciousShrink(existingBody: string | undefined, nextBody: string): boolean {
  if (!existingBody || existingBody.trim().length === 0) return false;
  return nextBody.length < existingBody.length * MEMORY_SHRINK_FLOOR;
}
