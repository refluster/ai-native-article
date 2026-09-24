#!/usr/bin/env node
// wire-bindings.mjs — the one wire script for the issue→merge loop (adr-0038).
//
// Replaces the per-(skill × project) `wire-issue-*.mjs` / `wire-pr-remediate-*.mjs`
// family: the boilerplate (sigv4 curl, GET bindings[], reconcile, PATCH) lives
// here once and the bindings themselves live as data in
// `lib/bindings-manifest.mjs`. Three separate incidents came from the old shape
// — a cadence bound for one project and not another, with nothing able to see
// the omission — and they are documented at the top of the manifest.
//
// ENABLING A CRON IS THE OPERATOR'S B-AUTHORITY STEP (governance.md §5): this
// script declares each binding enabled in ONE write (scheduler=external +
// invoked_by=api + cron, atomically — never the `manual`+cron dead-cron state),
// so running it IS that step. Do not run it without the operator's go-ahead.
//
// PREREQ — SEED THE SKILL BODIES FIRST (`wf:ren` R2 on #518). A binding whose
// skill has no `SKILL#` row fails EVERY fire: agent-runner.md step 2 resolves
// the body with `GET /skills/{skill}` and refuses to fall back to the git copy
// on a non-2xx. `--check-skills` does that verification for you.
//
// Idempotent, keyed on (skill, project_id): absent -> appended; equal -> no-op;
// drifted -> replaced in place (binding_idx preserved).
//
// Usage:
//   node workforce/scripts/wire-bindings.mjs --dry-run            # all managed
//   node workforce/scripts/wire-bindings.mjs --project asp-cloud --dry-run
//   node workforce/scripts/wire-bindings.mjs --check-skills       # read-only
//   node workforce/scripts/wire-bindings.mjs --live               # drift report
//   aws-vault exec <profile> -- node workforce/scripts/wire-bindings.mjs --project asp-cloud

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);
import { reconcileBinding } from "../../scripts/lib/binding-reconcile.mjs";
import { BINDINGS, bindingMatcher, managedBindings, queueViolations, toBindingLiteral } from "./lib/bindings-manifest.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ?? "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";

const flag = (n) => process.argv.includes(`--${n}`);
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};

const DRY_RUN = flag("dry-run");
const ONLY_PROJECT = arg("project");
const ONLY_SKILL = arg("skill");
const ONLY_AGENT = arg("agent");

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials missing — run under `aws-vault exec <profile> --`");
    }
    args.push("--aws-sigv4", `aws:amz:${REGION}:execute-api`, "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`);
    if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
    args.push("--data-binary", "@-");
  }
  const res = spawnSync("curl", args, { input: method === "GET" ? undefined : JSON.stringify(body), encoding: "utf8" });
  if (res.status !== 0) throw new Error(`curl failed: ${res.stderr}`);
  const out = res.stdout;
  const nl = out.lastIndexOf("\n");
  return { status: Number(out.slice(nl + 1)), json: out.slice(0, nl) ? JSON.parse(out.slice(0, nl)) : undefined };
}

const getAgent = async (slug) => (await fetch(`${API_BASE}/agents/${slug}`)).json();

function selected() {
  return managedBindings().filter(
    (b) =>
      (!ONLY_PROJECT || b.project_id === ONLY_PROJECT) &&
      (!ONLY_SKILL || b.skill === ONLY_SKILL) &&
      (!ONLY_AGENT || b.agent === ONLY_AGENT),
  );
}

/** Read-only: does every skill this manifest binds resolve to a live SKILL# row?
 *  A binding on an unseeded skill throws on every fire, forever. */
