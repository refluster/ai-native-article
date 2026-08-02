// proxy-bootstrap.mjs — make Node's built-in fetch() honour HTTPS_PROXY.
//
// Why this exists
// ---------------
// Every workforce cadence script talks to the outside world with the global
// `fetch()`. Node's fetch is undici, and undici does NOT read HTTPS_PROXY /
// NO_PROXY unless the process was started with NODE_USE_ENV_PROXY=1 (Node
// >= 22.21, or >= 24.0). In a CCR / Claude Code remote session outbound HTTPS
// is only permitted through the agent proxy at $HTTPS_PROXY, so a bare fetch()
// never reaches the policy-enforcing proxy at all — it is rejected upstream
// with
//
//     HTTP 403: Host not in allowlist: <host>
//
// …no matter how the session's egress allowlist is configured. That is not a
// policy denial the operator can fix by opening the network: it is the script
// bypassing the only path that is allowed to carry the traffic.
//
// This is exactly how the L1→L2/L3 article pipeline silently stopped
// producing on 2026-07-26: `pick-l1-source.mjs` exited 3 on every one of the
// 28 dispatches that followed, while cadences whose only endpoint was the
// AWS agents-api kept working. See docs/memory-lint-backlog.md (ML-017).
//
// THIS IS BELT-AND-BRACES, NOT THE REAL FIX
// -----------------------------------------
// The right place to solve ML-017 is the substrate: `NODE_USE_ENV_PROXY=1`
// (or NODE_OPTIONS) exported once in the agent-runner's CCR session
// environment fixes every script that exists and every script anyone writes
// later, with no import discipline to maintain. That is a platform change
// outside this repo. This module exists so the repo is correct in the
// meantime and on any runner that lacks the env var — it is a second line of
// defence, and the ML-017 row says so.
//
// Entry scripts only — never a library side effect
// ------------------------------------------------
// Making the process proxy-aware means re-execing it, because
// NODE_USE_ENV_PROXY is read at startup. Re-execing is safe for a script the
// user invoked directly and catastrophic for an imported module: a leaf that
// re-execs on import restarts *its host*. `pr-merge.mjs` is imported by four
// vitest specs that `workforce/lambdas/vitest.config.mjs` includes, so a
// module-scope re-exec would make `npm test` run the whole suite twice in any
// shell with HTTPS_PROXY set — which is precisely a CCR session, the
// environment this module exists for. Reproduced before this was fixed:
//
//     HOST start pid= 8958      ← parent
//     HOST start pid= 8965      ← re-exec; everything before the import redone
//     HOST end   pid= 8965      ← parent never reaches its own tail
//
// So this module exports a function that takes the caller's `import.meta.url`
// and does nothing unless that module IS the process entry point. A file that
// is both a CLI entry and an imported module (pr-merge.mjs) therefore
// bootstraps when run and stays inert when imported, with no per-file
// judgement call about which category it belongs to.
//
// Usage — in any script that performs network I/O:
//
//     import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
//     ensureProxyAwareEntry(import.meta.url);
//
// Call it above any other top-level statement. It cannot run before the
// module's *imports* are evaluated (ESM hoists those), so a dependency that
// issues a fetch at import time would still escape it; nothing in this repo
// does, and `scripts/check-proxy-bootstrap.mjs` (CI gate R-14) enforces that
// the bootstrap is the first import and the call precedes other statements.
//
// The re-exec costs one extra process start (~40ms) and is transparent:
// stdout (e.g. the picker's single JSON line), stderr and the exit code are
// all preserved verbatim, so every script's documented exit-code contract
// still holds.
//
// Why re-exec instead of setGlobalDispatcher(new EnvHttpProxyAgent())
// ------------------------------------------------------------------
// `undici` is not a dependency of this repo and these scripts are executed
// with a bare `node <path>` from a CCR session that has not necessarily run
// `npm install`. NODE_USE_ENV_PROXY is built into the runtime, so the
// zero-dependency path is the one that cannot break. If undici ever becomes a
// real dependency, this module is the single place to swap the mechanism.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { constants as osConstants } from "node:os";

// Set on the re-executed child so it never re-execs again.
const SENTINEL = "WF_PROXY_BOOTSTRAPPED";

/**
 * NODE_USE_ENV_PROXY exists on Node >= 24.0.0 and was backported to 22.21.0.
 * It never shipped in 23.x — so a plain `major > 22` would re-exec on 23.x,
 * have the env var ignored, and let every fetch bypass the proxy again. The
 * one code path whose entire job is to fail loud instead of silently
 * bypassing must not itself silently bypass.
 */
export function supportsEnvProxy(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major >= 24) return true;
  return major === 22 && minor >= 21;
}

/** True when `moduleUrl` is the script node was invoked with. */
function isProcessEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(entry));
  } catch {
    return false;
  }
}

/**
 * Re-exec the current process with NODE_USE_ENV_PROXY=1 so global fetch()
 * honours HTTPS_PROXY. No-ops unless the caller is the process entry point,
 * a proxy is configured, and the re-exec has not already happened.
 *
 * @param {string} moduleUrl the caller's `import.meta.url`
 */
export function ensureProxyAwareEntry(moduleUrl) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return; // local dev, CI, Lambda — nothing to route through
  if (process.env[SENTINEL]) return; // we are the re-exec
  if (process.env.NODE_USE_ENV_PROXY === "1") return; // already correct
  if (!isProcessEntry(moduleUrl)) return; // imported, not invoked

  if (!supportsEnvProxy()) {
    // Fail loud (C-4): the proxy is mandatory here and this runtime cannot be
    // made to use it, so every subsequent fetch() would 403 with a message
    // that blames the allowlist instead of the runtime.
    console.error(
      `proxy-bootstrap: HTTPS_PROXY is set but Node ${process.versions.node} ` +
        `lacks NODE_USE_ENV_PROXY (needs >= 22.21 or >= 24). Bare fetch() would ` +
        `bypass the agent proxy and be rejected as "Host not in allowlist". Upgrade Node.`,
    );
    process.exit(3);
  }

  const result = spawnSync(
    process.execPath,
    [
      // EnvHttpProxyAgent is flagged experimental and prints a warning on
      // every run. Scripts here contract on a clean stderr (the picker's
      // caller reads stderr on failure), so silence just that code.
      "--disable-warning=UNDICI-EHPA",
      ...process.execArgv,
      ...process.argv.slice(1),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, NODE_USE_ENV_PROXY: "1", [SENTINEL]: "1" },
    },
  );

  if (result.error) {
    console.error(
      `proxy-bootstrap: failed to re-exec with NODE_USE_ENV_PROXY=1: ${result.error.message}`,
    );
    process.exit(3);
  }
  // A child killed by a signal has status === null. Report it the way a shell
  // does — 128 + signo. (Re-raising the signal on ourselves does not work:
  // process.kill is asynchronous, so the synchronous process.exit() below
  // always wins and the death is reported as a plain exit code anyway.)
  if (result.signal) {
    const signo = osConstants.signals[result.signal];
    process.exit(typeof signo === "number" ? 128 + signo : 1);
  }
  process.exit(result.status ?? 1);
}
