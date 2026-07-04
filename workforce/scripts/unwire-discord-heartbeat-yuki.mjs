#!/usr/bin/env node
// Unwire Yuki's `discord-heartbeat` binding for the `agent-workforce` project
// via PATCH /agents/yuki (ADR-0007: bindings are DDB config, the agents-api is
// the single writer — each PATCH is validated at the write boundary and lands
// its own AUDIT item; W-5 keeps it one-persona-per-mutation).
//
// Why: discord-heartbeat was introduced to give the operator monotonic
// confidence that the CCR dispatch chain (orchestrator-tick → CCR session →
// outbound HTTP) was firing while that path was new. It has now run cleanly on
// the 2-hourly cadence for >1 month, so the trial-monitoring signal has served
// its purpose. Yuki's discord-heartbeat binding is retired.
//
// Liveness is NOT lost: `discord-ping` (the deterministic Lambda sibling) keeps
// posting the heartbeat on the Lambda path. This unwire only removes the
// CCR-routed duplicate; the workforce's public drumbeat continues.
//
// Scope: removes ONLY the (discord-heartbeat @ agent-workforce) binding. Yuki's
// other bindings (feed-post, daily-research) are matched out by (skill,
// project_id) and left untouched. The discord-heartbeat SKILL# spec is NOT
// touched — the skill remains an available, bindable spec (retiring the spec is
// a separate decision); this script only removes the cadence binding.
//
// Idempotent + declares desired state (binding absent):
//   - present  → PATCH the reduced bindings[] (remaining bindings keep their
//                relative order; binding_idx of anything AFTER the removed slot
//                shifts down by one — expected for a removal).
//   - absent   → true no-op (already unwired).
//
// Usage:
//   node workforce/scripts/unwire-discord-heartbeat-yuki.mjs --dry-run
//   aws-vault exec <profile> -- \
//     node workforce/scripts/unwire-discord-heartbeat-yuki.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const SLUG = "yuki";
const SKILL = "discord-heartbeat";
const PROJECT_ID = "agent-workforce";

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

const cur = await (await fetch(`${API_BASE}/agents/${SLUG}`)).json();
if (!Array.isArray(cur.bindings)) {
  console.error(`  ✗ ${SLUG}: GET returned no bindings[] (agent registered?)`);
  process.exit(1);
}

const idx = cur.bindings.findIndex(
  (b) => b.skill === SKILL && b.project_id === PROJECT_ID,
);
if (idx < 0) {
  console.log(`  - ${SLUG}: ${SKILL} @ ${PROJECT_ID} not bound, skipped (no-op — already unwired).`);
  process.exit(0);
}

const next = cur.bindings.filter((_, i) => i !== idx);
const summary = `${SKILL} @ ${PROJECT_ID}`;
if (DRY_RUN) {
  console.log(`  [dry-run] ${SLUG}: would PATCH bindings -> remove ${summary}; ${cur.bindings.length} -> ${next.length}`);
  console.log(`  [dry-run] remaining: ${next.map((b) => `${b.skill} @ ${b.project_id}`).join(", ") || "(none)"}`);
  process.exit(0);
}

const { status, json } = curlJson("PATCH", `/agents/${SLUG}`, { bindings: next });
if (status === 200) {
  console.log(`  ✓ ${SLUG}: unwired ${summary}`);
  console.log(`  remaining: ${next.map((b) => `${b.skill} @ ${b.project_id}`).join(", ") || "(none)"}`);
  console.log("Done. Next orchestrator tick no longer fires the heartbeat — no deploy needed (ADR-0007 write=live).");
} else {
  console.error(`  ✗ ${SLUG}: HTTP ${status} ${JSON.stringify(json)}`);
  process.exit(1);
}
