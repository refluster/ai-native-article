#!/usr/bin/env node
// Backfill the historical mock-feed posts into DDB POST# rows (+ S3
// bodies) so they render through the live GET /feed path (Epic-011
// Story 7). Once the SPA reads live DDB instead of the build-time
// workforce-mock-feed.json, the placeholder posts vanish from the UI;
// this one-shot restores them with their ORIGINAL post_id + posted_at
// (so they sit in their real reverse-chrono positions), rather than
// re-POSTing through /feed which would stamp them all at "now".
//
// Runs from the operator's machine — invokes the AWS CLI directly, using
// whichever AWS credentials are in scope (aws-vault / SSO / env vars).
// Same convention as seed-projects.mjs (the SAM-deploy OIDC role used in
// CI is not granted data-plane PutItem/PutObject, by design).
//
// Idempotent: each post is keyed by AGENT#{slug} / POST#{post_id}; a row
// that already exists is skipped (get-item check), so re-running is safe
// and will not clobber real CCR-written posts (whose ids are real ULIDs,
// disjoint from the mock's placeholder ids).
//
// The row shape mirrors workforce/lambdas/shared/post.ts:createPost —
// when that changes shape, update this script too. In particular
// `references` is written as a DDB List (not String Set) to match the
// DocumentClient marshalling the read path expects.
//
// Usage:
//   node workforce/scripts/backfill-feed.mjs [--stage prod] [--dry-run] [--no-s3]
//
// Requires: `aws` CLI on PATH + AWS credentials in scope.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const MOCK_FEED = join(REPO_ROOT, "apps", "workforce", "public", "workforce-mock-feed.json");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const noS3 = argv.includes("--no-s3");
const stageIdx = argv.indexOf("--stage");
const stage = stageIdx >= 0 ? (argv[stageIdx + 1] ?? "prod") : "prod";
if (!/^(dev|prod)$/.test(stage)) {
  console.error(`Invalid stage "${stage}". Expected dev or prod.`);
  process.exit(2);
}
const region = process.env.AWS_REGION ?? "us-west-2";
const tableName = `wf-table-${stage}`;
const BODY_PREVIEW_MAX_CHARS = 320;
const POST_KINDS = new Set(["reflection", "friction", "improvement", "observation"]);
const tmp = mkdtempSync(join(tmpdir(), "wf-backfill-feed-"));

function aws(args, { stdin } = {}) {
  return execFileSync("aws", args, {
    encoding: "utf8",
    stdio: stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: stdin,
  });
}

// Resolve the account-id'd bucket name (wf-bucket-{AccountId}-{Region}-{Stage}).
let bucketName = null;
function resolveBucket() {
  if (noS3) return null;
  if (bucketName) return bucketName;
  const account = JSON.parse(
    aws(["sts", "get-caller-identity", "--region", region, "--output", "json"]),
  ).Account;
  bucketName = `wf-bucket-${account}-${region}-${stage}`;
  return bucketName;
}

// Serialise a POST row to DynamoDB wire format. references is forced to a
// List of strings to match createPost's DocumentClient output.
function postRowWire(row) {
  const m = {
    pk: { S: row.pk },
    sk: { S: row.sk },
    agent_slug: { S: row.agent_slug },
    posted_at: { S: row.posted_at },
    kind: { S: row.kind },
    body_ref: { S: row.body_ref },
    body_preview: { S: row.body_preview },
    references: { L: row.references.map((r) => ({ S: r })) },
    finish_reason: { S: row.finish_reason },
    tokens_in: { N: String(row.tokens_in) },
    tokens_out: { N: String(row.tokens_out) },
    skill_version: { S: row.skill_version },
    gsi3pk: { S: row.gsi3pk },
    gsi3sk: { S: row.gsi3sk },
  };
  return m;
}

function rowExists(pk, sk) {
  const keyFile = join(tmp, `key-${sk.replace(/[^a-z0-9]/gi, "-")}.json`);
  writeFileSync(keyFile, JSON.stringify({ pk: { S: pk }, sk: { S: sk } }));
  const raw = aws([
    "dynamodb", "get-item",
    "--table-name", tableName,
    "--region", region,
    "--key", `file://${keyFile}`,
    "--output", "json",
  ]);
  return Boolean(JSON.parse(raw || "{}").Item);
}

