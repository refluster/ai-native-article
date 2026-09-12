#!/usr/bin/env node
// create-board.mjs — create (or re-key) a Q&A board (ADR-0034).
//
// Writes the `BOARD#{id}/META` row directly with the AWS CLI from the
// operator's machine, the same posture as seed-projects.mjs: boards are
// created a few times a year, so a Lambda + IAM grant for it is more
// surface than the problem warrants, and the CLI shell-out keeps this
// script dependency-free. The row shape mirrors
// workforce/lambdas/shared/board.ts (BoardMetaRow); the password hash is
// the same scrypt(password, salt, 32) the API verifies against, so the two
// must move together.
//
// Usage:
//   BOARD_PASSWORD='…' node workforce/scripts/create-board.mjs [stage] --name "Board name" [--id my-board] [--agents maya,dario]
//   BOARD_PASSWORD='…' node workforce/scripts/create-board.mjs [stage] --id my-board --reset-password
//   node workforce/scripts/create-board.mjs [stage] --id my-board --archive
//
//   stage        dev | prod (default prod)
//   --name       display name shown in the board header (create only)
//   --id         board id in the URL (default: a random UUID v4)
//   --agents     comma-separated agent slugs guests may mention (default: every non-archived agent)
//   --reset-password   re-hash BOARD_PASSWORD on an existing board (revokes every guest token)
//   --archive / --unarchive   close / reopen the board (reads 410, writes refused)
//
// Requires: `aws` CLI on PATH with credentials that can write wf-table-{stage}.
// The password is read from the BOARD_PASSWORD env var (never from argv, so it
// stays out of shell history). Prints the board URL on success.

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

const BOARD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const CONSOLE_ORIGIN = "https://workforce.kohuehara.xyz";

function parseArgs(argv) {
  const out = { stage: "prod", flags: new Set(), opts: {} };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["reset-password", "archive", "unarchive", "help"].includes(key)) {
        out.flags.add(key);
      } else {
        out.opts[key] = argv[++i];
      }
    } else {
      positional.push(a);
    }
  }
  if (positional[0]) out.stage = positional[0];
  return out;
}

function usage(msg) {
  if (msg) console.error(`create-board: ${msg}\n`);
  console.error(
    [
      "usage: BOARD_PASSWORD='…' node workforce/scripts/create-board.mjs [stage] --name <name> [--id <id>] [--agents a,b]",
      "       BOARD_PASSWORD='…' node workforce/scripts/create-board.mjs [stage] --id <id> --reset-password",
      "       node workforce/scripts/create-board.mjs [stage] --id <id> --archive|--unarchive",
    ].join("\n"),
  );
  process.exit(2);
}

function aws(args) {
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Same shape as shared/board.ts hashBoardPassword — keep in lockstep. */
export function hashPassword(password, saltHex) {
  return scryptSync(password, saltHex, 32).toString("hex");
}

export function metaItem({ boardId, name, salt, hash, agents, createdAt }) {
  const item = {
    pk: { S: `BOARD#${boardId}` },
    sk: { S: "META" },
    board_id: { S: boardId },
    name: { S: name },
    password_salt: { S: salt },
    password_hash: { S: hash },
    archived: { BOOL: false },
    created_at: { S: createdAt },
    updated_at: { S: createdAt },
  };
  if (agents && agents.length > 0) item.agents = { L: agents.map((s) => ({ S: s })) };
  return item;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
  const { stage, flags, opts } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) usage();
  if (!/^(dev|prod)$/.test(stage)) usage(`invalid stage "${stage}" — expected dev or prod`);
  const region = process.env.AWS_REGION ?? "us-west-2";
  const table = `wf-table-${stage}`;
  const now = new Date().toISOString();

  const boardId = (opts.id ?? randomUUID()).toLowerCase();
  if (!BOARD_ID_PATTERN.test(boardId)) usage(`invalid --id "${boardId}" (a-z, 0-9, '-', 3–64 chars)`);
  const key = JSON.stringify({ pk: { S: `BOARD#${boardId}` }, sk: { S: "META" } });

  if (flags.has("archive") || flags.has("unarchive")) {
    const archived = flags.has("archive");
    aws([
      "dynamodb", "update-item", "--region", region, "--table-name", table, "--key", key,
      "--condition-expression", "attribute_exists(pk)",
      "--update-expression", "SET archived = :a, updated_at = :t",
      "--expression-attribute-values", JSON.stringify({ ":a": { BOOL: archived }, ":t": { S: now } }),
    ]);
    console.log(`create-board: ${archived ? "archived" : "reopened"} ${boardId} on ${table}`);
    process.exit(0);
  }

  const password = process.env.BOARD_PASSWORD ?? "";
  if (password.length < 8) usage("BOARD_PASSWORD must be set and at least 8 characters");
  const salt = randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);

  if (flags.has("reset-password")) {
    aws([
      "dynamodb", "update-item", "--region", region, "--table-name", table, "--key", key,
      "--condition-expression", "attribute_exists(pk)",
      "--update-expression", "SET password_salt = :s, password_hash = :h, updated_at = :t",
      "--expression-attribute-values", JSON.stringify({ ":s": { S: salt }, ":h": { S: hash }, ":t": { S: now } }),
    ]);
    console.log(`create-board: password reset for ${boardId} on ${table} — every guest token for this board is now invalid`);
    console.log(`${CONSOLE_ORIGIN}/boards/${boardId}`);
    process.exit(0);
  }

  const name = (opts.name ?? "").trim();
  if (name.length === 0 || name.length > 80) usage("--name is required (1–80 chars)");
  const agents = opts.agents ? opts.agents.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined;
  if (agents && agents.some((s) => !/^[a-z]+$/.test(s))) usage("--agents must be lowercase agent slugs");

  aws([
    "dynamodb", "put-item", "--region", region, "--table-name", table,
    "--item", JSON.stringify(metaItem({ boardId, name, salt, hash, agents, createdAt: now })),
    "--condition-expression", "attribute_not_exists(pk)",
  ]);
  console.log(`create-board: created ${boardId} ("${name}") on ${table}${agents ? ` — agents: ${agents.join(", ")}` : " — agents: all"}`);
  console.log(`${CONSOLE_ORIGIN}/boards/${boardId}`);
}
