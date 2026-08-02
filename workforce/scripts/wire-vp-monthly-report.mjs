#!/usr/bin/env node
// Wire the `vp-monthly-report` binding for all 7 VPs on the `agent-workforce`
// project via PATCH /agents/{slug} (ADR-0007: bindings are DDB config, the
// agents-api is the single writer — each PATCH is validated at the write
// boundary and lands its own AUDIT item; W-5 keeps it one-persona-per-mutation,
// and the additive same-skill-across-agents series is the sanctioned mass-edit
// shape per workforce governance §3).
//
// What this adds — one binding per VP, once per month on the 3rd (the day
// after Maya's monthly-report fires on the 2nd, so the two series cover the
// same month without colliding), staggered through the JST working window:
//
//   dario   VP Engineering Excellence            cron(9  1 3 * ? *)  10:09 JST
//   mateo   VP Agent Workforce Platform          cron(39 1 3 * ? *)  10:39 JST
//   priya   VP People & Legal                    cron(9  2 3 * ? *)  11:09 JST
//   silas   VP, Finance & Capital Strategy       cron(39 2 3 * ? *)  11:39 JST
//   celeste VP, Marketing & External Comms       cron(9  3 3 * ? *)  12:09 JST
//   elena   VP Customer Experience               cron(39 3 3 * ? *)  12:39 JST
//   tessa   VP, Policy & Government Affairs      cron(9  4 3 * ? *)  13:09 JST
//
// Single literal minute/hour/day per binding so any cron parser agrees; the
// 2-hourly orchestrator tick's past-facing 120-min window catches each exactly
// once.
//
// AUTHORITY: mutating persona bindings is B-authority (workforce governance
// §5); this wire executes the operator's explicit 2026-07-08 instruction
// ("Mayaに習ってVPも全員、各々が月次レポートを書けるようにしよう。…skillとして
// 登録、bindしよう") — the escalation is satisfied by that instruction, and
// each PATCH lands on the AUDIT# trail + weekly config digest as usual.
//
// PREREQ (same ladder as wire-monthly-report-maya.mjs):
//   1. The vp-monthly-report SKILL# row exists (R8 write-time check validates
//      the binding against it): SKILL.md body via POST /skills (ADR-0017),
//      code-side fields via the git seed on the next data-plane deploy after
//      the PR merges (ADR-0008/0018).
//   2. wf/projects/agent-workforce/notion.integration_token exists (it does —
//      monthly-report and article-level2/3 already draw it).
//   3. Credential injection needs the deployed SKILL_REQUIRES map to include
//      vp-monthly-report → notion.integration_token, i.e. the data-plane
//      deploy after the PR. The first scheduled fire (the 3rd of next month)
//      is comfortably after that.
//
// Idempotent + declares desired state, keyed on (skill, project_id) per agent:
//   - not present        → append (existing bindings keep their binding_idx)
//   - present, equal     → true no-op
//   - present, drifted   → replace in place (binding_idx preserved)
//
// Usage:
//   node workforce/scripts/wire-vp-monthly-report.mjs --dry-run
//   node workforce/scripts/wire-vp-monthly-report.mjs

import "../../scripts/lib/proxy-bootstrap.mjs";

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT_ID = "agent-workforce";
const ROUTINE_SPEC = "workforce/docs/routines/agent-runner.md";

// One seat table per VP: cron stagger + default interview seats (their
// function's contributors — swap seats HERE, not in the skill body, when the
// org chart moves; SKILL.md Stage 2 reads config.interview_personas).
const VPS = [
  { slug: "dario",   cron: "cron(9 1 3 * ? *)",  interview: ["ren", "farah", "nadia"] },
  { slug: "mateo",   cron: "cron(39 1 3 * ? *)", interview: ["sana", "hana", "freya"] },
  { slug: "priya",   cron: "cron(9 2 3 * ? *)",  interview: ["theo", "levi", "noor"] },
  { slug: "silas",   cron: "cron(39 2 3 * ? *)", interview: ["delphine", "corinne"] },
  { slug: "celeste", cron: "cron(9 3 3 * ? *)",  interview: ["odette", "rhys", "idris"] },
  { slug: "elena",   cron: "cron(39 3 3 * ? *)", interview: ["yuki", "mira", "kai", "aoi"] },
  { slug: "tessa",   cron: "cron(9 4 3 * ? *)",  interview: ["grace", "ishaan", "mei", "astrid"] },
];

