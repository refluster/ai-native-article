#!/usr/bin/env node
// Deterministic pr-autopilot POST script — posts ONE routing/verdict comment to
// a PR's issue-comment thread, and (optionally) stamps escalation labels on the
// PR so a human can find the hand-off queue.
//
// R-N9 / W-5 by construction: it writes ONLY an issue comment
// (`POST /repos/{owner}/{repo}/issues/{n}/comments`) and, with --label, issue
// labels (`POST /repos/{owner}/{repo}/issues/{n}/labels`). There is no code path
// that approves, requests-changes, merges, pushes a branch, or opens a PR.
// The external git surface stays comment+label only — agents never gate merges.
//
// The repo (owner/repo) is read from the in-repo project.json; the
// github.token is injected per-fire via the (project × agent × skill)
// binding's project linkage and read here from GITHUB_TOKEN. The comment
// body is read from a FILE so multi-line / Unicode prose can't be mangled
// by shell quoting.
//
// Usage:
//   GITHUB_TOKEN=<credentials['github.token'].token> \
//     node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
//       --project asp-cloud --pr 42 --body-file /tmp/route-body-42.md \
//       [--needs-human] [--label <name>]   # see escalation rule below
//       [--reason <code> [--reason-text "…"]]   # see reason rule below
//
// ESCALATION ALWAYS CARRIES THE LABEL (operator directive 2026-06-21). Any
// comment that hands a PR to a human — a 🟢 PR touching the target's governance
// L0/L1, a 🔴 verdict, a non-consensus PR, a no-delegation hand-off — MUST be
// stamped `autopilot:needs-human` so the operator finds the queue with
// `is:open label:autopilot:needs-human`. This script applies that label from
// EITHER signal, so a hand-off can never reach a human un-labelled even if one
// is forgotten:
//   - `--needs-human` flag, OR
//   - the hidden marker `<!-- autopilot:needs-human -->` embedded in the verdict
//     body (the SKILL.md escalation template carries it).
// The canonical label name is single-sourced from pr-merge.mjs (ESCALATION_LABEL),
// the same constant the engine stamps on escalation issues — one queue, one name.
//
// REVIEWED (merge-ready) hand-offs (operator directive 2026-06-23). When the
// hand-off is a 🟢 unanimous-green PR held back only by a human gate (the
// target's L0/L1 boundary, or a missing R-N10 delegation), it ALSO carries
// `autopilot:reviewed` — so the operator can tell "reviewed + merge-ready, my
// final call" apart from a 🔴 / cycle-capped / non-consensus escalation that
// still needs work. Stamped from EITHER `--reviewed` OR the hidden body marker
// `<!-- autopilot:reviewed -->`. A 🔴 / non-consensus escalation gets only
// `autopilot:needs-human`, never this.
//
// ESCALATION ALWAYS CARRIES A REASON (Epic-019 Story 1). Any comment that
// hands a PR to a human must also record WHY, from EITHER `--reason <code>`
// (appended to the body as the hidden `<!-- autopilot:reason:<code> -->`
// marker when absent) OR a reason marker already embedded in the body. The
// code becomes an `autopilot:reason:<code>` label — the funnel's aggregation
// source. Fail loud (C-4): an escalating post with NO reason, an unknown
// code, or `other` without free text (`--reason-text`) exits 1. Codes:
// workforce/docs/pr-escalation-reasons.md (v1; single-sourced from
// escalation-reasons.mjs). Additionally, every escalation computes the
// verdict-time L0/L1 check (same fail-closed source as the merge engine) and
// stamps `autopilot:reason:l0l1-path` when the PR touches the target's
// declared L0/L1 set — so the funnel's eligible (non-L0/L1) share is
// derivable for every escalated PR, not just the merge leg.
//
// Extra `--label <name>` values (repeatable) are merged in. Routing comments
// (cycle 1) carry neither flag nor marker, so they stay unlabelled. Missing
// labels are auto-created (each with its own colour/description).
//
// NO RAW @-MENTIONS (ML-012, operator report 2026-07-04). Persona slugs are
// not GitHub accounts; a raw `@<slug>` in a posted body notifies the real
// GitHub user who owns that name (`@yuki` pinged github.com/yuki). Agents are
// referenced as `wf:<slug>` in backticks; this script fails loud (exit 1) on
// any body carrying a raw @-mention outside backticks/code fences.
//
// Exit codes:
//   0  — comment created (HTTP 201); labels best-effort
//   1  — bad args / project.json missing / body-file unreadable
//   2  — endpoint rejected (auth/4xx)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "./pr-autopilot-scan.mjs";
import { ESCALATION_LABEL, REVIEWED_LABEL, makeGh, prTouchesL0L1 } from "./pr-merge.mjs";
import {
  REASON_LABEL_PREFIX,
  assertReasonCode,
  findReasonMarkers,
  reasonLabel,
  reasonMarker,
} from "./escalation-reasons.mjs";