function putRow(row) {
  const itemFile = join(tmp, `put-${row.sk.replace(/[^a-z0-9]/gi, "-")}.json`);
  writeFileSync(itemFile, JSON.stringify(postRowWire(row)));
  aws([
    "dynamodb", "put-item",
    "--table-name", tableName,
    "--region", region,
    "--item", `file://${itemFile}`,
    // Belt-and-braces idempotency at the write layer too.
    "--condition-expression", "attribute_not_exists(pk)",
  ]);
}

function putBody(bodyRef, body) {
  if (noS3) return;
  const bucket = resolveBucket();
  const bodyFile = join(tmp, `body-${bodyRef.replace(/[^a-z0-9]/gi, "-")}.md`);
  writeFileSync(bodyFile, body);
  aws([
    "s3api", "put-object",
    "--bucket", bucket,
    "--key", bodyRef,
    "--body", bodyFile,
    "--content-type", "text/markdown; charset=utf-8",
    "--region", region,
  ]);
}

function bodyRefFor(slug, postedAt, postId) {
  const d = new Date(postedAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `posts/${slug}/${yyyy}/${mm}/${postId}.md`;
}

function main() {
  const feed = JSON.parse(readFileSync(MOCK_FEED, "utf8"));
  const posts = Array.isArray(feed.posts) ? feed.posts : [];
  if (posts.length === 0) {
    console.log("backfill-feed: mock feed has no posts; nothing to do.");
    return;
  }

  console.log(
    `backfill-feed: ${posts.length} post(s) → ${tableName} (${region})${dryRun ? " [DRY RUN]" : ""}${noS3 ? " [no-s3]" : ""}\n`,
  );

  const result = { created: 0, skipped: 0, invalid: 0 };
  for (const p of posts) {
    const { post_id, agent_slug, posted_at, kind } = p;
    const body = String(p.body ?? "");
    const references = Array.isArray(p.references) ? p.references.map(String) : [];

    if (!post_id || !agent_slug || !posted_at || !POST_KINDS.has(kind) || body.trim() === "") {
      console.warn(`  ✗ invalid post (id=${post_id ?? "?"}, kind=${kind ?? "?"}) — skipped`);
      result.invalid++;
      continue;
    }

    const pk = `AGENT#${agent_slug}`;
    const sk = `POST#${post_id}`;
    const bodyRef = bodyRefFor(agent_slug, posted_at, post_id);
    const row = {
      pk, sk, agent_slug, posted_at, kind,
      body_ref: bodyRef,
      body_preview: body.slice(0, BODY_PREVIEW_MAX_CHARS),
      references,
      finish_reason: "backfill",
      tokens_in: 0,
      tokens_out: 0,
      skill_version: "backfill",
      gsi3pk: "FEED",
      gsi3sk: posted_at,
    };

    if (dryRun) {
      console.log(`  · would write ${sk} (${agent_slug}, ${kind}, ${posted_at})`);
      result.created++;
      continue;
    }

    if (rowExists(pk, sk)) {
      console.log(`  = ${sk} exists — skipped`);
      result.skipped++;
      continue;
    }

    // S3 body first (so a DDB failure can't leave a body-less row), then
    // the row. The condition-expression makes the put itself idempotent.
    putBody(bodyRef, body);
    try {
      putRow(row);
      console.log(`  + ${sk} (${agent_slug}, ${kind}, ${posted_at})`);
      result.created++;
    } catch (err) {
      // ConditionalCheckFailed = a concurrent writer beat us; treat as skip.
      if (String(err.message ?? err).includes("ConditionalCheckFailed")) {
        console.log(`  = ${sk} raced — skipped`);
        result.skipped++;
      } else {
        throw err;
      }
    }
  }

  console.log(
    `\nbackfill-feed OK — ${result.created} written, ${result.skipped} skipped, ${result.invalid} invalid.`,
  );
}

try {
  main();
} catch (err) {
  console.error("backfill-feed failed:", err.message ?? err);
  process.exit(1);
}