const bindingFor = ({ slug, cron, interview }) => ({
  skill: "vp-monthly-report",
  executor: "claude-code-routine",
  trigger: {
    scheduler: "external",
    invoked_by: "api",
    fired_from: "wf-orchestrator-tick",
    cron,
  },
  routine_spec: ROUTINE_SPEC,
  project_id: PROJECT_ID,
  config: {
    sign_off_persona: slug,
    interview_personas: interview,
  },
  note:
    `${slug}'s monthly VP letter (once per month, 3rd — the day after the President's monthly-report). ` +
    "Functional-lens companion to monthly-report: discoveries, honest failures, and next month's testable hypotheses " +
    "from the VP's seat, per the decentralized-integrated operating model (domain overlap between VPs is expected). " +
    "Publishes one ~5-8 page general-audience letter to the Notion unified Articles DB tagged Monthly Report, " +
    "Author=<slug> (vp-monthly-report/post.mjs forwards to the canonical monthly-report writer; W-1 guarded, " +
    "chunked block append). Operator-instructed binding 2026-07-08.",
});

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials missing — run with AWS credentials in the environment");
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

// Stable, key-order-independent serialization: distinguishes a true no-op from
// drift (array order stays significant on purpose).
const stable = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v);

let failures = 0;
for (const vp of VPS) {
  const BINDING = bindingFor(vp);
  const SLUG = vp.slug;
  let cur;
  try {
    cur = await (await fetch(`${API_BASE}/agents/${SLUG}`)).json();
  } catch (err) {
    console.error(`  ✗ ${SLUG}: GET failed (${err instanceof Error ? err.message : String(err)})`);
    failures++;
    continue;
  }
  if (!Array.isArray(cur.bindings)) {
    console.error(`  ✗ ${SLUG}: GET returned no bindings[] (agent registered?)`);
    failures++;
    continue;
  }

  const idx = cur.bindings.findIndex(
    (b) => b.skill === BINDING.skill && b.project_id === BINDING.project_id,
  );
  const summary = `${BINDING.skill} @ ${PROJECT_ID} (${BINDING.trigger.cron})`;
  let next;
  let verb;
  if (idx >= 0) {
    if (stable(cur.bindings[idx]) === stable(BINDING)) {
      console.log(`  - ${SLUG}: ${summary} already bound + current, skipped (no-op).`);
      continue;
    }
    next = cur.bindings.map((b, i) => (i === idx ? BINDING : b));
    verb = "updated (in-place, binding_idx preserved)";
  } else {
    next = [...cur.bindings, BINDING];
    verb = "bound";
  }
  if (DRY_RUN) {
    console.log(`  [dry-run] ${SLUG}: would PATCH bindings -> ${verb} (${summary}); total ${next.length}`);
    continue;
  }

  try {
    const { status, json } = curlJson("PATCH", `/agents/${SLUG}`, { bindings: next });
    if (status === 200) {
      console.log(`  ✓ ${SLUG}: ${verb} ${summary}`);
    } else {
      console.error(`  ✗ ${SLUG}: HTTP ${status} ${JSON.stringify(json)}`);
      failures++;
    }
  } catch (err) {
    console.error(`  ✗ ${SLUG}: PATCH failed (${err instanceof Error ? err.message : String(err)})`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`Done with ${failures} failure(s) — re-run after fixing; the script is idempotent.`);
  process.exit(1);
}
console.log(
  "Done. Next orchestrator tick picks the bindings up — no deploy needed (ADR-0007 write=live). " +
  "Credential injection for the fires activates with the post-merge data-plane deploy (SKILL_REQUIRES).",
);
