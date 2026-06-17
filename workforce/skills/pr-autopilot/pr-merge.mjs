#!/usr/bin/env node
// pr-autopilot/pr-merge.mjs — the shared, deterministic **consensus merge engine**
// for the workforce's R-N10 delegated-external-merge lane (widened by adr-0010,
// 2026-06-17, superseding the original Dependabot-only safe-class predicate).
//
// The merge predicate is now: a PR is mergeable iff it touches **no L0/L1 path**
// of the TARGET repo's own governance (read from that repo's docs/governance.md),
// is open + mergeable + CLEAN, has **all required checks green**, carries **no
// human CHANGES_REQUESTED**, and the routing persona's nominated reviewers have
// each posted their lens review (the unanimous-green consensus). L0/L1-touching
// PRs are never merged — they escalate to a human (the operator's final call).
//
// R-N10 (workforce/docs/governance.md) clause 2: this engine RE-VERIFIES the
// predicate SERVER-SIDE and FAILS CLOSED. A decision marked action:"merge" is
// honoured only if, at apply time, every predicate clause re-passes against the
// live PR. Anything it cannot positively confirm — including an unreadable /
// marker-less target governance doc (so the L0/L1 set is unknown) — is a REFUSAL,
// never a merge. Escalations (issue filing) are unconditional.
//
// Source of truth for "what is L0/L1": the TARGET repo's own statute, per the
// operator direction (adr-0010). The engine fetches `docs/governance.md`
// (override: env GOVERNANCE_PATH) and extracts the path globs declared between
//   <!-- autopilot:l0l1-paths -->  …  <!-- /autopilot:l0l1-paths -->
// (one `- <glob>` per line). If that block is absent or empty, the L0/L1 set is
// UNKNOWN and every merge fails closed (route/review/verdict still run; the
// verdict hands off). This keeps the delegation in the maintainer's repo, never
// self-asserted by the workforce (R-N10 clause 1).
//
// CLI usage (both callers invoke this exact surface):
//   TOKEN=<github.token> node .../pr-merge.mjs \
//     --repo <owner>/<repo> --decisions /tmp/decisions.json [--skill-version x.y.z]
//
// Decisions file shape:
//   { "decisions": [
//       { "pr": 553, "action": "merge",
//         "comment": "<verdict / advisory-cited merge comment>",
//         "squash_subject": "feat: … (#553)",
//         "squash_body": "Unanimous reviewer sign-off (dario, ren). No L0/L1 surface.",
//         "reviewers": ["dario", "ren"] },
//       { "pr": 506, "action": "escalate",
//         "issue_title": "Hold #506: touches L0/L1",
//         "issue_body": "<why held + next step>",
//         "issue_labels": ["governance"] }   // ESCALATION_LABEL is always added
//   ] }
//
// Every escalation issue (and, via pr-autopilot-post.mjs --label, every PR
// handed off to a human) is stamped with ESCALATION_LABEL ("autopilot:needs-
// human") so the operator can list the whole human-decision queue at once.
//
// Exit codes: 0 all applied · 1 bad args/file · 2 a decision refused or a GitHub
// write rejected · 3 network/unexpected.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GOVERNANCE_PATH = process.env["GOVERNANCE_PATH"] || "docs/governance.md";
const L0L1_OPEN = "<!-- autopilot:l0l1-paths -->";
const L0L1_CLOSE = "<!-- /autopilot:l0l1-paths -->";

// The canonical, searchable label stamped on every PR/issue this skill hands
// off to a human (a 🔴 verdict, a non-consensus PR, a tracking issue, or — the
// common one — a 🟢 PR that touches the target repo's governance L0/L1). The
// operator finds the full human-decision queue with `is:open label:<this>`.
// pr-autopilot-post.mjs stamps it on hand-off PRs; this engine stamps it on
// every escalation issue it files.
export const ESCALATION_LABEL = "autopilot:needs-human";
const ESCALATION_LABEL_COLOR = "b60205"; // red — "an autopilot decision needs a human"

