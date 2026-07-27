// @ts-nocheck — the module under test (collect.mjs) is a dependency-free ESM
// CLI script, not TS. Spawned as a real child process against a FAKE repo
// tree built in a temp dir (mkdtempSync), matching the weekly-project-report /
// pr-autopilot spawn-the-real-script test convention. The GitHub Actions
// fetch is pointed at an unroutable host (127.0.0.1:1) so no live network
// call happens; collect.mjs's own self-observation guard turns that failure
// into a finding rather than a crash — this suite proves that path.
// Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "collect.mjs");

const STALE_BACKLOG = `## 3. Backlog

<!-- registry:memory-lint columns: ID | Rule | Incidents | Count | Status | Promoted via -->

| ID | Rule | Incidents | Count | Status | Promoted via |
|---|---|---|---|---|---|
| ML-900 | Fixture rule, clearly stale. | (2026-01-01) | 1 | watching | — |
| ML-901 | Fixture rule, fresh. | (2026-07-20) | 1 | watching | — |
`;

function fakeRepoRoot(backlogContent) {
  const dir = mkdtempSync(join(tmpdir(), "oaw-repo-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "memory-lint-backlog.md"), backlogContent, "utf8");
  return dir;
}

function run(args, env) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

describe("collect.mjs — CLI guard contract + self-observation", () => {
  it("exit 1 when --repo is missing", () => {
    const r = run(["--repo-root", fakeRepoRoot(STALE_BACKLOG)], { GITHUB_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--repo/);
  });

  it("exit 1 when GITHUB_TOKEN is missing", () => {
    const r = run(["--repo", "test/test", "--repo-root", fakeRepoRoot(STALE_BACKLOG)], { GITHUB_TOKEN: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GITHUB_TOKEN/);
  });

  it("exit 3 when the local backlog file itself does not exist (fatal — nothing to read at all)", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "oaw-repo-empty-"));
    const r = run(["--repo", "test/test", "--repo-root", emptyRoot], {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(3);
  });

  it("self-observation: a network-unroutable GitHub Actions API becomes a finding, not a crash, and exit stays 0", () => {
    const r = run(["--repo", "test/test", "--repo-root", fakeRepoRoot(STALE_BACKLOG)], {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    const kinds = out.findings.map((f) => f.kind);
    expect(kinds).toContain("self-observation-failure");
    const selfFinding = out.findings.find((f) => f.kind === "self-observation-failure");
    expect(selfFinding.owner).toBe("petra");
  });

  it("surfaces a stale watching row from the fake repo tree, and does not flag the fresh one", () => {
    const r = run(["--repo", "test/test", "--repo-root", fakeRepoRoot(STALE_BACKLOG)], {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    const backlogFindings = out.findings.filter((f) => f.kind === "backlog-stale");
    expect(backlogFindings.map((f) => f.key)).toContain("backlog-stale:ML-900");
    expect(backlogFindings.map((f) => f.key)).not.toContain("backlog-stale:ML-901");
  });

  it("a clean-signal repo (no stale rows) still reports the memory-lint-backlog path as a swept surface", () => {
    const cleanBacklog = STALE_BACKLOG.replace("(2026-01-01)", "(2026-07-22)");
    const r = run(["--repo", "test/test", "--repo-root", fakeRepoRoot(cleanBacklog)], {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.sweptSurfaces).toContain("docs/memory-lint-backlog.md");
  });
});
