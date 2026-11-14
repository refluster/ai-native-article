#!/usr/bin/env node
// The core of the session-run merge gate (docs/adr/adr-0009; governance.md §4.4).
// Never run this file directly: `scripts/claude/autopilot-merge.mjs` (the
// launcher) fetches origin/main into a throw-away repo and executes *main's*
// copy of this file with AUTOPILOT_GATE_FROM_MAIN=<that extract>, so this code,
// its ../lib imports and the engine all come from main — a PR cannot change
// the code that judges it.
//
// It decides nothing itself: it hands one `merge` decision to the workforce's
// fail-closed engine `workforce/skills/pr-autopilot/pr-merge.mjs` (the cron
// lane's engine), which re-reads the live PR and refuses unless the §4.4 /
// R-N10 predicate holds. Before that it makes the checks the session lane
// needs and the engine does not:
//   - R-N10 clause 3: the nadia × pr-autopilot × agent-workforce binding is
//     armed (agents-api; paused / scheduler≠external / missing / unreadable → refuse);
//   - head-pinned panel: each reviewer's latest review is 🟢 on the PR's
//     current head commit, and a 🟢 isolated-panel verdict follows them.
// After a merge it removes stale `autopilot:reason:*` labels, stamps
// `autopilot:merged` and records the engagement (R-N10 clause 4).
// Credential: the workforce project PAT from AWS Secrets Manager
// (`wf/projects/agent-workforce/github.token`), passed to children through the
// environment only; never printed.
//
// Exit: 0 merged (or dry-run eligible) · 2 refused by the engine or a gate
// check (no merge made) · 1 setup / infrastructure error.
import { ensureProxyAwareEntry } from "../lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_REVIEWERS, REPO, gateExitFor, greenVerdictAfter, headPinnedPanel, killSwitchArmed, parseReviewers, tokenFromSecretString } from "../lib/autopilot-session.mjs";

const SECRET_ID = process.env.WF_GITHUB_SECRET_ID || "wf/projects/agent-workforce/github.token";
const REGION = process.env.WF_AWS_REGION || "us-west-2";
const WF_API = (process.env.WF_API_BASE || "https://workforce-api.kohuehara.xyz").replace(/\/$/, "");
const ENGINE = "workforce/skills/pr-autopilot/pr-merge.mjs";
const FROM_MAIN = "AUTOPILOT_GATE_FROM_MAIN";

class GateError extends Error {
  constructor(msg, code = 1) { super(msg); this.code = code; }
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, ...opts });
const tail = (s, n = 200) => String(s ?? "").trim().split("\n").pop()?.slice(0, n) ?? "";

function parseArgs(argv) {
  const out = { pr: null, reviewers: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reviewers") out.reviewers = argv[++i] ?? "";
    else if (a === "--dry-run") out.dryRun = true;
    else if (/^\d+$/.test(a) && out.pr === null) out.pr = Number(a);
    else throw new GateError(`unknown argument "${a}"`); // a typo must never mean "live merge"
  }
  if (!out.pr || out.reviewers === null) throw new GateError("usage: autopilot-merge.mjs <PR> --reviewers a,b,c [--dry-run]");
  return out;
}

function resolveToken() {
  const r = run("aws", ["secretsmanager", "get-secret-value", "--region", REGION, "--secret-id", SECRET_ID,
    "--query", "SecretString", "--output", "text"]);
  if (r.status !== 0) throw new GateError(`cannot read ${SECRET_ID} from Secrets Manager (${tail(r.stderr, 160)})`);
  const token = tokenFromSecretString(r.stdout.trim());
  if (!token) throw new GateError(`${SECRET_ID} has no "token" field`);
  return token;
}

// Run a snippet against the engine module. argv[1] is a placeholder so the
// engine's "am I the entry point?" check (argv[1] === its path) stays false;
// the snippet reads argv[2] = engine path, argv[3..] = its arguments.
function engineSnippet(env, engine, code, ...rest) {
  return run(process.execPath, ["--disable-warning=UNDICI-EHPA", "--input-type=module", "-e", code, "--", "_", engine, ...rest], { env });
}
function lastJson(stdout) {
  try { return JSON.parse(String(stdout).trim().split("\n").pop()); } catch { return null; }
}

