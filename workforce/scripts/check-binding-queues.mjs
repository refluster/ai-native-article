#!/usr/bin/env node
// check-binding-queues.mjs — R-N11: a cadence that fills a queue may not be
// bound for a project unless the cadence that drains it is bound for the same
// project (adr-0038).
//
// This rule exists because the same defect shipped three times:
//
//   1. `pr-remediate` bound for `agent-workforce` only → PSVL/asp-cloud PRs
//      #692/#693 were parked in `autopilot:needs-author` with no worker and
//      escalated `author-stale` 36h later (adr-0025 Context).
//   2. `wire-pr-remediate-ren-asp-cloud.mjs` written but never run — OP-016.
//   3. `issue-triage` + `issue-design` bound for `agent-workforce` only →
//      asp-cloud ran the pre-adr-0022 world, with `issue-implement` as the
//      tracker's sole consumer and 18 issues absorbed into
//      `issue-implement:needs-human` with no re-queue worker to release them.
//
// Each time, the diagnosis took a human reading two config surfaces side by
// side, because **an unworked queue and a slow worker emit the same signal**.
// That is exactly the comparison a checker does for free.
//
// The PR gate reads the MANIFEST (offline, deterministic — a PR must not turn
// red because of live state it did not change). `wire-bindings.mjs --live` runs
// the same pure predicate against the live bindings, which is the form all
// three incidents actually took; the runbook points ops at it.
//
// Usage: node workforce/scripts/check-binding-queues.mjs   (npm run workforce:binding-queues)
// Exit: 0 compliant · 1 violation.

import { BINDINGS, QUEUES, queueViolations } from "./lib/bindings-manifest.mjs";

const violations = queueViolations(BINDINGS, QUEUES);

const projects = [...new Set(BINDINGS.map((b) => b.project_id))].sort();
console.log(`check-binding-queues: ${BINDINGS.length} declared binding(s) across ${projects.length} project(s): ${projects.join(", ")}`);
console.log(`check-binding-queues: ${QUEUES.length} producer→consumer queue relation(s) (R-N11)`);

if (violations.length === 0) {
  console.log("✓ every queue a bound cadence fills has a bound cadence draining it.");
  process.exit(0);
}

console.error("");
console.error(`✗ R-N11: ${violations.length} queue(s) have a producer but no consumer:`);
for (const v of violations) {
  console.error("");
  console.error(`  project "${v.project_id}" — queue "${v.queue}"`);
  console.error(`    producer "${v.producer}" is bound; consumer "${v.consumer}" is NOT.`);
  console.error(`    ${v.why}`);
}
console.error("");
console.error("Fix: declare the consumer for that project in workforce/scripts/lib/bindings-manifest.mjs");
console.error("(and wire it: `node workforce/scripts/wire-bindings.mjs --project <id>`), or remove the producer.");
process.exit(1);
