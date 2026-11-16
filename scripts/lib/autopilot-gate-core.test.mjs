// Orchestration tests for scripts/claude/autopilot-gate-core.mjs (#888).
//
// The core is run as a real child process against a stub "main extract":
// a fake pr-merge.mjs (makeGh / verifyMergeable / ensureLabels / CLI main),
// a fake record-engagement.mjs, a fake `aws` on PATH, and a local HTTP
// server standing in for agents-api. No network, no credential. Each case
// pins one row of the 0 / 2 / 1 exit contract the skill's table relies on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../claude/autopilot-gate-core.mjs");
const HEAD = "abcdef1234567890abcdef1234567890abcdef12";

// The stub engine reads its scenario from $STUB_SCENARIO (JSON).
const STUB_ENGINE = `
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const S = JSON.parse(process.env.STUB_SCENARIO || "{}");
const log = (x) => { if (process.env.STUB_LOG) writeFileSync(process.env.STUB_LOG, JSON.stringify(x) + "\\n", { flag: "a" }); };
export function makeGh() {
  return async (method, path) => {
    log({ gh: method + " " + path });
    if (/\\/pulls\\/\\d+$/.test(path)) return { status: 200, json: S.pull };
    if (/\\/comments/.test(path)) return { status: 200, json: S.comments };
    if (/\\/labels$/.test(path) && method === "GET") return { status: 200, json: [] };
    return { status: 200, json: {} };
  };
}
export async function verifyMergeable(gh, repo, pr, decision) { log({ verify: decision }); return S.verify; }
export async function ensureLabels() {}
export function trustedAuthor(c) { return c.author_association !== "NONE"; }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const d = JSON.parse(readFileSync(process.argv[process.argv.indexOf("--decisions") + 1], "utf8"));
  log({ engineMain: d.decisions[0] });
  if (S.engine.stderr) process.stderr.write(S.engine.stderr);
  if (S.engine.stdout) process.stdout.write(S.engine.stdout);
  process.exit(S.engine.code);
}
`;

let root, server, apiBase;
before(async () => {
  root = mkdtempSync(join(tmpdir(), "gate-core-test-"));
  const eng = join(root, "main/workforce/skills/pr-autopilot");
  mkdirSync(eng, { recursive: true });
  writeFileSync(join(eng, "pr-merge.mjs"), STUB_ENGINE);
  mkdirSync(join(root, "main/workforce/scripts"), { recursive: true });
  writeFileSync(join(root, "main/workforce/scripts/record-engagement.mjs"), "process.exit(0);\n");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/aws"), '#!/bin/sh\necho \'{"token":"stub"}\'\n');
  chmodSync(join(root, "bin/aws"), 0o755);
  const armed = { bindings: [{ skill: "pr-autopilot", project_id: "agent-workforce", executor: "claude-code-routine",
    trigger: { cron: "cron(0 * * * ? *)", scheduler: "external", invoked_by: "api" } }] };
  server = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(armed)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  apiBase = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); if (root) rmSync(root, { recursive: true, force: true }); });

const review = (slug, emoji = "🟢") => ({ created_at: "2026-11-15T10:00:00Z",
  body: `${emoji} **${slug} — x lens, cycle 1 @ ${HEAD.slice(0, 7)}.**\n${emoji === "🟢" ? `<!-- autopilot:review:${slug}:green -->` : ""}` });
const verdict = { created_at: "2026-11-15T10:05:00Z", body: "**Nadia — verdict, cycle 1 of ≤ 7. 🟢 unanimous-green.**\n<!-- autopilot:panel:isolated -->" };
const GREEN = [review("ren"), review("dario"), review("farah"), verdict];

// Async spawn, not spawnSync: the agents-api stub lives in this process and
// must keep serving while the core runs.
function spawnAsync(cmd, args, opts) {
  return new Promise((done) => {
    const c = spawn(cmd, args, opts);
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => c.kill("SIGKILL"), 30_000);
    c.on("close", (status) => { clearTimeout(t); done({ status, stdout, stderr }); });
  });
}