const READ_PR = `
  const m = await import(process.argv[2]);
  const gh = m.makeGh({ token: process.env.TOKEN, userAgent: "session-merge-gate" });
  const repo = process.argv[3], n = process.argv[4];
  let p = {};
  for (let i = 0; i < 12; i++) {           // mergeability is computed lazily: settle ≤ ~60 s
    const r = await gh("GET", "/repos/" + repo + "/pulls/" + n);
    if (r.status !== 200) { console.log(JSON.stringify({ error: "GET pull HTTP " + r.status })); process.exit(0); }
    p = r.json;
    if (p.mergeable !== null) break;
    await new Promise((s) => setTimeout(s, 5000));
  }
  const comments = [];
  for (let page = 1; page <= 20; page++) {
    const r = await gh("GET", "/repos/" + repo + "/issues/" + n + "/comments?per_page=100&page=" + page);
    if (r.status !== 200) { console.log(JSON.stringify({ error: "GET comments HTTP " + r.status })); process.exit(0); }
    comments.push(...r.json.map((c) => ({ body: c.body, created_at: c.created_at })));
    if (r.json.length < 100) break;
  }
  console.log(JSON.stringify({ title: p.title, state: p.state, draft: p.draft, head: p.head?.sha, comments }));`;

const AFTER_MERGE = `
  const m = await import(process.argv[2]);
  const gh = m.makeGh({ token: process.env.TOKEN, userAgent: "session-merge-gate" });
  const repo = process.argv[3], n = process.argv[4];
  const r = await gh("GET", "/repos/" + repo + "/issues/" + n + "/labels");
  const stale = (r.json || []).map((l) => l.name).filter((x) => x.startsWith("autopilot:reason:") || x === "autopilot:needs-author");
  for (const name of stale) await gh("DELETE", "/repos/" + repo + "/issues/" + n + "/labels/" + encodeURIComponent(name));
  await m.ensureLabels(gh, repo, ["autopilot:merged"]);
  const a = await gh("POST", "/repos/" + repo + "/issues/" + n + "/labels", { labels: ["autopilot:merged"] });
  console.log(JSON.stringify({ removed: stale, labelled: a.status === 200 }));`;

