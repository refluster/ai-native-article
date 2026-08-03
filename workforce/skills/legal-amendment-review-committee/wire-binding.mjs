#!/usr/bin/env node
// Wire maya's `legal-amendment-review-committee` binding via
// PATCH /agents/maya (ADR-0007: bindings are DDB config, agents-api is the
// single writer — each PATCH is validated (R8 against the SKILL# rows) and
// lands its own AUDIT item; write = live, no deploy).
//
// One agent, one binding: maya (the committee chair) ← the
// legal-amendment-review-committee skill, executor=claude-code-routine,
// scheduler=manual (non-periodic; the amendment under review is supplied
// per invocation — there is NO cron). Mirrors the shape documented in
// workforce/docs/routines/legal-amendment-review-committee.md.
//
// PREREQ (fail-loud if unmet): the PR adding workforce/skills/
// legal-amendment-review-committee must be MERGED and the data-plane deploy
// finished — wf-seed-skills creates the SKILL#legal-amendment-review-
// committee row (owners=[maya]) post-deploy, and the R8 write-time check
// validates this binding against that row. Running before the seed 422s
// with R8-binding-skill-exists (no partial write).
//
// Idempotent: maya's existing bindings are preserved (append-only —
// binding_idx is load-bearing); if the committee skill is already bound,
// this skips rather than duplicating it.
//
// Usage:
//   node workforce/skills/legal-amendment-review-committee/wire-binding.mjs --dry-run
//   aws-vault exec <profile> -- node workforce/skills/legal-amendment-review-committee/wire-binding.mjs

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const DRY_RUN = process.argv.includes("--dry-run");

const AGENT = "maya";
const SKILL = "legal-amendment-review-committee";

// claude-code-routine + manual is the declarative-pending shape (the
// routine_spec is the load-bearing artefact; operator-invoked today). No
// cron: this committee convenes on demand, not on a schedule.
const BINDING = {
  skill: SKILL,
  executor: "claude-code-routine",
  trigger: { scheduler: "manual" },
  routine_spec: `workforce/docs/routines/${SKILL}.md`,
  project_id: "asp-cloud",
  note: "VP-tier+ committee; reviews asp-cloud governance amendments; comment-only (W-5/R-N9).",
};

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

const cur = await (await fetch(`${API_BASE}/agents/${AGENT}`)).json();
if (!Array.isArray(cur.bindings)) {
  console.error(`✗ ${AGENT}: GET returned no bindings[] (agent registered?)`);
  process.exit(1);
}
if (cur.bindings.some((b) => b.skill === SKILL)) {
  console.log(`- ${AGENT}: ${SKILL} already bound, skipped`);
  process.exit(0);
}

// Append-only: existing bindings keep their binding_idx.
const next = [...cur.bindings, BINDING];
if (DRY_RUN) {
  console.log(`[dry-run] ${AGENT}: would PATCH bindings -> +1 (${SKILL} @ manual); total ${next.length}`);
  process.exit(0);
}

const { status, json } = curlJson("PATCH", `/agents/${AGENT}`, { bindings: next });
if (status === 200) {
  console.log(`✓ ${AGENT}: bound ${SKILL} (claude-code-routine + manual; project=asp-cloud)`);
  console.log("Done — write = live (ADR-0007). Invoke the committee on demand; there is no cron.");
} else {
  console.error(`✗ ${AGENT}: HTTP ${status} ${JSON.stringify(json)}`);
  if (status === 422) {
    console.error("  422 usually means the SKILL# row isn't seeded yet (R8-binding-skill-exists) —");
    console.error("  ensure the skill PR is merged AND the data-plane deploy + wf-seed-skills have run.");
  }
  process.exit(1);
}