const GH_API = "https://api.github.com";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** Per-label colour + description used when auto-creating a label the target
 *  repo lacks. Unknown labels (explicit --label values) fall back to the
 *  escalation colour. Single object so the two canonical labels never drift. */
const LABEL_META = {
  [ESCALATION_LABEL]: {
    color: "b60205", // red — "an autopilot decision needs a human"
    description: "Autopilot handed this off — a human's call (merge / governance L0/L1 / blocked).",
  },
  [REVIEWED_LABEL]: {
    color: "0e8a16", // green — "reviewed to 🟢 consensus, merge-ready"
    description: "Autopilot reviewed this to a 🟢 unanimous-green consensus; merge-ready, held only by a human gate (L0/L1 / delegation) — the operator merges.",
  },
};
const FALLBACK_LABEL_META = LABEL_META[ESCALATION_LABEL];

/** Meta for the Epic-019 `autopilot:reason:*` family (one label per taxonomy
 *  code, so an exact-name map can't cover them). */
const REASON_LABEL_META = {
  color: "c5def5", // light blue — telemetry, not a work queue
  description: "Epic-019 escalation-reason telemetry — why autopilot handed this PR to a human (wiring, not reviewer performance).",
};

/** Hidden marker the SKILL.md hand-off/escalation verdict template embeds. Its
 *  presence in the comment body forces ESCALATION_LABEL even if --needs-human
 *  was omitted — the mechanical half of "escalation ALWAYS carries the label". */
export const NEEDS_HUMAN_MARKER = "<!-- autopilot:needs-human -->";

/** Hidden marker for a 🟢 merge-ready hand-off. Its presence (or --reviewed)
 *  adds REVIEWED_LABEL alongside ESCALATION_LABEL — the mechanical half of
 *  "a green, human-gated PR is flagged reviewed even if the flag is dropped". */
export const REVIEWED_MARKER = "<!-- autopilot:reviewed -->";

/** Raw GitHub @-mentions found in a comment body's prose (ML-012).
 *
 *  Workforce persona slugs are NOT GitHub accounts: a raw `@<slug>` in a
 *  posted comment notifies whichever real GitHub user owns that name (a
 *  routing comment's `@yuki` pinged the unrelated github.com/yuki,
 *  2026-07-04). Agents are referenced as `wf:<slug>` in backticks; any
 *  literal `@…` token (scoped npm package, decorator) must be quoted in
 *  backticks/code fences, where GitHub never linkifies.
 *
 *  Backtick-quoted spans and fenced blocks are stripped before matching
 *  (`(`+)…\1` covers inline spans, double-backtick spans, and ``` fences
 *  alike). A mention is `@` + a GitHub-shaped login (alnum + inner hyphens,
 *  ≤39 chars) not preceded by a word character — so `user@example.com`
 *  stays legal, matching GitHub's own linkification rule. Pure + exported
 *  so the refusal is unit-tested, not merely documented. */
