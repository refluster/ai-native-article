#!/usr/bin/env node
// check-route-permission-budget.mjs — hold every Lambda behind an HTTP API
// under Lambda's resource-based-policy size cap (the §6 retrospective of
// deploy-workforce-data-plane.yml run 40126740456; docs/memory-lint-backlog.md
// ML-042).
//
// Why. SAM turns each `Type: HttpApi` event on an AWS::Serverless::Function
// into one AWS::Lambda::Permission — one statement in that function's
// resource-based policy — and Lambda refuses a policy over 20 480 bytes. The
// limit is invisible until deploy: cfn-lint and `sam validate` do not model
// it, and CloudFormation rolls the WHOLE stack back when one permission
// fails. On 2026-10-24 the six /rooms routes (#847) took wf-agents-api from
// ~51 to 57 routes and its policy to 20 639 bytes; all six permissions
// failed and the data plane rolled back while the console already shipped
// /rooms. The fix moved Rooms to its own function (WfRoomsApiFunction); this
// check is what would have seen it coming.
//
// The arithmetic — MEASURED, not inferred (the first cut of this header
// derived 362 B/statement from 20 639 / 57, which assumed all six Rooms
// statements had been written; they had not, so it undercounted). The live
// policy on wf-agents-api-prod after #850 is 19 628 B over 51 statements
// (`aws lambda get-policy`), i.e. ≈ 385 B per statement, and the SourceArn
// carries the route path, so long paths cost more. Budget at 385 B:
//     MAX_HTTP_ROUTES_PER_FUNCTION = 48  →  48 × 385 B ≈ 18 480 B,
// ≈ 2.0 KB of headroom under the 20 480 B cap for longer paths and any
// non-HttpApi permission on the same function. Past 48, a new route family
// goes on its own function behind the same HTTP API (the rooms-api shape).
//
// The one grandfathered function. wf-agents-api still carries 51 routes after
// the Rooms move (19 628 B measured — two statements of headroom, which is
// also why renaming or re-pathing an existing event on it is unsafe: a
// Lambda::Permission is replaced create-before-delete). Splitting another family off it is a separate
// change, so it is held by a RATCHET instead of the default: its ceiling is
// its current count, a route added to it fails, and a route removed from it
// fails too until the ceiling below is lowered to match — the ceiling only
// ever moves down, toward 48, where the entry is deleted. No other function
// may be added to GRANDFATHERED_ROUTE_CEILINGS (that would be loosening the
// rule — operator's explicit yes).
//
// Method. No YAML dependency (the neighbours are line walkers too): walk
// `workforce/infra/sam/template.yaml`, track the current two-space resource
// under `Resources:`, its four-space `Type:`, its six-space `Events:` block,
// and each eight-space event's ten-space `Type:`. Every `Type: HttpApi` line
// in the file must be attributed to a function by that walk — an
// unattributed one (an indentation the walker does not understand) is a hard
// failure, never a silent undercount (C-4).
//
// CI wiring is the operator's follow-up: `.github/workflows/ci.yml` is Zone A,
// so this ships as `npm run workforce:route-permission-budget` only.
//
// Exit codes: 0 every function within budget · 1 over budget or unparseable.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_HTTP_ROUTES_PER_FUNCTION = 48;
/** Ratchet ceilings above the default — see the header. Only ever lowered. */
export const GRANDFATHERED_ROUTE_CEILINGS = Object.freeze({ WfAgentsApiFunction: 51 });
/** Lambda's resource-based policy cap, bytes (for the messages). */
export const LAMBDA_POLICY_CAP_BYTES = 20480;
/** Conservative per-route statement size, bytes (see the header). */
export const BYTES_PER_ROUTE_ESTIMATE = 385;

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "..", "infra", "sam", "template.yaml");

/**
 * Pure walker (unit-tested). Returns the HttpApi event count per
 * AWS::Serverless::Function (functions with none included as 0), the number
 * of `Type: HttpApi` lines it could NOT attribute, and the raw line count.
 */
