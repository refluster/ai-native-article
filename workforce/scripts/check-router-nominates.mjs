#!/usr/bin/env node
// check-router-nominates.mjs — the FU-016 guard (router-nominates-ren rule).
//
// When a PR's diff touches workforce/lambdas/, the cycle-1 routing comment
// must nominate `wf:ren`. Ren is the engineering persona whose lens covers
// Lambda changes (dev-process.md / FU-016).
//
// A PR that has been routed (cycle-1 routing comment present) but whose
// routing comment does not nominate `wf:ren` — and whose diff touches
// workforce/lambdas/ — is a violation. PRs with no routing comment yet are
// skipped (the router has not acted yet; enforce at routing time, not before).
//
// Single-sources ROUTING_CYCLE_RE from pr-merge.mjs (same pattern as
// check-cycle-count.mjs / check-scope-creep.mjs).
//
// Usage:
//   GITHUB_TOKEN=... node workforce/scripts/check-router-nominates.mjs \
//     --repo refluster/ai-native-article [--slug ren] [--path workforce/lambdas/] [--json]
//
// Exit codes: 0 clean · 1 bad args / no token · 2 violation(s) found · 3 network.

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { ROUTING_CYCLE_RE } from "../skills/pr-autopilot/pr-merge.mjs";

/**
 * True when the PR's changed-file list includes at least one file under the
 * given path prefix (default `workforce/lambdas/`).
 */
export function touchesPath(files, pathPrefix = "workforce/lambdas/") {
  return (
    Array.isArray(files) &&
    files.some((f) => String(f?.filename ?? "").startsWith(pathPrefix))
  );
}

/**
 * Return the body of the first cycle-N routing comment where N === targetCycle
 * (default 1), from a pre-sorted (chronological) array of comment bodies.
 * Returns null when no matching comment is found.
 */
export function findRoutingBody(sortedBodies, targetCycle = 1) {
  for (const body of sortedBodies) {
    const m = ROUTING_CYCLE_RE.exec(String(body ?? ""));
    if (m && parseInt(m[1], 10) === targetCycle) return body;
  }
  return null;
}

/**
 * True when the routing comment body nominates the given persona slug.
 *
 * A nomination line matches `wf:<slug>` and does NOT begin with a
 * "Skipping" prefix — which signals an explicit skip, not a nomination.
 *
 * Nomination format (SKILL.md §Step 2):
 *   - **`wf:ren`** — <rationale>
 * Skip format:
 *   Skipping `wf:ren` — <reason>
 */
export function isNominated(body, slug = "ren") {
  // Match `wf:<slug>` only when NOT immediately followed by another slug
  // character (letters, digits, or dash), to avoid matching `wf:ren` inside
  // `wf:ren-advisor`. In practice persona slugs are lowercase-alpha-only, but
  // the boundary prevents false positives from any future slug extension.
  const re = new RegExp(`wf:${slug}(?![a-z0-9-])`, "i");
  for (const line of String(body ?? "").split("\n")) {
    if (re.test(line) && !/^\s*skipping\b/i.test(line)) {
      return true;
    }
  }
  return false;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = arg("repo");
  const slug = arg("slug") ?? "ren";
  const pathPrefix = arg("path") ?? "workforce/lambdas/";
  const asJson = process.argv.includes("--json");

  if (!token) {
    console.error("check-router-nominates: GITHUB_TOKEN (or GH_TOKEN) is required");
    return 1;
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error("check-router-nominates: --repo <owner>/<repo> is required");
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
        "user-agent": "workforce-router-nominates-lint",
      },
    });
    const text = await res.text().catch(() => "");
    let json;
    try {
      json = text ? JSON.parse(text) : [];
    } catch {
      json = [];
    }
    return { status: res.status, json, link: res.headers.get("link") };
  };

  let prs;
  try {
    const r = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      console.error(`check-router-nominates: GET pulls -> HTTP ${r.status}`);
      return 3;
    }
    prs = r.json;
  } catch (e) {
    console.error(`check-router-nominates: network error: ${e?.message || e}`);
    return 3;
  }

  const violations = [];
  const skipped = []; // PRs touching lambdas but not yet routed

  for (const pr of prs) {
    let files, bodies;
    try {
      const [fr, cr, rvr] = await Promise.all([
        gh(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`),
        gh(`/repos/${repo}/issues/${pr.number}/comments?per_page=100`),
        gh(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
      ]);

      files = Array.isArray(fr.json) ? fr.json : [];

      const issueComments = Array.isArray(cr.json)
        ? cr.json.map((x) => ({ body: x.body ?? "", createdAt: x.created_at ?? "" }))
        : [];
      const reviewBodies = Array.isArray(rvr.json)
        ? rvr.json.map((x) => ({ body: x.body ?? "", createdAt: x.submitted_at ?? "" }))
        : [];
      bodies = [...issueComments, ...reviewBodies]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => r.body);
    } catch (e) {
      console.error(
        `check-router-nominates: network error on #${pr.number}: ${e?.message || e}`,
      );
      return 3;
    }

    if (!touchesPath(files, pathPrefix)) continue;

    const routingBody = findRoutingBody(bodies);
    if (routingBody === null) {
      // Not yet routed — skip without flagging
      skipped.push({ number: pr.number, title: pr.title, url: pr.html_url });
      continue;
    }

    if (!isNominated(routingBody, slug)) {
      violations.push({ number: pr.number, title: pr.title, url: pr.html_url });
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { repo, slug, pathPrefix, checked: prs.length, violations, skipped },
        null,
        2,
      ),
    );
  }
  if (violations.length === 0) {
    if (!asJson)
      console.error(
        `check-router-nominates: OK — ${prs.length} open PR(s) checked` +
          (skipped.length ? `, ${skipped.length} not yet routed (skipped)` : "") +
          ` (FU-016)`,
      );
    return 0;
  }
  if (!asJson) {
    console.error(
      `check-router-nominates: ${violations.length} PR(s) touch ${pathPrefix} but cycle-1 routing comment does not nominate wf:${slug} (FU-016):`,
    );
    for (const v of violations)
      console.error(`  - #${v.number} ${v.title} — ${v.url}`);
    console.error(
      `Fix: the cycle-1 routing comment must include "- **\`wf:${slug}\`**" in the nominees list (SKILL.md §Step 2).`,
    );
  }
  return 2;
}

// Run as CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
