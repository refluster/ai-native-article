#!/usr/bin/env node
// The merge gate for the session-run pr-autopilot lane
// (docs/adr/adr-0009-session-run-autopilot-lane.md; governance.md §4.4).
//
// The only path by which a Claude Code session merges a PR. It decides
// nothing itself: it hands one `merge` decision to the workforce's fail-closed
// engine `workforce/skills/pr-autopilot/pr-merge.mjs` — the same engine the
// cron lane uses — which re-reads the live PR and refuses unless the whole
// §4.4 / R-N10 predicate holds (no L0/L1 path, ≥ 3 distinct reviewers each
// with a `<!-- autopilot:review:{slug}:green -->` marker, no CHANGES_REQUESTED,
// mergeable + checks green, no `autopilot:off`, cycle cap).
//
//   node scripts/claude/autopilot-merge.mjs 1234 --reviewers dario,ren,farah
//   node scripts/claude/autopilot-merge.mjs 1234 --reviewers dario,ren,farah --dry-run
//
// Engine: taken from `origin/main` on every run (`git archive` into a temp
// dir), never from the PR's own branch — a PR cannot change the predicate
// that judges it.
// Credential: the workforce's project PAT from AWS Secrets Manager
// (`wf/projects/agent-workforce/github.token`, the same secret the cron lane
// is injected with). Passed to the engine through the environment only;
// never printed.
//
// Exit: 0 merged (or dry-run eligible) · 2 refused by the engine · 1 setup error.
import { ensureProxyAwareEntry } from "../lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIN_REVIEWERS, REPO, parseReviewers, tokenFromSecretString } from "../lib/autopilot-session.mjs";

const SECRET_ID = process.env.WF_GITHUB_SECRET_ID || "wf/projects/agent-workforce/github.token";
const REGION = process.env.WF_AWS_REGION || "us-west-2";
const ENGINE_PATHS = ["workforce/skills/pr-autopilot", "workforce/scripts/lib", "scripts/lib"];
const ENGINE = "workforce/skills/pr-autopilot/pr-merge.mjs";

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, ...opts });

class GateError extends Error {}
function fail(_pr, msg) { throw new GateError(msg); }

function args(argv) {
  const out = { pr: null, reviewers: "", dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reviewers") out.reviewers = argv[++i] ?? "";
    else if (a === "--dry-run") out.dryRun = true;
    else if (/^\d+$/.test(a)) out.pr = Number(a);
  }
  return out;
}

function resolveToken() {
  const r = run("aws", ["secretsmanager", "get-secret-value", "--region", REGION, "--secret-id", SECRET_ID,
    "--query", "SecretString", "--output", "text"]);
  if (r.status !== 0) return { err: `cannot read ${SECRET_ID} from Secrets Manager (${(r.stderr || "").trim().split("\n").pop()?.slice(0, 160)})` };
  const token = tokenFromSecretString(r.stdout.trim());
  return token ? { token } : { err: `${SECRET_ID} has no "token" field` };
}

function fetchEngine(dest) {
  const f = run("git", ["fetch", "-q", "--depth=1", "origin", "main"]);
  if (f.status !== 0) return `git fetch origin main failed: ${(f.stderr || "").trim().slice(0, 200)}`;
  const tar = join(dest, "engine.tar");
  const a = run("git", ["archive", "-o", tar, "FETCH_HEAD", ...ENGINE_PATHS]);
  if (a.status !== 0) return `git archive failed: ${(a.stderr || "").trim().slice(0, 200)}`;
  const x = run("tar", ["-xf", tar, "-C", dest]);
  if (x.status !== 0) return `tar failed: ${(x.stderr || "").trim().slice(0, 200)}`;
  return null;
}

// Run a snippet against the engine module. argv[1] is a placeholder so the
// engine's own "am I the entry point?" check (argv[1] === its path) stays
// false; the snippet reads argv[2] = engine path, argv[3..] = its arguments.
function engineSnippet(env, engine, code, ...rest) {
  return run(process.execPath, ["--disable-warning=UNDICI-EHPA", "--input-type=module", "-e", code, "--", "_", engine, ...rest], { env });
}

function lastJson(stdout) {
  try { return JSON.parse(String(stdout).trim().split("\n").pop()); } catch { return null; }
}

