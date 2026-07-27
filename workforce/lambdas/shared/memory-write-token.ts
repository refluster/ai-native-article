// Ephemeral capability tokens for the memory-write surface (ADR-0021,
// superseding ADR-0020's static-secret mechanism).
//
// The memory endpoint (POST /agents/{slug}/memory) writes the ADR-0019
// `memory` profile block. Rather than a long-lived static bearer in Secrets
// Manager as the primary path (one more thing to provision + rotate; ADR-0009
// already committed the org to retiring per-service static bearers), the
// write capability is a SHORT-LIVED token minted into DynamoDB — the exact
// pattern engagement-token.ts established for POST /agents/{slug}/engagements:
//
//   - mint  → write one AUTH#MEMORY_WRITE / TOKEN#{token} row with an expiry.
//             Minted by the orchestrator, once per fire that dispatches the
//             memory-curation binding (resolveCredentialsForTask special-
//             cases the `workforce.memory_write_token` requires[] entry).
//   - check → the agents-api validates a presented bearer by reading the row
//             and asserting expires_at > now. DynamoDB TTL (attribute `ttl`)
//             garbage-collects expired rows; the expiry check is the source
//             of truth, so it's correct even before TTL deletion runs.
//
// "Trust = can write the table" — minting needs AWS access, exactly the
// boundary we want. A CCR session (no AWS) can only USE a token the
// orchestrator minted for it. The static
// wf/projects/agent-workforce/workforce.memory_write_token secret (ADR-0020)
// survives as the fallback path (validateMemoryWriteBearer tries dynamic
// first, static second) — same two-path shape as the engagement validator.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";

// Resolve TABLE_NAME lazily (on first use) rather than at module load, so
// importing this module is side-effect-free — mirrors engagement-token.ts.
function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error("TABLE_NAME env var is required");
  return t;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const AUTH_PK = "AUTH#MEMORY_WRITE";

/** Default lifetime: generous enough for a memory-curation CCR session to
 *  distil + write a cohort of agents across several POST calls, short
 *  enough that a leaked token doesn't outlive the fire by much. Mirrors
 *  engagement-token.ts's DEFAULT_TTL_SECONDS. */
export const DEFAULT_TTL_SECONDS = 5400; // 90 minutes

const tokenSk = (token: string): string => `TOKEN#${token}`;

export interface MintedToken {
  token: string;
  expires_at: string;
}

/** Mint a short-lived memory-write token (one DDB row). Requires DDB write
 *  access — that IS the trust gate. */
export async function mintMemoryWriteToken(
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<MintedToken> {
  const token = randomBytes(24).toString("base64url");
  const nowMs = Date.now();
  const expires_at = new Date(nowMs + ttlSeconds * 1000).toISOString();
  const ttlEpoch = Math.floor(nowMs / 1000) + ttlSeconds;
  // UpdateItem (upsert) rather than PutItem: the orchestrator's IAM grants
  // UpdateItem, not PutItem, and the key is unique-by-random-token so there's
  // never an existing row to clobber.
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { pk: AUTH_PK, sk: tokenSk(token) },
      UpdateExpression: "SET expires_at = :e, #ttl = :t, minted_at = :m",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":e": expires_at,
        ":t": ttlEpoch,
        ":m": new Date(nowMs).toISOString(),
      },
    }),
  );
  return { token, expires_at };
}

/** True iff the token names a live (unexpired) AUTH row. */
export async function isValidMemoryWriteToken(token: string): Promise<boolean> {
  if (!token || token.length === 0) return false;
  const res = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: { pk: AUTH_PK, sk: tokenSk(token) } }),
  );
  const item = res.Item;
  if (!item || typeof item.expires_at !== "string") return false;
  return Date.parse(item.expires_at) > Date.now();
}
