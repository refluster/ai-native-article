// @ts-nocheck — the module under test (sync-issues.mjs) is a dependency-free
// ESM CLI script, not TS. Spawned as a real child process (spawnSync
// convention); GITHUB_API_URL is pointed at an unroutable host so no live
// network call happens — every case here proves guard order, not live API
// behaviour. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "sync-issues.mjs");

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "oaw-sync-"));
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}

function run(args, env) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

const ONE_FINDING = JSON.stringify({
  generatedAt: "2026-07-23T00:00:00Z",
  sweptSurfaces: ["ci.yml"],
  findings: [
    {
      kind: "ci-run",
      key: "ci-run:ci.yml",
      label: "ci.yml — failure",
      detailLines: ["x"],
      sourceUrl: "https://example.test",
      owner: "dario",
      ownerReason: "workforce engineering surface",
      project: "workforce",
      closeCondition: "Close when green.",
    },
  ],
});

describe("sync-issues.mjs — CLI guard contract", () => {
  it("exit 1 when --repo is missing", () => {
    const r = run(["--findings-file", tmpFile("f.json", ONE_FINDING)], { GITHUB_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--repo/);
  });

  it("exit 1 when --findings-file is missing", () => {
    const r = run(["--repo", "test/test"], { GITHUB_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--findings-file/);
  });

  it("exit 1 when GITHUB_TOKEN is missing", () => {
    const r = run(["--repo", "test/test", "--findings-file", tmpFile("f2.json", ONE_FINDING)], { GITHUB_TOKEN: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GITHUB_TOKEN/);
  });

  it("exit 1 when --findings-file does not parse as JSON", () => {
    const r = run(["--repo", "test/test", "--findings-file", tmpFile("bad.json", "not json")], { GITHUB_TOKEN: "t" });
    expect(r.status).toBe(1);
  });

  it("guards pass and only the network call fails against an unroutable API host (proves guard order)", () => {
    const r = run(["--repo", "test/test", "--findings-file", tmpFile("f3.json", ONE_FINDING)], {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect([2, 3]).toContain(r.status);
  });

  it("an empty findings list is a no-op success, not an error", () => {
    const empty = JSON.stringify({ generatedAt: "2026-07-23T00:00:00Z", sweptSurfaces: [], findings: [] });
    const r = run(["--repo", "test/test", "--findings-file", tmpFile("empty.json", empty)], {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });
});