const { pr, reviewers: csv, dryRun } = args(process.argv);
if (!pr) { console.error("usage: autopilot-merge.mjs <PR> --reviewers a,b,c [--dry-run]"); process.exit(1); }
const reviewers = parseReviewers(csv);
if (reviewers.length < MIN_REVIEWERS) {
  console.log(`#${pr} ✋ gate: ${reviewers.length} reviewer(s) given; the panel needs ≥ ${MIN_REVIEWERS}`);
  process.exit(1);
}

const { token, err } = resolveToken();
if (err) { console.log(`#${pr} ✋ gate: ${err}`); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), "wf-engine-"));
let exitCode = 1;
try {
  const ferr = fetchEngine(tmp);
  if (ferr) fail(pr, ferr);
  const engine = join(tmp, ENGINE);
  const env = { ...process.env, TOKEN: token, GITHUB_TOKEN: token };
  if (env.HTTPS_PROXY || env.https_proxy) env.NODE_USE_ENV_PROXY = "1"; // R-14: route fetch() via the agent proxy

  // GitHub computes mergeability lazily (null right after a push). Settle it, ≤ ~60 s.
  const settle = engineSnippet(env, engine, `
    const m = await import(process.argv[2]);
    const gh = m.makeGh({ token: process.env.TOKEN, userAgent: "session-merge-gate" });
    let p = {};
    for (let i = 0; i < 12; i++) {
      const r = await gh("GET", "/repos/" + process.argv[3] + "/pulls/" + process.argv[4]);
      p = r.json || {};
      if (r.status !== 200 || p.mergeable !== null) break;
      await new Promise((s) => setTimeout(s, 5000));
    }
    console.log(JSON.stringify({ title: p.title ?? null, state: p.state ?? null }));`, REPO, String(pr));
  const head = lastJson(settle.stdout);
  if (!head?.title) fail(pr, `cannot read the PR (${(settle.stderr || "").trim().split("\n").pop()?.slice(0, 200)})`);

  if (dryRun) {
    const v = lastJson(engineSnippet(env, engine, `
      const m = await import(process.argv[2]);
      const gh = m.makeGh({ token: process.env.TOKEN, userAgent: "session-merge-gate" });
      const v = await m.verifyMergeable(gh, process.argv[3], Number(process.argv[4]), { reviewers: process.argv[5].split(",") });
      console.log(JSON.stringify(v));`, REPO, String(pr), reviewers.join(",")).stdout);
    if (!v) fail(pr, "engine error during dry-run");
    console.log(`#${pr} ${v.ok ? "✅ eligible" : "⛔ not eligible"}: ${v.why}`);
    exitCode = v.ok ? 0 : 2;
  } else {
    const list = reviewers.map((r) => "`wf:" + r + "`").join(", ");
    const decisions = { decisions: [{
      pr, action: "merge", reviewers,
      comment: `Autopilot merge (session-run lane, docs/adr/adr-0009): unanimous green from ${list}; no L0/L1 surface; ` +
        "the predicate was re-verified by the workforce engine `pr-merge.mjs` (origin/main) immediately before this merge.",
      squash_subject: `${head.title} (#${pr})`,
      squash_body: `Unanimous reviewer sign-off (${reviewers.join(", ")}). No L0/L1 surface. Session-run lane (ADR-0009).`,
    }] };
    const dfile = join(tmp, "decisions.json");
    writeFileSync(dfile, JSON.stringify(decisions));
    const r = run(process.execPath, ["--disable-warning=UNDICI-EHPA", engine, "--repo", REPO, "--decisions", dfile], { env });
    const result = lastJson(r.stdout) || {};
    if (r.status === 0 && result.merged === 1) {
      console.log(`#${pr} ✅ merged by the engine (reviewers: ${reviewers.join(", ")})`);
      exitCode = 0;
    } else {
      const why = (r.stderr || "").split("\n").find((l) => /REFUSE|REJECTED/.test(l)) || (r.stderr || "").trim().slice(-300);
      console.log(`#${pr} ⛔ engine refused: ${why}`);
      exitCode = 2;
    }
  }
} catch (e) {
  if (!(e instanceof GateError)) throw e;
  console.log(`#${pr} ✋ gate: ${e.message}`);
  exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(exitCode);