async function checkSkills() {
  const skills = [...new Set(BINDINGS.map((b) => b.skill))].sort();
  let bad = 0;
  for (const s of skills) {
    let status = 0;
    try {
      status = (await fetch(`${API_BASE}/skills/${s}`)).status;
    } catch (e) {
      status = 0;
    }
    const ok = status === 200;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${s} -> HTTP ${status || "network error"}`);
  }
  if (bad > 0) {
    console.error(`\n✗ ${bad} skill body/bodies do not resolve — wiring on top of one creates a cadence that throws on every fire.`);
    console.error("  Seed them first: aws-vault exec <profile> -- node workforce/scripts/seed-skills.mjs");
    return 1;
  }
  console.log("\n✓ every skill in the manifest resolves.");
  return 0;
}

/** Read-only: what the manifest declares vs what is actually wired. This is the
 *  drift the old per-project scripts could not show — a script that was written
 *  but never run (OP-016) looked exactly like one that had been. */
async function liveReport() {
  const agents = [...new Set(BINDINGS.map((b) => b.agent))].sort();
  const live = [];
  for (const slug of agents) {
    const a = await getAgent(slug);
    for (const b of a.bindings ?? []) live.push({ agent: slug, skill: b.skill, project_id: b.project_id });
  }
  let drift = 0;
  for (const want of BINDINGS) {
    const got = live.some((l) => l.agent === want.agent && l.skill === want.skill && l.project_id === want.project_id);
    if (!got) drift++;
    console.log(`  ${got ? "✓" : "✗"} ${want.agent}: ${want.skill} @ ${want.project_id}${want.managed === false ? "  (unmanaged)" : ""}`);
  }
  // The invariant, evaluated against LIVE state rather than the manifest — the
  // form in which all three incidents actually existed.
  const violations = queueViolations(live);
  if (violations.length > 0) {
    console.error(`\n✗ R-N11 violated by the LIVE bindings:`);
    for (const v of violations) {
      console.error(`  - ${v.project_id}: "${v.producer}" is bound but "${v.consumer}" is not — ${v.queue} has no worker.`);
      console.error(`    ${v.why}`);
    }
  }
  if (drift > 0) console.error(`\n✗ ${drift} declared binding(s) are not live — run this script (without --live) to wire them.`);
  if (drift === 0 && violations.length === 0) console.log("\n✓ live bindings match the manifest, and every queue has a worker.");
  return drift > 0 || violations.length > 0 ? 1 : 0;
}

async function main() {
  if (flag("check-skills")) return checkSkills();
  if (flag("live")) return liveReport();

  const want = selected();
  if (want.length === 0) {
    console.error("no managed bindings match the given filters");
    return 1;
  }

  // Refuse to wire a set that would leave a queue unworked (R-N11). Evaluated
  // against the FULL manifest, not the filtered subset: wiring one project at a
  // time is normal and must not read as a violation.
  const violations = queueViolations();
  if (violations.length > 0) {
    console.error("✗ the manifest itself violates R-N11 — fix it before wiring:");
    for (const v of violations) console.error(`  - ${v.project_id}: "${v.producer}" bound, "${v.consumer}" not (${v.queue})`);
    return 1;
  }

  const byAgent = new Map();
  for (const b of want) byAgent.set(b.agent, [...(byAgent.get(b.agent) ?? []), b]);

  let failed = 0;
  for (const [slug, entries] of byAgent) {
    const cur = await getAgent(slug);
    if (!Array.isArray(cur.bindings)) {
      console.error(`  ✗ ${slug}: GET returned no bindings[] (agent registered?)`);
      failed++;
      continue;
    }
    let next = cur.bindings;
    const verbs = [];
    for (const entry of entries) {
      const desired = toBindingLiteral(entry);
      // (skill, project_id, lane) — the coarse key would clobber adr-0030's
      // groom-lane binding, which shares skill+project with the author lane.
      const r = reconcileBinding(next, desired, bindingMatcher(desired));
      next = r.bindings;
      if (r.changed) verbs.push(`${r.verb}: ${desired.skill} @ ${desired.project_id} (${desired.trigger.cron})`);
    }
    if (verbs.length === 0) {
      console.log(`  - ${slug}: all ${entries.length} selected binding(s) already current, skipped (no-op).`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] ${slug}: would PATCH bindings -> total ${next.length}`);
      for (const v of verbs) console.log(`      ${v}`);
      continue;
    }
    const { status, json } = curlJson("PATCH", `/agents/${slug}`, { bindings: next });
    if (status === 200) {
      console.log(`  ✓ ${slug}:`);
      for (const v of verbs) console.log(`      ${v}`);
    } else {
      console.error(`  ✗ ${slug}: HTTP ${status} ${JSON.stringify(json)}`);
      failed++;
    }
  }
  if (failed > 0) return 1;
  if (!DRY_RUN) console.log("\nDone. Next orchestrator tick picks the bindings up — no deploy needed (ADR-0007 write=live).");
  return 0;
}

process.exit(await main().catch((e) => {
  console.error(`wire-bindings: ${e instanceof Error ? e.message : String(e)}`);
  return 1;
}));
