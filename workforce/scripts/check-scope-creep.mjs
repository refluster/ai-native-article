#!/usr/bin/env node
// check-scope-creep.mjs — the FU-005 guard (scope-creep enforcement, cycle-2+).
//
// Every open PR in the bound repo is scanned for cycle-2+ reviewer comments.
// A reviewer comment in cycle N (N >= 2) that introduces a finding-ID not
// present in any cycle-1 comment and not explicitly flagged [NEW] on the same
// line signals scope creep: the reviewer introduced a new finding without
// acknowledging it as novel.
//
// Finding format (SKILL.md §Step 4):
//   `A1` <checklist section> — <file:line>
//   Problem: ...
//   Fix: ...
// Cycle-2+ comments cite the cycle-1 finding-ID or flag `[NEW]` on the same
// line; still four lines. Enforcement: a finding-ID token that is absent from
// the cycle-1 set AND lacks `[NEW]` on its line is a violation.
//
// The routing comment format (SKILL.md §Step 2 / pr-merge.mjs) marks cycle
// boundaries:
//   **<PersonaName> — cycle N of ≤ M.**
// The first such comment with N >= 2 is the cycle-1 / cycle-2+ split point.
//
// Both issue comments and PR reviews are merged and sorted by creation time
// before the boundary search, since the routing persona posts to the issue-
// comment thread while reviewer personas post as PR review bodies.
//
// Usage:
//   GITHUB_TOKEN=... node workforce/scripts/check-scope-creep.mjs \
//     --repo refluster/ai-native-article [--json]
//
// Exit codes: 0 clean · 1 bad args / no token · 2 violation(s) found · 3 network.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { ROUTING_CYCLE_RE } from "../skills/pr-autopilot/pr-merge.mjs";

// Finding-ID format from SKILL.md: backtick-wrapped uppercase-letter + digits,
// e.g. `A1`, `B2`, `D12`. The letter is typically the reviewer's persona initial.
const FINDING_ID_RE = /`([A-Z]\d+)`/g;

// Routing comment opening line, imported from pr-merge.mjs (single source —
// check-cycle-count.mjs's countRouterCycles/W4_CYCLE_CAP import is the
// established pattern this follows).
// Matches: **<PersonaName> — cycle N of ≤ M.**

/**
 * Parse finding-ID occurrences from a single comment body.
 *
 * Returns an array of { id: string, hasNew: boolean } — one entry per finding-ID
 * token. hasNew is true when `[NEW]` appears on the same source line as the token.
 * A finding-ID that appears multiple times on the same line produces multiple entries.
 */
export function parseFindingOccurrences(body) {
  const results = [];
  for (const line of String(body ?? "").split("\n")) {
    const hasNew = /\[NEW\]/.test(line);
    const re = new RegExp(FINDING_ID_RE.source, "g");
    let m;
    while ((m = re.exec(line)) !== null) {
      results.push({ id: m[1], hasNew });
    }
  }
  return results;
}

/**
 * Parse the RFC 5988 `Link` response header for the `rel="next"` URL, or
 * `null` when there is no next page. GitHub REST pagination is drained by
 * following this header rather than incrementing a `page` param by hand —
 * some endpoints use opaque cursors, so only the header is authoritative.
 */
export function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of String(linkHeader).split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extract all finding-IDs from a collection of comment bodies.
 * Returns a Set<string> (e.g. {"A1", "B2"}).
 */
