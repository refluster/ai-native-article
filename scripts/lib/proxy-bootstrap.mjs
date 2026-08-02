// proxy-bootstrap.mjs — make Node's built-in fetch() honour HTTPS_PROXY.
//
// Why this exists
// ---------------
// Every workforce cadence script talks to the outside world with the global
// `fetch()`. Node's fetch is undici, and undici does NOT read HTTPS_PROXY /
// NO_PROXY unless the process was started with NODE_USE_ENV_PROXY=1 (Node
// >= 22.21). In a CCR / Claude Code remote session outbound HTTPS is only
// permitted through the agent proxy at $HTTPS_PROXY, so a bare fetch() never
// reaches the policy-enforcing proxy at all — it is rejected upstream with
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
// What it does
// ------------
// Importing this module for its side effect, before any network call, makes
// the current process proxy-aware:
//
//   - No HTTPS_PROXY in the environment → no-op (local dev, CI, Lambda).
//   - NODE_USE_ENV_PROXY already set     → no-op (already correct).
//   - Otherwise → re-exec this same script with NODE_USE_ENV_PROXY=1, pass
//     stdio straight through, and exit with the child's status.
//
// The re-exec costs one extra process start (~40ms) and is transparent: stdout
// (e.g. the picker's single JSON line), stderr and the exit code are all
// preserved verbatim, so every script's documented exit-code contract still
// holds.
//
// Why re-exec instead of setGlobalDispatcher(new EnvHttpProxyAgent())
// ------------------------------------------------------------------
// `undici` is not a dependency of this repo and these scripts are executed
// with a bare `node <path>` from a CCR session that has not necessarily run
// `npm install`. NODE_USE_ENV_PROXY is built into the runtime, so the
// zero-dependency path is the one that cannot break. If undici ever becomes a
// real dependency, this module is the single place to swap the mechanism.
//
// Usage — first import in any script that performs network I/O:
//
//     import "../../../scripts/lib/proxy-bootstrap.mjs";
//
// ESM evaluates imported modules before the importing module's body, so the
// re-exec happens before any fetch() can be issued. `scripts/check-proxy-bootstrap.mjs`
// (CI gate R-14) fails the build if a script calls fetch() without it.

import { spawnSync } from "node:child_process";

// Set on the re-executed child so it never re-execs again.
const SENTINEL = "WF_PROXY_BOOTSTRAPPED";

/** NODE_USE_ENV_PROXY landed in Node 22.21 / 24.x. */
function supportsEnvProxy() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 22) return true;
  return major === 22 && minor >= 21;
}

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

if (proxy && !process.env[SENTINEL] && process.env.NODE_USE_ENV_PROXY !== "1") {
  if (!supportsEnvProxy()) {
    // Fail loud (C-4): the proxy is mandatory here and this runtime cannot be
    // made to use it, so every subsequent fetch() would 403 with a message
    // that blames the allowlist instead of the runtime.
    console.error(
      `proxy-bootstrap: HTTPS_PROXY is set but Node ${process.versions.node} ` +
        `predates NODE_USE_ENV_PROXY (needs >= 22.21). Bare fetch() would bypass ` +
        `the agent proxy and be rejected as "Host not in allowlist". Upgrade Node.`,
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
  if (result.signal) {
    // Reproduce the child's termination signal rather than masking it as an
    // exit code, so an operator's Ctrl-C still looks like a Ctrl-C.
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
}