// Create labels if they do not already exist (idempotent: an existing label
// returns 422, which we ignore). Lets a target repo that has never seen the
// escalation label still receive it without a manual pre-create step.
export async function ensureLabels(gh, repo, names) {
  for (const name of names) {
    const { status } = await gh("POST", `/repos/${repo}/labels`, {
      name,
      color: ESCALATION_LABEL_COLOR,
      description: "Autopilot handed this off — a human's call (merge / governance L0/L1 / blocked).",
    });
    if (status !== 201 && status !== 422) {
      console.error(`pr-merge: WARN could not ensure label "${name}" (HTTP ${status}) — continuing`);
    }
  }
}

// W-1 editorial guard: a degraded body fails loud here, never lands on GitHub.
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "here is the", "here's the"];
export function w1(text, label) {
  const t = (text || "").trim();
  if (!t) throw { code: 2, msg: `${label} is empty (W-1)` };
  const head = t.slice(0, 50).toLowerCase();
  if (ARTEFACTS.some((a) => head.startsWith(a))) throw { code: 2, msg: `${label} opens with an LLM-failure artefact (W-1): "${head}"` };
  return t;
}

// Translate a leading-slash-free path glob (`**`, `*`, `?`) into an anchored
// RegExp. `**` matches across slashes; `*` matches within a path segment.
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$.|+()[]{}".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`(^|/)${re}$`, "i");
}

