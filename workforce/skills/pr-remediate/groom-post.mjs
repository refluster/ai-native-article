#!/usr/bin/env node
// pr-remediate/groom-post.mjs — the GROOM lane's only GitHub write surface
// (adr-0030).
//
// Deliberately a separate script from pr-remediate-post.mjs rather than three
// more modes inside it. That script's job is to MOVE a PR between lanes: it
// adds `autopilot:needs-human`, clears the author label, dispatches a
// re-review. The groom lane may do none of those — it keeps an escalated PR
// applicable to a moved base and leaves every label, every reason code and the
// operator's decision exactly where they were. Sharing one file would mean the
// only thing stopping a groom run from un-escalating a PR is an `if`. Here it
// is the absence of the code.
//
// So: this script posts comments. It has no label call, no dispatch call, no
// merge call, and no `--resolved` — the PR does not leave the human lane,
// because leaving it is the operator's decision and that is the whole point.
//
//   --claim    FIRST, before any work, keyed to the CURRENT base SHA. A run
//              that dies mid-resolution has still spent this base's attempt;
//              the next attempt comes when the base moves, not immediately
//              (same inversion as the author lane's claim, `wf:farah` F1 on
//              #518, keyed differently because what is owed is one attempt per
//              base, not three per PR ever).
//   --pushed   the base was merged in and the result pushed to the head branch.
//   --blocked  the merge could not be resolved inside the lane's authority —
//              a non-additive conflict, a registry-id collision (ML-027), or a
//              failing check after the merge. Three consecutive blocked bases
//              and the scan stops offering the PR at all.
//
// Usage:
//   GITHUB_TOKEN=… node workforce/skills/pr-remediate/groom-post.mjs \
//     --project agent-workforce --pr 602 --base-sha <sha> \
//     ( --claim | --pushed --body-file … | --blocked --body-file … )
//
// Exit codes: 0 posted · 1 bad args / refused guard · 2 endpoint rejected ·
//             3 network / unexpected.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs"
ensureProxyAwareEntry(import.meta.url)

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { findRawMentions } from "../pr-autopilot/pr-autopilot-post.mjs";
import { GROOM_BLOCK_CAP, consecutiveBlocked, groomHistory, groomMarker } from "./groom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** The claim comment. Minimal by construction: it is posted before the work, so
 *  it must not depend on anything the work produces. */
export function groomClaimBody(baseSha) {
  const sha7 = String(baseSha).slice(0, 7);
  return [
    `**Groom attempt claimed at base \`${sha7}\`.**`,
    "",
    "Merging the base branch into this PR's head so it stays applicable while it waits for your decision. " +
      "Nothing about *why* this PR is escalated is being changed — no label moves, no finding is addressed, " +
      "and it is not being merged (adr-0030).",
    "",
    "This attempt is spent from here: if the run dies before recording an outcome, the next attempt comes " +
      "when the base moves again, not immediately.",
    "",
    "— pr-remediate, groom lane (see workforce/skills/pr-remediate/SKILL.md)",
    "",
    groomMarker(baseSha, "claimed"),
  ].join("\n");
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const prNumber = arg("pr");
  const baseSha = arg("base-sha");
  const bodyFile = arg("body-file");
  const claim = flag("claim");
  const pushed = flag("pushed");
  const blocked = flag("blocked");
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!prNumber || !/^\d+$/.test(prNumber)) return die(1, "--pr <number> is required (positive integer)");

  const modes = [claim, pushed, blocked].filter(Boolean).length;
  if (modes !== 1) return die(1, "pass exactly one of --claim / --pushed / --blocked");
  if (!claim && !bodyFile) return die(1, "--body-file <path> is required for --pushed / --blocked");

  const outcome = claim ? "claimed" : pushed ? "pushed" : "blocked";
  let marker;
  try {
    marker = groomMarker(baseSha, outcome);
  } catch (e) {
    return die(1, `--base-sha: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!repo && projectId) {
    try {
      const r = projectRepo(REPO_ROOT, projectId);
      repo = `${r.owner}/${r.repo}`;
    } catch (e) {
      return die(1, e.message);
    }
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) return die(1, "--repo <owner>/<repo> (or --project <id>) is required");

  let body;
  if (claim) {
    body = groomClaimBody(baseSha);
  } else {
    try {
      body = readFileSync(bodyFile, "utf8");
    } catch {
      return die(1, `body-file unreadable: ${bodyFile}`);
    }
    if (body.trim().length === 0) return die(1, "body-file is empty — refusing to post an empty groom record (W-4)");
  }

  // ML-012, imported from the sibling write surface: persona slugs are not
  // GitHub accounts and a raw @ notifies the real user who owns that name.
  const mentions = findRawMentions(body);
  if (mentions.length > 0) {
    return die(1, `body contains raw GitHub @-mention(s): ${mentions.join(", ")} — reference agents as \`wf:<slug>\` (ML-012)`);
  }
  if (!body.includes(marker)) body = `${body.trimEnd()}\n\n${marker}\n`;

  const gh = makeGh({ token, userAgent: "workforce-pr-groom" });

  let history = [];
  try {
    const cs = await gh("GET", `/repos/${repo}/issues/${prNumber}/comments?per_page=100`);
    history = groomHistory(Array.isArray(cs.json) ? cs.json.map((x) => x.body) : []);
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }

  // A claim at a base this PR was already groomed at would be a loop: nothing
  // moved since the last attempt, so the same resolution would fail the same
  // way. Refuse rather than guess (C-4). The outcome shapes are exempt — they
  // record the claim that is already spent.
  if (claim) {
    const sha7 = String(baseSha).toLowerCase().slice(0, 7);
    if (history.some((h) => h.sha === sha7)) {
      return die(1, `#${prNumber} already carries a groom marker at base ${sha7} — nothing has moved since; wait for the base to advance (adr-0030)`);
    }
    const blockedStreak = consecutiveBlocked(history);
    if (blockedStreak >= GROOM_BLOCK_CAP) {
      return die(1, `#${prNumber} has ${blockedStreak} consecutive blocked groom attempts (cap ${GROOM_BLOCK_CAP}) — the lane has stopped touching it (adr-0030)`);
    }
  }

  let c;
  try {
    c = await gh("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body });
  } catch (e) {
    return die(3, e?.msg || e?.message || String(e));
  }
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);

  console.error(`groom-post: ${repo}#${prNumber} ${outcome} at base ${String(baseSha).slice(0, 7)}`);
  return 0;
}

function die(code, msg) {
  console.error(`groom-post: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
