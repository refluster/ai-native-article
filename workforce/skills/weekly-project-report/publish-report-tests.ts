// Guard tests for publish-report.mjs (G1–G6 + arg validation). Every case
// here fails BEFORE any network call, so the suite needs no GitHub mock —
// it drives the real script as a child process and asserts exit code +
// stderr, the same interface the agent-runner sees.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "publish-report.mjs");
const dir = mkdtempSync(join(tmpdir(), "wpr-"));

const FRONTMATTER = "---\ntitle: t\nproject: p\ndate: 2026-07-28\nkind: weekly\nlang: ja\n---\n\n";
const longProse = (n: number) => `${"これはレポート本文の一文です。".repeat(Math.ceil(n / 14))}`.slice(0, n) + "以上で本文を終える。";

function bodyFile(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

const BASE_ARGS = [
  "--agent", "elena",
  "--owner", "PSVL",
  "--repo", "project-ind",
  "--slug", "2026-07-28-weekly",
  "--title", "週報 第2号",
  "--date", "2026-07-28",
  "--summary", "要約",
  "--authors", "elena,anjali",
];

function run(args: string[], file: string, env: Record<string, string | undefined> = { GITHUB_TOKEN: "t" }) {
  return spawnSync("node", [SCRIPT, ...args, "--body-file", file], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_TOKEN: undefined, GITHUB_API_URL: undefined, ...env },
  });
}

describe("publish-report.mjs guards", () => {
  it("exits 1 without GITHUB_TOKEN", () => {
    const r = run(BASE_ARGS, bodyFile("ok.md", FRONTMATTER + longProse(3500)), { GITHUB_TOKEN: undefined });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("GITHUB_TOKEN");
  });

  it("G6: rejects a slug that does not match the date", () => {
    const r = run(BASE_ARGS.map(a => (a === "2026-07-28-weekly" ? "2026-07-21-weekly" : a)), bodyFile("ok2.md", FRONTMATTER + longProse(3500)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G6");
  });

  it("G6: rejects a non-kebab slug (path traversal shape)", () => {
    const r = run(BASE_ARGS.map(a => (a === "2026-07-28-weekly" ? "2026-07-28-../evil" : a)), bodyFile("ok3.md", FRONTMATTER + longProse(3500)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G6");
  });

  it("G1: rejects a body without frontmatter", () => {
    const r = run(BASE_ARGS, bodyFile("nofm.md", longProse(3500)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G1");
  });

  it("G2: rejects a too-short body (mermaid fences excluded from the count)", () => {
    const short = FRONTMATTER + "本文。\n\n```mermaid\n" + "flowchart LR\nA-->B\n".repeat(400) + "```\n\n短い本文で終わる。";
    const r = run(BASE_ARGS, bodyFile("short.md", short));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G2");
  });

  it("G3: rejects an LLM-failure prelude", () => {
    const r = run(BASE_ARGS, bodyFile("prelude.md", FRONTMATTER + "承知しました。以下にレポートを示します。\n\n" + longProse(3500)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G3");
  });

  it("G4: rejects a mid-sentence cut-off ending", () => {
    const cut = FRONTMATTER + longProse(3500) + "\n\nそして最後の文はここで途切れて";
    const r = run(BASE_ARGS, bodyFile("cut.md", cut));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G4");
  });

  it("G5: rejects unbalanced code fences", () => {
    const r = run(BASE_ARGS, bodyFile("fence.md", FRONTMATTER + longProse(3500) + "\n\n```mermaid\nflowchart LR\nA-->B\n"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("G5");
  });

  it("a well-formed body passes every guard and only then reaches the network", () => {
    // Point the API at an unroutable host: guards pass, the first GitHub GET
    // fails → exit 3 (network), proving no guard fired.
    const r = run(BASE_ARGS, bodyFile("pass.md", FRONTMATTER + longProse(3500)), {
      GITHUB_TOKEN: "t",
      GITHUB_API_URL: "http://127.0.0.1:1",
    });
    expect(r.status).toBe(3);
    expect(r.stderr).not.toMatch(/G[1-6]/);
  });
});