export function findRawMentions(body) {
  const prose = String(body ?? "").replace(/(`+)[\s\S]*?\1/g, " ");
  const re = /(^|[^\w`])@([a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38})/g;
  const found = new Set();
  let m;
  while ((m = re.exec(prose))) found.add(`@${m[2]}`);
  return [...found];
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

/** All values passed via repeated --label flags. */
function labelArgs() {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--label" && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return [...new Set(out)];
}

/** The label set to stamp. Exported + pure so the invariants are unit-tested,
 *  not merely documented:
 *   - any hand-off to a human carries ESCALATION_LABEL — added whenever the
 *     verdict escalates (the --needs-human flag OR the hidden body marker);
 *   - a 🟢 merge-ready hand-off ALSO carries REVIEWED_LABEL (the --reviewed
 *     flag OR the hidden reviewed marker) — and reviewed never implies escalated
 *     and vice versa; each is its own signal, on top of any explicit --label. */
export function resolveLabels(rawLabels, { needsHuman = false, reviewed = false, body = "" } = {}) {
  const out = [...rawLabels];
  if (needsHuman || body.includes(NEEDS_HUMAN_MARKER)) out.push(ESCALATION_LABEL);
  if (reviewed || body.includes(REVIEWED_MARKER)) out.push(REVIEWED_LABEL);
  return [...new Set(out)];
}

/** Epic-019 Story 1: every hand-off to a human carries WHY. Pure resolver —
 *  given the body plus the --reason/--reason-text flags, returns the reason
 *  codes found, the `autopilot:reason:*` labels to stamp, and the marker to
 *  append to the body (null when it already carries one for that code).
 *  Throws (C-4) on an unknown code, an `other` without free text, or an
 *  escalating comment with no reason at all — an un-reasoned hand-off never
 *  reaches GitHub. */
export function resolveReasons({ body = "", escalating = false, reason, reasonText = "" } = {}) {
  const codes = new Set(findReasonMarkers(body).map((m) => m.code)); // throws on unknown / bare other
  let appendMarker = null;
  if (reason) {
    assertReasonCode(reason);
    if (!codes.has(reason)) {
      appendMarker = reasonMarker(reason, reasonText); // throws on other w/o text
      codes.add(reason);
    }
  }
  if (escalating && codes.size === 0) {
    throw new Error(
      "an autopilot:needs-human hand-off must carry an escalation reason (Epic-019): pass --reason <code> " +
        "(taxonomy: workforce/docs/pr-escalation-reasons.md) or embed the <!-- autopilot:reason:<code> --> " +
        'marker in the body; "other" requires free text via --reason-text.',
    );
  }
  return { codes: [...codes], labels: [...codes].map(reasonLabel), appendMarker };
}

async function gh(token, method, path, body) {
  return fetch(`${GH_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "kohuehara-workforce",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  const projectId = arg("project");
  const prNumber = arg("pr");
  const bodyFile = arg("body-file");
  const token = process.env.GITHUB_TOKEN;

  if (!projectId) die(1, "--project <id> is required");
  if (!prNumber || !/^\d+$/.test(prNumber)) die(1, "--pr <number> is required (positive integer)");
  if (!bodyFile) die(1, "--body-file <path> is required");
  if (!token) die(2, "GITHUB_TOKEN env is required (from credentials['github.token'].token)");

  let owner, repo, body;
  try {
    ({ owner, repo } = projectRepo(REPO_ROOT, projectId));
  } catch (e) {
    die(1, e.message);
  }
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    die(1, `body-file unreadable: ${bodyFile}`);
  }
  if (body.trim().length === 0) die(1, "body-file is empty — refusing to post an empty routing comment (W-4)");
  const rawMentions = findRawMentions(body);
  if (rawMentions.length > 0) {
    die(
      1,
      `body contains raw GitHub @-mention(s): ${rawMentions.join(", ")} — persona slugs are not GitHub ` +
        `accounts and a raw @ notifies the real, unrelated user who owns that name (ML-012). ` +
        "Reference agents as `wf:<slug>` and wrap any literal @token in backticks.",
    );
  }

  // Epic-019: resolve labels + reasons BEFORE posting — the reason marker must
  // ride in the comment body, and an un-reasoned / mis-coded escalation must
  // fail loud here (C-4) without posting anything.
  let labels = resolveLabels(labelArgs(), {
    needsHuman: flag("needs-human"),
    reviewed: flag("reviewed"),
    body,
  });
  let reasons;
  try {
    reasons = resolveReasons({
      body,
      escalating: labels.includes(ESCALATION_LABEL),
      reason: arg("reason"),
      reasonText: arg("reason-text") ?? "",
    });
  } catch (e) {
    die(1, e instanceof Error ? e.message : String(e));
  }
  if (reasons.appendMarker) body = `${body.trimEnd()}\n\n${reasons.appendMarker}\n`;
  labels = [...new Set([...labels, ...reasons.labels])];

  // Verdict-time L0/L1 computation (Epic-019): every escalation records
  // whether the PR touches the target's declared L0/L1 set — today only the
  // merge leg computes this, which makes the funnel's eligible (non-L0/L1)
  // share uncomputable. Same fail-closed source as the merge engine
  // (prTouchesL0L1 → resolveL0L1Paths): an unreadable/markerless governance
  // doc means the set is UNKNOWN — log and escalate without an eligibility
  // record, never guess. A telemetry failure must not block the hand-off
  // itself (escalating IS the safe direction).
  if (labels.includes(ESCALATION_LABEL)) {
    try {
      const t = await prTouchesL0L1(makeGh({ token, userAgent: "kohuehara-workforce" }), `${owner}/${repo}`, prNumber);
      if (t.known && t.touches) labels = [...new Set([...labels, reasonLabel("l0l1-path")])];
      else if (!t.known) console.error(`pr-autopilot-post: WARN L0/L1 set unknown for ${owner}/${repo}#${prNumber} (${t.why}) — escalating without an eligibility record`);
    } catch (e) {
      console.error(`pr-autopilot-post: WARN verdict-time L0/L1 check failed (${e?.msg || e?.message || e}) — escalating without an eligibility record`);
    }
  }

  let res;
  try {
    res = await fetch(`${GH_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kohuehara-workforce",
      },
      body: JSON.stringify({ body }),
    });
  } catch (e) {
    die(3, `network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 201) {
    const json = await res.json().catch(() => ({}));
    console.log(`pr-autopilot-post: posted to ${owner}/${repo}#${prNumber} (comment ${json.id ?? "?"})`);
    // Stamp escalation + reason labels (best-effort: a label problem must not
    // fail a comment that already landed). Auto-create any label the repo
    // lacks. `labels` was resolved above, before the post: resolveLabels
    // guarantees ESCALATION_LABEL whenever this comment hands the PR to a
    // human, and resolveReasons/prTouchesL0L1 supply the autopilot:reason:*
    // family.
    if (labels.length > 0) {
      for (const name of labels) {
        const meta = LABEL_META[name] ?? (name.startsWith(REASON_LABEL_PREFIX) ? REASON_LABEL_META : FALLBACK_LABEL_META);
        const cr = await gh(token, "POST", `/repos/${owner}/${repo}/labels`, {
          name, color: meta.color, description: meta.description,
        }).catch(() => ({ status: 0 }));
        if (cr.status !== 201 && cr.status !== 422) {
          console.error(`pr-autopilot-post: WARN ensure label "${name}" → HTTP ${cr.status}`);
        }
      }
      const lr = await gh(token, "POST", `/repos/${owner}/${repo}/issues/${prNumber}/labels`, { labels }).catch(() => ({ status: 0 }));
      if (lr.status === 200) console.log(`pr-autopilot-post: labelled #${prNumber} [${labels.join(", ")}]`);
      else console.error(`pr-autopilot-post: WARN could not label #${prNumber} → HTTP ${lr.status}`);
    }
    process.exit(0);
  }
  const text = await res.text().catch(() => "");
  die(res.status < 500 ? 2 : 3, `POST comment → ${res.status}: ${text.slice(0, 300)}`);
}

function die(code, msg) {
  console.error(`pr-autopilot-post: ${msg}`);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => die(3, e instanceof Error ? e.message : String(e)));
}
