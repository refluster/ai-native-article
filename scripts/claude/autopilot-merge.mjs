#!/usr/bin/env node
// The merge gate for the session-run pr-autopilot lane
// (docs/adr/adr-0009-session-run-autopilot-lane.md; governance.md §4.4).
// The only path by which a Claude Code session merges a PR.
//
//   node scripts/claude/autopilot-merge.mjs 1234 --reviewers dario,ren,farah
//   node scripts/claude/autopilot-merge.mjs 1234 --reviewers dario,ren,farah --dry-run
//
// This file is a launcher and deliberately imports nothing from the working
// tree (only node: built-ins): the working tree is usually the PR's own
// branch. It fetches origin/main into a throw-away repo — the caller's clone
// is not touched — extracts the gate core, its ../lib and the workforce
// engine, and runs main's `scripts/claude/autopilot-gate-core.mjs`. All the
// checks live there, so a PR cannot change the code that judges it.
//
// Before ADR-0009 is on main there is no core to run: the launcher refuses a
// live merge and allows only `--dry-run` against the local core.
//
// Exit: the core's (0 merged / eligible · 2 refused · 1 setup error);
// 1 when main cannot be fetched.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = "scripts/claude/autopilot-gate-core.mjs";
const PATHS = ["workforce/skills/pr-autopilot", "workforce/scripts/lib", "workforce/scripts/record-engagement.mjs",
  "workforce/projects", "scripts/lib", "scripts/claude"];

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
const tail = (s) => String(s ?? "").trim().split("\n").pop()?.slice(0, 200) ?? "";
const prArg = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "?";
const say = (msg) => console.log(`#${prArg} ✋ gate: ${msg}`);

function fetchMain(dest) {
  const origin = run("git", ["-C", REPO_ROOT, "remote", "get-url", "origin"]).stdout.trim();
  if (!origin) return "cannot resolve the origin remote";
  const git = join(dest, "main.git");
  for (const step of [["init", "-q", "--bare", git], ["-C", git, "fetch", "-q", "--depth=1", origin, "main"]]) {
    const r = run("git", step);
    if (r.status !== 0) return `git ${step[0] === "init" ? "init" : "fetch of main"} failed: ${tail(r.stderr)}`;
  }
  const tar = join(dest, "main.tar");
  let a = run("git", ["-C", git, "archive", "-o", tar, "FETCH_HEAD", ...PATHS]);
  if (a.status !== 0) a = run("git", ["-C", git, "archive", "-o", tar, "FETCH_HEAD", ...PATHS.filter((p) => p !== "scripts/claude")]);
  if (a.status !== 0) return `git archive failed: ${tail(a.stderr)}`;
  const x = run("tar", ["-xf", tar, "-C", dest]);
  return x.status === 0 ? null : `tar failed: ${tail(x.stderr)}`;
}

const tmp = mkdtempSync(join(tmpdir(), "wf-gate-"));
let code = 1;
try {
  const err = fetchMain(tmp);
  if (err) {
    say(err);
  } else {
    let core = join(tmp, CORE);
    if (!existsSync(core)) {
      // Bootstrap: main does not carry the lane yet (ADR-0009 unmerged).
      if (!process.argv.includes("--dry-run")) {
        say("main does not carry the gate yet (ADR-0009 not merged); only --dry-run is allowed");
        core = null;
      } else {
        core = join(REPO_ROOT, CORE);
        console.log(`#${prArg} ℹ bootstrap: main has no gate core yet — dry-run uses the local one`);
      }
    }
    if (core) {
      const r = spawnSync(process.execPath, [core, ...process.argv.slice(2)],
        { stdio: "inherit", env: { ...process.env, AUTOPILOT_GATE_FROM_MAIN: tmp }, cwd: REPO_ROOT });
      code = r.status ?? 1;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