async function gate({ pr, reviewers, dryRun }, engineDir) {
  if (reviewers.length < MIN_REVIEWERS) throw new GateError(`${reviewers.length} reviewer(s) given; the panel needs ≥ ${MIN_REVIEWERS}`);

  // R-N10 clause 3: the per-binding kill-switch. Unreadable → fail closed (exit 1).
  let agent = null;
  try {
    const res = await fetch(`${WF_API}/agents/nadia`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    agent = await res.json();
  } catch (e) {
    throw new GateError(`agents-api unreachable at ${WF_API} (${e?.message || e}); set WF_API_BASE to a reachable base`);
  }
  const ks = killSwitchArmed(agent);
  if (!ks.ok) throw new GateError(`kill-switch off (R-N10 clause 3): ${ks.why}`, 2);

  const token = resolveToken();
  const engine = join(engineDir, ENGINE);
  const env = { ...process.env, TOKEN: token, GITHUB_TOKEN: token };
  if (env.HTTPS_PROXY || env.https_proxy) env.NODE_USE_ENV_PROXY = "1"; // R-14 for the children

  const live = lastJson(engineSnippet(env, engine, READ_PR, REPO, String(pr)).stdout);
  if (!live || live.error || !live.title) throw new GateError(`cannot read the PR (${live?.error ?? "engine error"})`);
  if (live.state !== "open") throw new GateError(`PR is ${live.state}`, 2);

  const panel = headPinnedPanel(live.comments, reviewers, live.head);
  if (!panel.ok) {
    console.log(`#${pr} ⛔ gate refused (head-pinned panel): ${panel.why}`);
    return 2;
  }
  if (!greenVerdictAfter(live.comments, panel.newestReviewAt)) {
    console.log(`#${pr} ⛔ gate refused (head-pinned panel): no 🟢 isolated-panel verdict after the latest reviews`);
    return 2;
  }

  if (dryRun) {
    const v = lastJson(engineSnippet(env, engine, `
      const m = await import(process.argv[2]);
      const gh = m.makeGh({ token: process.env.TOKEN, userAgent: "session-merge-gate" });
      const v = await m.verifyMergeable(gh, process.argv[3], Number(process.argv[4]), { reviewers: process.argv[5].split(",") });
      console.log(JSON.stringify(v));`, REPO, String(pr), reviewers.join(",")).stdout);
    if (!v) throw new GateError("engine error during dry-run");
    const draft = v.ok && live.draft ? " (draft: the real run must un-draft it first, which can fail)" : "";
    console.log(`#${pr} ${v.ok ? "✅ eligible" : "⛔ not eligible"}: ${v.why}${draft}`);
    return v.ok ? 0 : 2;
  }

  const list = reviewers.map((r) => "`wf:" + r + "`").join(", ");
  const dfile = join(engineDir, "decisions.json");
  writeFileSync(dfile, JSON.stringify({ decisions: [{
    pr, action: "merge", reviewers,
    comment: `Autopilot merge (session-run lane, docs/adr/adr-0009): unanimous green from ${list} on head ` +
      `\`${live.head.slice(0, 7)}\`; no L0/L1 surface; the predicate was re-verified by the workforce engine ` +
      "`pr-merge.mjs` (origin/main) immediately before this merge.",
    squash_subject: `${live.title} (#${pr})`,
    squash_body: `Unanimous reviewer sign-off (${reviewers.join(", ")}). No L0/L1 surface. Session-run lane (ADR-0009).`,
  }] }));
  const r = run(process.execPath, ["--disable-warning=UNDICI-EHPA", engine, "--repo", REPO, "--decisions", dfile], { env });
  const result = lastJson(r.stdout) || {};
  const code = gateExitFor(r.status, result.merged === 1);
  if (code === 2) {
    const why = (r.stderr || "").split("\n").find((l) => /REFUSE|REJECTED/.test(l)) || tail(r.stderr, 300);
    console.log(`#${pr} ⛔ engine refused: ${why}`);
    return 2;
  }
  if (code === 1) throw new GateError(`engine failed (exit ${r.status ?? "signal"}): ${tail(r.stderr, 300)}`);

  console.log(`#${pr} ✅ merged by the engine (reviewers: ${reviewers.join(", ")})`);
  const after = lastJson(engineSnippet(env, engine, AFTER_MERGE, REPO, String(pr)).stdout);
  if (!after?.labelled) console.log(`#${pr} ⚠ merged, but the autopilot:merged label was not applied`);
  const eng = run(process.execPath, [join(engineDir, "workforce/scripts/record-engagement.mjs"),
    "--agent", "nadia", "--skill", "pr-autopilot", "--project", "agent-workforce", "--status", "ok",
    "--summary", `Session-run lane merged #${pr} (external-pr-merge) after unanimous green from ${reviewers.join(", ")}.`,
    "--uri", `https://github.com/${REPO}/pull/${pr}`], { env: process.env });
  if (eng.status !== 0) console.log(`#${pr} ⚠ merged, but the engagement was not recorded: ${tail(eng.stderr)}`);
  return 0;
}

let exitCode = 1;
let pr = "?";
try {
  const engineDir = process.env[FROM_MAIN];
  if (!engineDir) throw new GateError("run scripts/claude/autopilot-merge.mjs, not the core directly");
  const a = parseArgs(process.argv);
  pr = a.pr;
  exitCode = await gate({ ...a, reviewers: parseReviewers(a.reviewers) }, engineDir);
} catch (e) {
  if (!(e instanceof GateError)) throw e;
  console.log(`#${pr} ✋ gate: ${e.message}`);
  exitCode = e.code;
}
process.exit(exitCode);