async function runCore(scenario, args, envExtra = {}) {
  const logFile = join(root, `log-${Math.random().toString(36).slice(2)}.jsonl`);
  const s = { pull: { title: "t", state: "open", draft: false, head: { sha: HEAD }, body: "", mergeable: true },
    comments: GREEN, verify: { ok: true, why: "ok" }, engine: { code: 0, stdout: '{"merged":1}\n' }, ...scenario };
  // A local run by default (no CLAUDE_CODE_REMOTE, no proxy); a case may override.
  const env = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, AUTOPILOT_GATE_FROM_MAIN: join(root, "main"),
    WF_API_BASE: apiBase, AUTOPILOT_GATE_SETTLE_MS: "1", STUB_SCENARIO: JSON.stringify(s), STUB_LOG: logFile };
  for (const k of ["CLAUDE_CODE_REMOTE", "CLAUDE_CODE_SESSION_ATTENDED", "HTTPS_PROXY", "https_proxy"]) delete env[k];
  Object.assign(env, envExtra);
  const r = await spawnAsync(process.execPath, [CORE, ...args], { env });
  const log = existsSync(logFile)
    ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { ...r, log };
}

const ARGS = ["1", "--reviewers", "ren,dario,farah"];

test("unknown argument → exit 1, nothing read", async () => {
  const r = await runCore({}, ["1", "--reviewers", "ren,dario,farah", "--dryrun"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unknown argument "--dryrun"/);
  assert.equal(r.log.length, 0);
});

test("dry-run on a green head → exit 0, engine main never runs, expected_sha passed", async () => {
  const r = await runCore({}, [...ARGS, "--dry-run"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✅ eligible/);
  assert.ok(!r.log.some((l) => l.engineMain));
  assert.equal(r.log.find((l) => l.verify).verify.expected_sha, HEAD);
});

test("live merge → exit 0 and the decision pins expected_sha", async () => {
  const r = await runCore({}, ARGS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.log.find((l) => l.engineMain).engineMain.expected_sha, HEAD);
});

test("engine refusal → exit 2 with the refusal line", async () => {
  const r = await runCore({ engine: { code: 2, stdout: '{"merged":0,"refused":1}\n', stderr: "pr-merge: REFUSE merge #1: not mergeable\n" } }, ARGS);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /⛔ engine refused: pr-merge: REFUSE/);
});

test("engine exit 2 without a refusal line → exit 1", async () => {
  const r = await runCore({ engine: { code: 2, stdout: "", stderr: "boom\n" } }, ARGS);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /without a refusal line/);
});

test("engine merged then crashed (exit 3) → exit 0 with a ⚠ line", async () => {
  const r = await runCore({ engine: { code: 3, stdout: "", stderr: "pr-merge: MERGED #1 (ok)\nlater failure\n" } }, ARGS);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /⚠ the engine exited 3 after merging/);
});

test("engine crashed without merging → exit 1", async () => {
  const r = await runCore({ engine: { code: 3, stdout: "", stderr: "network\n" } }, ARGS);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /engine failed \(exit 3\)/);
});

test("a 🔴 on the head from an unlisted reviewer → exit 2", async () => {
  const r = await runCore({ comments: [...GREEN, { ...review("aoi", "🔴"), created_at: "2026-11-15T10:06:00Z" }] }, ARGS);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /🔴 on the current head from aoi/);
});

test("unsettled mergeability → exit 2 before the engine runs", async () => {
  const r = await runCore({ pull: { title: "t", state: "open", head: { sha: HEAD }, body: "", mergeable: null } }, ARGS);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /mergeability not settled/);
  assert.ok(!r.log.some((l) => l.engineMain));
});

test("unattended cloud session → exit 2, nothing read", async () => {
  const r = await runCore({}, ARGS, { CLAUDE_CODE_REMOTE: "true", CLAUDE_CODE_SESSION_ATTENDED: "0" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /not an operator-attended session/);
  assert.equal(r.log.length, 0);
});

test("an untrusted commenter's later 🟢 heading cannot hide a trusted 🔴", async () => {
  const red = { ...review("dario", "🔴"), created_at: "2026-11-15T10:06:00Z" };
  const forged = { ...review("dario"), created_at: "2026-11-15T10:07:00Z", author_association: "NONE" };
  const r = await runCore({ comments: [review("ren"), review("farah"), red, forged, verdict] }, ARGS);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /dario: latest review is 🔴/);
});