export function countHttpApiRoutes(text) {
  const counts = new Map();
  const lines = text.split(/\r?\n/);
  let inResources = false;
  let resource = null;
  let resourceType = null;
  let inEvents = false;
  let attributed = 0;
  let raw = 0;

  for (const line of lines) {
    // Quoted scalars (`Type: "HttpApi"`, `Type: 'HttpApi'`) are valid YAML and
    // SAM still emits the permission — count them too, or the undercount is
    // silent (wf:owen O2 on #850).
    if (/^\s*Type:\s*["']?HttpApi["']?\s*(#.*)?$/.test(line)) raw++;
    if (/^\s*(#.*)?$/.test(line)) continue; // blank or comment-only

    if (/^\S/.test(line)) {
      inResources = /^Resources:\s*$/.test(line);
      resource = null;
      resourceType = null;
      inEvents = false;
      continue;
    }
    if (!inResources) continue;

    const res = /^ {2}([A-Za-z0-9]+):\s*$/.exec(line);
    if (res) {
      resource = res[1];
      resourceType = null;
      inEvents = false;
      continue;
    }
    if (!resource) continue;

    const type = /^ {4}Type:\s*(\S+)\s*(#.*)?$/.exec(line);
    if (type) {
      resourceType = type[1];
      if (resourceType === "AWS::Serverless::Function" && !counts.has(resource)) counts.set(resource, 0);
      continue;
    }
    if (/^ {6}Events:\s*$/.test(line)) {
      inEvents = true;
      continue;
    }
    // Any other key at ≤ 6 spaces closes the Events block.
    if (/^ {1,6}\S/.test(line)) {
      inEvents = false;
      continue;
    }
    if (inEvents && resourceType === "AWS::Serverless::Function" && /^ {10}Type:\s*["']?HttpApi["']?\s*(#.*)?$/.test(line)) {
      counts.set(resource, (counts.get(resource) ?? 0) + 1);
      attributed++;
    }
  }
  return { counts, unattributed: raw - attributed, raw };
}

/** The ceiling that applies to `fn`. */
export function ceilingFor(fn, max = MAX_HTTP_ROUTES_PER_FUNCTION, grandfathered = GRANDFATHERED_ROUTE_CEILINGS) {
  return Object.hasOwn(grandfathered, fn) ? grandfathered[fn] : max;
}

/** Functions over their ceiling: [fn, count, ceiling][], count descending. */
export function overBudget(counts, max = MAX_HTTP_ROUTES_PER_FUNCTION, grandfathered = GRANDFATHERED_ROUTE_CEILINGS) {
  return [...counts]
    .map(([fn, n]) => [fn, n, ceilingFor(fn, max, grandfathered)])
    .filter(([, n, c]) => n > c)
    .sort((a, b) => b[1] - a[1]);
}

/** Ratchet entries that no longer hold: the function is gone, its count fell
 *  below the ceiling (lower it), or the ceiling is not above the default
 *  (delete the entry). Returns human-readable problems. */
export function staleCeilings(counts, max = MAX_HTTP_ROUTES_PER_FUNCTION, grandfathered = GRANDFATHERED_ROUTE_CEILINGS) {
  const out = [];
  for (const [fn, ceiling] of Object.entries(grandfathered)) {
    if (!counts.has(fn)) out.push(`${fn}: grandfathered but no such function — delete the entry`);
    else if (ceiling <= max) out.push(`${fn}: ceiling ${ceiling} ≤ default ${max} — delete the entry`);
    else if (counts.get(fn) < ceiling) {
      const n = counts.get(fn);
      out.push(`${fn}: ${n} routes < ceiling ${ceiling} — lower the ceiling to ${Math.max(n, max)}${n <= max ? " (or delete the entry)" : ""}`);
    }
  }
  return out;
}

function main() {
  const { counts, unattributed, raw } = countHttpApiRoutes(readFileSync(TEMPLATE, "utf8"));
  const withRoutes = [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  console.log(
    `check-route-permission-budget.mjs: HttpApi routes per function (max ${MAX_HTTP_ROUTES_PER_FUNCTION}; ` +
      `≈${BYTES_PER_ROUTE_ESTIMATE} B each vs the ${LAMBDA_POLICY_CAP_BYTES} B policy cap)`,
  );
  for (const [fn, n] of withRoutes) {
    const g = Object.hasOwn(GRANDFATHERED_ROUTE_CEILINGS, fn) ? `, grandfathered ceiling ${GRANDFATHERED_ROUTE_CEILINGS[fn]}` : "";
    console.log(`  ${String(n).padStart(3)}  ${fn}  (≈${n * BYTES_PER_ROUTE_ESTIMATE} B${g})`);
  }

  if (unattributed !== 0) {
    console.error(
      `check-route-permission-budget.mjs: ${unattributed} of ${raw} \`Type: HttpApi\` line(s) not attributed ` +
        "to an AWS::Serverless::Function Events block — the walker does not understand this template's shape. " +
        "Fix the walker before trusting any count (C-4).",
    );
    return 1;
  }
  const over = overBudget(counts);
  if (over.length > 0) {
    console.error("check-route-permission-budget.mjs: over the per-function route budget");
    for (const [fn, n, c] of over) {
      console.error(`  ${fn}: ${n} HttpApi routes > ${c} (≈${n * BYTES_PER_ROUTE_ESTIMATE} B of ${LAMBDA_POLICY_CAP_BYTES} B)`);
    }
    console.error(
      "Fix: put the new route family on its own AWS::Serverless::Function behind the same HTTP API " +
        "(see WfRoomsApiFunction) — each route adds one Lambda permission statement.",
    );
    return 1;
  }
  const stale = staleCeilings(counts);
  if (stale.length > 0) {
    console.error("check-route-permission-budget.mjs: GRANDFATHERED_ROUTE_CEILINGS is out of date (the ratchet only moves down)");
    for (const p of stale) console.error(`  ${p}`);
    return 1;
  }
  const total = withRoutes.reduce((a, [, n]) => a + n, 0);
  console.log(`check-route-permission-budget.mjs: OK (${total} routes across ${withRoutes.length} functions)`);
  return 0;
}

// Run as CLI only when invoked directly; importing (tests) has no side effect.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
