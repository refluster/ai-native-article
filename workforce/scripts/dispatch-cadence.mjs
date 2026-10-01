#!/usr/bin/env node
// dispatch-cadence.mjs — a CLI over `POST /dispatch` (adr-0025) for skill
// bodies that have no write-script of their own.
//
// `issue-implement` and `issue-design` deliver a draft PR and then end. Before
// adr-0038 that PR waited for `pr-autopilot`'s next 6-hourly tick — the last
// unnecessary cron wait in the issue→merge loop, and the one that turned a
// same-day chain into a next-day one. These cadences run as plain CCR sessions
// with no bundled write-script to hang the call off, so the call gets a CLI.
//
// Best-effort by construction, exactly like every other dispatch call site: it
// prints what happened and **always exits 0**. A hand-off must never fail
// because the accelerator did — the binding's cron is the completeness floor
// (see the module docs in scripts/lib/request-dispatch.mjs).
//
// Usage:
//   node workforce/scripts/dispatch-cadence.mjs \
//     --skill pr-autopilot --project asp-cloud \
//     --reason "draft PR #1234 opened for issue #866 — review at cycle N+1"

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { requestDispatch } from "./lib/request-dispatch.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};

const skill = arg("skill");
const project_id = arg("project");
const reason = arg("reason");
const agent_slug = arg("agent");

if (!skill || !project_id) {
  console.error("dispatch-cadence: --skill <name> and --project <id> are required");
  console.error("  (exiting 0 anyway: a dispatch is never load-bearing — the target's cron is the floor)");
  process.exit(0);
}

await requestDispatch({ skill, project_id, reason, agent_slug }).catch((e) =>
  console.error(`dispatch-cadence: WARN ${e instanceof Error ? e.message : String(e)}`),
);
process.exit(0);