export function extractFindingIds(bodies) {
  const ids = new Set();
  for (const body of bodies) {
    for (const { id } of parseFindingOccurrences(body)) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Check cycle-2+ comment bodies for scope-creep violations.
 *
 * A finding-ID in a cycle-2+ comment is a violation if it did NOT appear in
 * any cycle-1 comment and was NOT introduced with [NEW] earlier in the
 * cycle-2+ stream. `laterBodies` spans every cycle from 2 onward (per
 * `groupByCycle`, cycle boundaries are not preserved within it), so a finding
 * legitimately opened `[NEW]` in cycle 2 must stay allowed when re-cited
 * without `[NEW]` in cycle 3+ — the allowed set therefore accumulates as the
 * stream is walked chronologically, seeded with cycle1Ids, rather than
 * checking every occurrence against the static cycle-1 set alone
 * (FU-005 / SKILL.md §Step 4).
 *
 * @param {Set<string>} cycle1Ids - all finding-IDs from cycle-1 comments
 * @param {string[]} laterBodies - comment bodies from cycle-2+, chronological
 * @returns {{ violations: Array<{ id: string }> }}
 */
export function checkScopeCreep(cycle1Ids, laterBodies) {
  const violations = [];
  const allowedIds = new Set(cycle1Ids);
  for (const body of laterBodies) {
    for (const { id, hasNew } of parseFindingOccurrences(body)) {
      if (allowedIds.has(id)) continue;
      if (hasNew) {
        allowedIds.add(id);
        continue;
      }
      violations.push({ id });
    }
  }
  return { violations };
}

/**
 * Split a PR's comment timeline at the first cycle-2 routing comment.
 *
 * Records must be pre-sorted chronologically (ascending created_at).
 * Returns { cycle1Bodies, laterBodies }:
 *   - cycle1Bodies: bodies of all records before the first cycle-2+ routing comment
 *   - laterBodies:  bodies of all records from the first cycle-2+ routing comment onward
 *
 * If no cycle-2+ routing comment is found (PR is still in cycle 1), both arrays
 * are empty and the caller should skip the scope-creep check for this PR.
 */
export function groupByCycle(sortedRecords) {
  let firstCycle2Idx = -1;
  for (let i = 0; i < sortedRecords.length; i++) {
    const body = String(sortedRecords[i].body ?? "");
    const m = ROUTING_CYCLE_RE.exec(body);
    if (m && parseInt(m[1], 10) >= 2) {
      firstCycle2Idx = i;
      break;
    }
  }
  if (firstCycle2Idx === -1) {
    return { cycle1Bodies: [], laterBodies: [] };
  }
  return {
    cycle1Bodies: sortedRecords.slice(0, firstCycle2Idx).map((r) => r.body),
    laterBodies: sortedRecords.slice(firstCycle2Idx).map((r) => r.body),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = arg("repo");
  const asJson = process.argv.includes("--json");

  if (!token) {
    console.error("check-scope-creep: GITHUB_TOKEN (or GH_TOKEN) is required");
    return 1;
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error("check-scope-creep: --repo <owner>/<repo> is required");
    return 1;
  }

  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const gh = async (path) => {
    const url = /^https?:\/\//.test(path) ? path : `${api}${path}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "workforce-scope-creep-lint",
      },
    });
    const text = await res.text().catch(() => "");
    let json;
    try { json = text ? JSON.parse(text) : []; } catch { json = []; }
    return { status: res.status, json, link: res.headers.get("link") };
  };

  // Drains every page of a paginated list endpoint by following the `Link:
  // rel="next"` header (S1 / FU-005 cycle 2) — `per_page=100` alone only
  // returns page 1, so a PR whose comment/review history exceeds 100 records
  // silently dropped its newest entries out of `laterBodies`.
  const ghAll = async (path) => {
    let items = [];
    let next = path;
    let status = 200;
    while (next) {
      const r = await gh(next);
      status = r.status;
      if (r.status !== 200 || !Array.isArray(r.json)) return { status, json: items };
      items = items.concat(r.json);
      next = parseNextLink(r.link);
    }
    return { status, json: items };
  };

  let prs;
  try {
    const r = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      console.error(`check-scope-creep: GET pulls -> HTTP ${r.status}`);
      return 3;
    }
    prs = r.json;
  } catch (e) {
    console.error(`check-scope-creep: network error: ${e?.message || e}`);
    return 3;
  }

  const prViolations = [];
  for (const pr of prs) {
    let records;
    try {
      const [c, rv] = await Promise.all([
        ghAll(`/repos/${repo}/issues/${pr.number}/comments?per_page=100`),
        ghAll(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
      ]);
      const issueComments = Array.isArray(c.json)
        ? c.json.map((x) => ({ body: x.body ?? "", createdAt: x.created_at ?? "" }))
        : [];
      const reviewBodies = Array.isArray(rv.json)
        ? rv.json.map((x) => ({ body: x.body ?? "", createdAt: x.submitted_at ?? "" }))
        : [];
      records = [...issueComments, ...reviewBodies].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
    } catch (e) {
      console.error(`check-scope-creep: network error on #${pr.number}: ${e?.message || e}`);
      return 3;
    }

    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    if (laterBodies.length === 0) continue; // cycle 1 only — nothing to check

    const cycle1Ids = extractFindingIds(cycle1Bodies);
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    if (violations.length > 0) {
      prViolations.push({ number: pr.number, title: pr.title, url: pr.html_url, violations });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ repo, checked: prs.length, prViolations }, null, 2));
  }
  if (prViolations.length === 0) {
    if (!asJson)
      console.error(
        `check-scope-creep: OK — ${prs.length} open PR(s), no scope-creep violations (FU-005)`,
      );
    return 0;
  }
  if (!asJson) {
    console.error(
      `check-scope-creep: ${prViolations.length} PR(s) have cycle-2+ finding-IDs without [NEW] (FU-005):`,
    );
    for (const v of prViolations) {
      console.error(`  - #${v.number} ${v.title} — ${v.url}`);
      for (const viol of v.violations) {
        console.error(`      finding-ID \`${viol.id}\` not in cycle-1 and not flagged [NEW]`);
      }
    }
    console.error(
      `Fix: in cycle-2+ reviewer comments, cite cycle-1 finding-IDs by reusing them, ` +
        `or tag genuinely new findings with [NEW] on the same line (SKILL.md §Step 4).`,
    );
  }
  return 2;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
