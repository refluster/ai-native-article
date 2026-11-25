#!/usr/bin/env node
// FU-030 harness-side HEAD assertion for pr-autopilot lens subagents.
//
// A CCR fire checks out the **base** branch by default. A lens that "verifies"
// claims against the repo is therefore reading `main`, not the PR head — and
// will report symbols added by the PR as absent (observed on #518: four lenses,
// every new skill directory reported missing). The scan now records `head_sha`
// (PR #913, 2026-11-24); this script closes the mechanical gap: run it in each
// lens subagent after the head checkout and before any file-read, to guarantee
// the working tree is what the scan saw.
//
// If the assertion fails, the lens MUST NOT proceed — an absence finding on the
// wrong HEAD is indistinguishable from a real finding, and the verdict will
// publish it.
//
// Usage:
//   node workforce/skills/pr-autopilot/assert-head-sha.mjs \
//     --expected-sha <sha>
//   [--cwd <path>]        working directory for git (default: process.cwd())
//
// Exit codes:
//   0 — HEAD equals expected sha; safe to run lenses
//   1 — HEAD mismatch; abort lens — wrong working tree
//   2 — git failure (not a repo, HEAD missing, git not on PATH)
//   3 — bad arguments (empty or malformed --expected-sha)

import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/**
 * Assert that HEAD in the given working directory equals expectedSha.
 *
 * @param {string} expectedSha  The 40-hex (or 7+-hex short) SHA the scan committed to.
 * @param {object} [options]
 * @param {string} [options.cwd]      Working directory for the git call (default: process.cwd()).
 * @param {() => string} [options.getHead]  Injectable getter for testing; skips execFileSync.
 * @returns {{ ok: boolean, code: number, message: string }}
 */
export function assertHeadSha(expectedSha, options = {}) {
  const { cwd = process.cwd(), getHead } = options;

  if (
    !expectedSha ||
    typeof expectedSha !== "string" ||
    !/^[0-9a-f]{7,40}$/i.test(expectedSha)
  ) {
    return {
      ok: false,
      code: 3,
      message: `assert-head-sha: bad --expected-sha: ${JSON.stringify(expectedSha)} (must be 7–40 hex chars)`,
    };
  }

  let actual;
  try {
    actual = getHead
      ? getHead()
      : execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch (err) {
    return {
      ok: false,
      code: 2,
      message: `assert-head-sha: git rev-parse HEAD failed: ${err.message}`,
    };
  }

  if (actual.toLowerCase() !== expectedSha.toLowerCase()) {
    return {
      ok: false,
      code: 1,
      message:
        `assert-head-sha: HEAD mismatch — expected ${expectedSha}, got ${actual}\n` +
        `Run the checkout command from the scan output (head_checkout_cmd) before proceeding.`,
    };
  }

  return {
    ok: true,
    code: 0,
    message: `assert-head-sha: HEAD ${actual} matches expected sha ✓`,
  };
}

async function main() {
  const expectedSha = arg("expected-sha");
  const cwd = arg("cwd", process.cwd());

  if (!expectedSha) {
    console.error("assert-head-sha: --expected-sha is required");
    process.exit(3);
  }

  const result = assertHeadSha(expectedSha, { cwd });
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }
  process.exit(result.code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(`assert-head-sha: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
  });
}
