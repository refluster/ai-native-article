// @ts-nocheck — the module under test (notify.mjs) is a dependency-free ESM
// CLI script, not TS. This suite drives it as a real child process (the
// pr-autopilot / weekly-project-report convention: spawnSync + assert on
// exit code + stderr), so guard behaviour is proven without mocking fetch.
// Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "notify.mjs");

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "oaw-"));
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}

function run(args, env) {
  return spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

const CLEAN_FINDINGS = JSON.stringify({ generatedAt: "2026-07-23T00:00:00Z", sweptSurfaces: ["ci.yml"], findings: [] });

describe("notify.mjs — CLI guard contract", () => {
  it("exit 1 when --findings-file is missing", () => {
    const r = run([], { DISCORD_WEBHOOK_URL: "http://127.0.0.1:1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--findings-file/);
  });

  it("exit 1 when --findings-file does not parse as JSON", () => {
    const file = tmpFile("bad.json", "not json");
    const r = run(["--findings-file", file], { DISCORD_WEBHOOK_URL: "http://127.0.0.1:1" });
    expect(r.status).toBe(1);
  });

  it("exit 1 when neither a webhook URL nor a bot token + channel are configured", () => {
    const file = tmpFile("clean.json", CLEAN_FINDINGS);
    const r = run(["--findings-file", file], { DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "", DISCORD_CHANNEL_ID: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/DISCORD_WEBHOOK_URL/);
  });

  it("exit 3 on a network error — guards ran, only the network call itself failed (proves guard order)", () => {
    const file = tmpFile("clean2.json", CLEAN_FINDINGS);
    const r = run(["--findings-file", file], { DISCORD_WEBHOOK_URL: "http://127.0.0.1:1" });
    expect(r.status).toBe(3);
  });
});
