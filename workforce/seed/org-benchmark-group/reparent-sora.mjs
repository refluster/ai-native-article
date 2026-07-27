#!/usr/bin/env node
// One-shot re-parent of `sora` → reports_to ["beatriz"] via PATCH /agents/sora
// (ADR-0007: agents-api is the single writer; one persona per mutation, W-5).
//
// This executes the org-benchmark round's §7 fourth row — the three-rounds-
// deferred "does Sora need a VP" question, answered by the round memo
// (docs/hires/org-benchmark-nine-hire-round.md §3): research/intel gets a
// craft VP (beatriz), and sora moves under her. B-authority: run only after
// the operator has approved the memo's rebind section.
//
// Idempotent: exits 0 without writing if sora already reports to beatriz.
//
// Usage:
//   node workforce/seed/org-benchmark-group/reparent-sora.mjs --dry-run
//   node workforce/seed/org-benchmark-group/reparent-sora.mjs

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = ["-sS", "-X", method, "-H", "content-type: application/json", "-w", "\n%{http_code}", `${API_BASE}${path}`];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials missing — run under `aws-vault exec <profile> --` or with session env creds");
    }
    args.push("--aws-sigv4", `aws:amz:${REGION}:execute-api`, "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`);
    if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
    args.push("-d", JSON.stringify(body));
  }
  const res = spawnSync("curl", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`curl failed: ${res.stderr}`);
  const out = res.stdout.trimEnd();
  const nl = out.lastIndexOf("\n");
  const status = Number(out.slice(nl + 1));
  let json;
  try { json = JSON.parse(out.slice(0, nl)); } catch { json = { raw: out.slice(0, nl) }; }
  return { status, json };
}

const { status: getStatus, json: sora } = curlJson("GET", "/agents/sora");
if (getStatus !== 200) {
  console.error(`✗ GET /agents/sora returned ${getStatus}: ${JSON.stringify(sora).slice(0, 200)}`);
  process.exit(1);
}
const current = sora.reports_to ?? [];
console.log(`sora.reports_to today: ${JSON.stringify(current)}`);
if (JSON.stringify(current) === JSON.stringify(["beatriz"])) {
  console.log("✓ already reports to beatriz — nothing to do");
  process.exit(0);
}
if (DRY_RUN) {
  console.log(`[dry-run] would PATCH /agents/sora reports_to ${JSON.stringify(current)} -> ["beatriz"]`);
  process.exit(0);
}
const { status: patchStatus, json: patched } = curlJson("PATCH", "/agents/sora", { reports_to: ["beatriz"] });
if (patchStatus !== 200) {
  console.error(`✗ PATCH failed (${patchStatus}): ${JSON.stringify(patched).slice(0, 300)}`);
  process.exit(1);
}
const { json: verify } = curlJson("GET", "/agents/sora");
console.log(`✓ sora re-parented — reports_to now ${JSON.stringify(verify.reports_to)}`);
