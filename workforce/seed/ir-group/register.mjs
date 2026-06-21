#!/usr/bin/env node
// One-shot registration of the IR Reporting & Visit-Coordination pod (2026-06)
// via POST /agents (ADR-0007: DDB is the single authoritative store and
// agents-api the single writer — this script never touches DynamoDB
// directly, so every create is validated and lands its AUDIT item).
//
// The {slug}.json + {slug}-system.md files in this directory are one-shot
// REGISTRATION INPUTS, not a mirror: after a successful run, the DDB row
// is authoritative and edits go through PATCH /agents/{slug}, never by
// re-running this script (it 409s on existing slugs by design).
//
// Unlike the finance-group round, this round adds USD 10/mo on top of the
// USD 174/mo roster -> USD 184/mo, which is INSIDE the standing W-3 cap
// (USD 190/mo, raised for the finance group on 2026-06-14). No cap edit is a
// prerequisite; the API's write-time aggregate check passes at 184/190.
//
// Usage (operator credentials required — the route is AWS_IAM):
//   aws-vault exec <profile> -- node workforce/seed/ir-group/register.mjs
//   node workforce/seed/ir-group/register.mjs --dry-run   # no creds needed
//
// Env:
//   WF_AGENTS_API_BASE  override the API base (default: prod execute-api URL —
//                       SigV4 is signed against the host, so prefer the
//                       execute-api hostname over the custom domain here)
//   AWS_REGION          SigV4 region (default us-west-2)

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

// Both new ICs report to corinne (existing); register in any order since the
// parent already exists. The manifest builder derives org depth from
// reports_to, so corinne must be registered first — she already is.
const SLUGS = ["marisol", "yara"];
// The standing W-3 cap. This round does NOT raise it (184/190 fits). The API
// re-checks the roster aggregate at write time, so the registration fails loud
// if anything has pushed the roster past 190 since this was authored.
const W3_CAP_USD = 190;

function loadPayload(slug) {
  const body = JSON.parse(readFileSync(join(HERE, `${slug}.json`), "utf8"));
  if (body.slug !== slug) {
    throw new Error(`${slug}.json carries slug=${body.slug} — file/slug mismatch`);
  }
  body.system_prompt = readFileSync(join(HERE, `${slug}-system.md`), "utf8");
  return body;
}

function curlJson(method, path, body) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  const args = [
    "-sS",
    "-X", method,
    "-H", "content-type: application/json",
    "-w", "\n%{http_code}",
    `${API_BASE}${path}`,
  ];
  if (method !== "GET") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials missing — run under `aws-vault exec <profile> --`");
    }
    args.push(
      "--aws-sigv4", `aws:amz:${REGION}:execute-api`,
      "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`,
    );
    if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
    args.push("--data-binary", "@-");
  }
  const res = spawnSync("curl", args, {
    input: method === "GET" ? undefined : JSON.stringify(body),
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`curl failed: ${res.stderr}`);
  const out = res.stdout;
  const nl = out.lastIndexOf("\n");
  const status = Number(out.slice(nl + 1));
  const json = out.slice(0, nl) ? JSON.parse(out.slice(0, nl)) : undefined;
  return { status, json };
}

const payloads = SLUGS.map(loadPayload);
const newBudget = payloads.reduce((t, p) => t + p.budget_monthly_usd_default, 0);
console.log(`API: ${API_BASE}`);
console.log(`Registering ${SLUGS.length} agents, combined budget USD ${newBudget}/mo (W-3 cap: ${W3_CAP_USD} across the whole roster — the API enforces the aggregate per write; this round fits at 184/190 with no cap raise).`);

if (DRY_RUN) {
  for (const p of payloads) {
    console.log(
      `  [dry-run] ${p.slug.padEnd(9)} ${p.role} — ${p.residence} — USD ${p.budget_monthly_usd_default}/mo — system_prompt ${p.system_prompt.length} chars — reports_to ${JSON.stringify(p.reports_to)}`,
    );
  }
  process.exit(0);
}

let failed = false;
for (const p of payloads) {
  const { status, json } = curlJson("POST", "/agents", p);
  if (status === 201) {
    console.log(`  ✓ ${p.slug}: created (${json.role})`);
  } else if (status === 409) {
    console.log(`  - ${p.slug}: already exists, skipped (edits go through PATCH, not re-registration)`);
  } else {
    failed = true;
    console.error(`  ✗ ${p.slug}: HTTP ${status} ${JSON.stringify(json)}`);
  }
}

// Read-back verification through the same API the SPA/manifest consume.
for (const slug of SLUGS) {
  const { status, json } = curlJson("GET", `/agents/${slug}`);
  if (status !== 200) {
    failed = true;
    console.error(`  ✗ verify ${slug}: HTTP ${status}`);
  } else {
    console.log(`  verified ${slug}: ${json.role} — USD ${json.budget_monthly_usd_effective}/mo`);
  }
}

if (failed) process.exit(1);
console.log("Done. Next: rebuild the console manifest (predev/prebuild does it) and see runbooks/agent-registration.md §after-registration.");
