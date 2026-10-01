#!/usr/bin/env node
// issue-triage/issue-handback.mjs — the worker→router return leg (adr-0038).
//
// A lane worker (`issue-implement`, `issue-design`) that cannot take an issue
// calls this instead of writing labels by hand. It posts the stated reason,
// stamps `wf:handback`, clears the caller's own in-progress marker, and asks
// the router to fire NOW so the issue is re-laned in seconds rather than at the
// next cron — or, before adr-0038, after a 14-day requeue window.
//
// WHY THIS IS ONE SCRIPT AND NOT A PARAGRAPH IN TWO SKILL BODIES. The state it
// writes is the ROUTER's vocabulary, so the router owns its only writer — the
// same reason `issue-triage-post.mjs` is the only writer of `wf:lane:*`. It
// also removes the thing that actually went wrong: each worker used to stamp
// its own `issue-<skill>:needs-human`, a label whose name asserts that a HUMAN
// is required when all the worker knows is that the work is not ITS OWN. On
// PSVL/asp-cloud that conflation parked 18 issues — including #866, where the
// engineer cadence reasoned correctly and still left behind a label claiming a
// decision nobody had made. `wf:handback` claims only "not mine; router,
// decide", and the router is what answers it.
//
// Usage (from a worker's session):
//   GITHUB_TOKEN=… node workforce/skills/issue-triage/issue-handback.mjs \
//     --project asp-cloud --issue 866 --from issue-implement \
//     --body-file /tmp/handback-866.md
//
// Exit codes: 0 posted · 1 bad args / refused guard · 2 endpoint rejected · 3 network.

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectRepo } from "../pr-autopilot/pr-autopilot-scan.mjs";
import { makeGh } from "../pr-autopilot/pr-merge.mjs";
import { findRawMentions } from "../pr-autopilot/pr-autopilot-post.mjs";
import { HANDBACK_LABEL } from "./issue-lanes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** The lane workers allowed to hand back, and the in-progress marker each one
 *  must be relieved of. A closed set for the same reason the lanes are: a
 *  hand-back from a cadence that is not a lane worker is a bug, not a state. */
export const HANDBACK_CALLERS = Object.freeze({
  "issue-implement": "issue-implement:in-progress",
  "issue-design": "issue-design:in-progress",
});

const HANDBACK_LABEL_META = {
  color: "fbca04",
  description: "A lane worker declined this issue; the router re-lanes it (adr-0038). Not a claim that a human is needed.",
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const projectId = arg("project");
  const issue = arg("issue");
  const from = arg("from");
  const bodyFile = arg("body-file");
  let repo = arg("repo");

  if (!token) return die(2, "GITHUB_TOKEN (or GH_TOKEN) env is required");
  if (!issue || !/^\d+$/.test(issue)) return die(1, "--issue <number> is required (positive integer)");
  if (!from || !(from in HANDBACK_CALLERS)) {
    return die(1, `--from must be one of: ${Object.keys(HANDBACK_CALLERS).join(", ")} (got "${from}")`);
  }
  if (!bodyFile) return die(1, "--body-file <path> is required — a hand-back with no stated reason is just a shrug");
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
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    return die(1, `body-file unreadable: ${bodyFile}`);
  }
  if (body.trim().length === 0) return die(1, "body-file is empty — refusing to post an empty hand-back (W-4)");
  const mentions = findRawMentions(body);
  if (mentions.length > 0) {
    return die(1, `body contains raw GitHub @-mention(s): ${mentions.join(", ")} — reference agents as \`wf:<slug>\` (ML-012)`);
  }

  const gh = makeGh({ token, userAgent: "workforce-issue-handback" });

  const c = await gh("POST", `/repos/${repo}/issues/${issue}/comments`, { body });
  if (c.status !== 201) return die(c.status < 500 ? 2 : 3, `POST comment -> HTTP ${c.status}`);

  const cr = await gh("POST", `/repos/${repo}/labels`, { name: HANDBACK_LABEL, ...HANDBACK_LABEL_META });
  if (cr.status !== 201 && cr.status !== 422) console.error(`issue-handback: WARN ensure label -> HTTP ${cr.status}`);

  const l = await gh("POST", `/repos/${repo}/issues/${issue}/labels`, { labels: [HANDBACK_LABEL] });
  if (l.status !== 200) return die(l.status < 500 ? 2 : 3, `label #${issue} -> HTTP ${l.status}`);

  // Relieve the caller's own in-progress marker — otherwise the router's scan
  // reads the issue as actively held and skips it, which would make the
  // hand-back an absorbing state all over again.
  const held = HANDBACK_CALLERS[from];
  const d = await gh("DELETE", `/repos/${repo}/issues/${issue}/labels/${encodeURIComponent(held)}`);
  if (d.status !== 200 && d.status !== 404) console.error(`issue-handback: WARN could not clear "${held}" -> HTTP ${d.status}`);

  console.error(`issue-handback: #${issue} handed back by ${from} -> ${HANDBACK_LABEL}`);

  // adr-0025's mechanism, the intake side's return leg. Best-effort: the label
  // above is the load-bearing write and the router's cron is the floor.
  if (projectId) {
    const { requestDispatch } = await import("../../scripts/lib/request-dispatch.mjs");
    await requestDispatch({
      skill: "issue-triage",
      project_id: projectId,
      reason: `issue #${issue} handed back by ${from} on ${repo} — needs re-laning`,
    }).catch((e) => console.error(`issue-handback: WARN router dispatch failed (${e?.message || e})`));
  } else {
    console.error("issue-handback: --project not given — issue-triage will start on its own cron, not now");
  }

  return 0;
}

function die(code, msg) {
  console.error(`issue-handback: ${msg}`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main().catch((e) => die(3, e instanceof Error ? e.message : String(e))));
}