// Fetch the TARGET repo's governance doc and extract the declared L0/L1 path
// globs. Returns { ok, patterns, why }. ok=false ⇒ the L0/L1 set is unknown ⇒
// the caller fails every merge closed (route/review still run).
export async function resolveL0L1Paths(gh, repo, ref) {
  const path = GOVERNANCE_PATH;
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const { status, json } = await gh("GET", `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}${q}`);
  if (status !== 200 || typeof json?.content !== "string") {
    return { ok: false, patterns: [], why: `cannot read target governance ${path} (HTTP ${status}) — L0/L1 set unknown, failing merge closed` };
  }
  const md = Buffer.from(json.content, json.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  const start = md.indexOf(L0L1_OPEN);
  const end = md.indexOf(L0L1_CLOSE, start + 1);
  if (start === -1 || end === -1) {
    return { ok: false, patterns: [], why: `${path} declares no ${L0L1_OPEN} block — L0/L1 set unknown, failing merge closed` };
  }
  const block = md.slice(start + L0L1_OPEN.length, end);
  const globs = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  if (globs.length === 0) {
    return { ok: false, patterns: [], why: `${path} L0/L1 block is empty — failing merge closed` };
  }
  return { ok: true, patterns: globs.map(globToRegExp), why: `${globs.length} L0/L1 glob(s) from ${path}` };
}

// Build a thin GitHub REST client bound to one token + repo.
export function makeGh({ token, api = process.env["GITHUB_API_URL"] || "https://api.github.com", userAgent = "workforce-pr-merge" }) {
  return async function gh(method, path, body) {
    let res;
    try {
      res = await fetch(`${api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": userAgent,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw { code: 3, msg: `network error on ${method} ${path}: ${e?.message || e}` }; }
    const text = await res.text().catch(() => "");
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
    return { status: res.status, json };
  };
}

// A reviewer persona's green sign-off has landed iff a review/comment body
// carries that persona's EXACT structured marker (adr-0010 / Sana B1 hardening,
// 2026-06-17): `<!-- autopilot:review:{slug}:green -->`. The routing persona
// embeds this token in each nominated reviewer's posted review when that lens is
// non-blocking. An exact hidden-comment match removes the two failure modes of
// the old byline regex: a differently-formatted sign-off no longer reads as
// "missing" by accident, and prose that merely names the persona can no longer
// read as a green vote. Absence of the marker fails closed (no merge).
export function reviewerGreenMarker(slug) {
  return `<!-- autopilot:review:${String(slug).toLowerCase()}:green -->`;
}
export function reviewerSignedOff(slug, reviewBodies) {
  const marker = reviewerGreenMarker(slug);
  return reviewBodies.some((b) => (b || "").toLowerCase().includes(marker));
}

// Server-side predicate re-check. Returns {ok, why, sha}.
export async function verifyMergeable(gh, repo, pr, decision) {
  const { status, json: p } = await gh("GET", `/repos/${repo}/pulls/${pr}`);
  if (status !== 200) return { ok: false, why: `GET pull ${pr} -> HTTP ${status}` };
  if (p.state !== "open") return { ok: false, why: `PR #${pr} is ${p.state}` };
  // Per-PR maintainer off-switch: an `autopilot:off` label pauses this PR
  // (fail-closed). The repo-wide off-switch is emptying the target's
  // autopilot:l0l1-paths block (→ unknown set → refuse, see resolveL0L1Paths).
  if (Array.isArray(p.labels) && p.labels.some((l) => (l?.name || "").toLowerCase() === "autopilot:off")) {
    return { ok: false, why: `autopilot:off label set — paused by maintainer` };
  }
  if (p.mergeable !== true || p.mergeable_state !== "clean") return { ok: false, why: `not clean (mergeable=${p.mergeable}, state=${p.mergeable_state})` };

  // L0/L1 guard — sourced from the TARGET repo's own governance (adr-0010).
  const l0l1 = await resolveL0L1Paths(gh, repo, p.base?.ref);
  if (!l0l1.ok) return { ok: false, why: l0l1.why };
  const { status: fs, json: files } = await gh("GET", `/repos/${repo}/pulls/${pr}/files?per_page=100`);
  if (fs !== 200 || !Array.isArray(files)) return { ok: false, why: `GET files -> HTTP ${fs}` };
  for (const f of files) {
    if (l0l1.patterns.some((re) => re.test(f.filename))) {
      return { ok: false, why: `touches L0/L1 path ${f.filename} — escalate to human (operator's final call)` };
    }
  }

  // All required checks green.
  const { status: cs, json: checks } = await gh("GET", `/repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`);
  if (cs !== 200) return { ok: false, why: `GET check-runs -> HTTP ${cs}` };
  for (const c of checks.check_runs || []) {
    if (c.status !== "completed") return { ok: false, why: `check '${c.name}' is ${c.status}` };
    if (!["success", "neutral", "skipped"].includes(c.conclusion)) return { ok: false, why: `check '${c.name}' = ${c.conclusion}` };
  }

  // Unanimous-green consensus: no human CHANGES_REQUESTED, and every nominated
  // reviewer has posted their lens review.
  const { status: rs, json: reviews } = await gh("GET", `/repos/${repo}/pulls/${pr}/reviews?per_page=100`);
  if (rs !== 200 || !Array.isArray(reviews)) return { ok: false, why: `GET reviews -> HTTP ${rs}` };
  if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) return { ok: false, why: `a reviewer has CHANGES_REQUESTED — not consensus-green` };
  const reviewers = Array.isArray(decision?.reviewers) ? decision.reviewers.filter((s) => typeof s === "string" && s) : [];
  if (reviewers.length === 0) return { ok: false, why: `decision carries no reviewers[] — a merge requires the nominated reviewers' consensus (no-review merge refused)` };
  const { status: ics, json: comments } = await gh("GET", `/repos/${repo}/issues/${pr}/comments?per_page=100`);
  const bodies = [
    ...reviews.map((r) => r.body),
    ...(ics === 200 && Array.isArray(comments) ? comments.map((c) => c.body) : []),
  ];
  const missing = reviewers.filter((slug) => !reviewerSignedOff(slug, bodies));
  if (missing.length > 0) return { ok: false, why: `missing green marker(s) from ${missing.join(", ")} (expected ${reviewerGreenMarker(missing[0])}) — consensus not reached` };

  return { ok: true, why: `consensus-green, no L0/L1 surface (${reviewers.join(", ")})`, sha: p.head.sha };
}

// Apply one decisions payload. Returns { merged, escalated, refused }.
export async function applyDecisions(gh, repo, decisions) {
  let refused = 0, merged = 0, escalated = 0;

  for (const d of decisions) {
    const pr = d.pr;
    if (d.action === "escalate") {
      const title = w1(d.issue_title, `#${pr} issue_title`);
      const body = w1(d.issue_body, `#${pr} issue_body`);
      // Always stamp the canonical escalation label so the operator can find
      // every human-decision item with one search, in addition to any
      // PR-specific labels the caller supplied.
      const labels = [...new Set([...(Array.isArray(d.issue_labels) ? d.issue_labels : []), ESCALATION_LABEL])];
      await ensureLabels(gh, repo, labels);
      const { status, json } = await gh("POST", `/repos/${repo}/issues`, { title, body, labels });
      if (status === 201) { escalated++; console.error(`pr-merge: escalated #${pr} -> issue ${json.html_url}`); }
      else { refused++; console.error(`pr-merge: FAILED to file issue for #${pr}: HTTP ${status} ${JSON.stringify(json).slice(0, 300)}`); }
      continue;
    }
    if (d.action !== "merge") { refused++; console.error(`pr-merge: #${pr} unknown action "${d.action}"`); continue; }

    // ── R-N10 fail-closed gate (adr-0010 widened predicate) ─────────────────
    const comment = w1(d.comment, `#${pr} comment`);
    const subject = w1(d.squash_subject, `#${pr} squash_subject`);
    const verdict = await verifyMergeable(gh, repo, pr, d);
    if (!verdict.ok) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: ${verdict.why}`); continue; }

    const c = await gh("POST", `/repos/${repo}/issues/${pr}/comments`, { body: comment });
    if (c.status !== 201) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: comment failed HTTP ${c.status}`); continue; }
    const rv = await gh("POST", `/repos/${repo}/pulls/${pr}/reviews`, { event: "APPROVE", body: "Autopilot consensus-green merge (R-N10 / adr-0010): unanimous reviewer sign-off, no L0/L1 surface." });
    if (rv.status !== 200) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: approve failed HTTP ${rv.status} ${JSON.stringify(rv.json).slice(0, 200)}`); continue; }
    const mg = await gh("PUT", `/repos/${repo}/pulls/${pr}/merge`, { merge_method: "squash", sha: verdict.sha, commit_title: subject, commit_message: d.squash_body || "" });
    if (mg.status === 200) { merged++; console.error(`pr-merge: MERGED #${pr} (${verdict.why})`); }
    else { refused++; console.error(`pr-merge: merge #${pr} REJECTED HTTP ${mg.status}: ${JSON.stringify(mg.json).slice(0, 300)}`); }
  }
  return { repo, merged, escalated, refused };
}

function arg(argv, n) { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined; }

// Shared CLI entry. Returns a process exit code (does not call process.exit so
// callers can wrap it). TOKEN or GITHUB_TOKEN env supplies the credential.
export async function main(argv, env) {
  const token = env["TOKEN"] || env["GITHUB_TOKEN"];
  const repo = arg(argv, "repo");
  const decisionsFile = arg(argv, "decisions");
  if (!token) { console.error("pr-merge: TOKEN (or GITHUB_TOKEN) env var is required (from credentials['github.token'])"); return 1; }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { console.error("pr-merge: --repo <owner>/<repo> is required"); return 1; }
  if (!decisionsFile) { console.error("pr-merge: --decisions <file> is required"); return 1; }

  let payload;
  try { payload = JSON.parse(readFileSync(decisionsFile, "utf8")); }
  catch (e) { console.error(`pr-merge: cannot read/parse --decisions "${decisionsFile}": ${e?.message || e}`); return 1; }
  const decisions = Array.isArray(payload?.decisions) ? payload.decisions : null;
  if (!decisions) { console.error("pr-merge: decisions file must be { decisions: [...] }"); return 1; }

  const gh = makeGh({ token, userAgent: "workforce-pr-merge" });
  let result;
  try { result = await applyDecisions(gh, repo, decisions); }
  catch (e) { console.error(`pr-merge: ${e?.msg || e?.message || e}`); return e?.code || 3; }
  console.log(JSON.stringify(result));
  return result.refused > 0 ? 2 : 0;
}

// Run as a CLI when invoked directly (pr-autopilot verdict mode calls this path).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main(process.argv, process.env));
}
