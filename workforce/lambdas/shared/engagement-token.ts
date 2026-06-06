// Ephemeral capability tokens for the engagement write surface (ADR-0005).
//
// The engagement endpoint (POST /agents/{slug}/engagements) records the
// workforce's activity ledger. Rather than a long-lived static bearer in
// Secrets Manager (one more thing to provision + rotate), the write capability
// is a SHORT-LIVED token minted into DynamoDB:
//
//   - mint  → write one AUTH#ENGAGEMENT / TOKEN#{token} row with an expiry.
//             Any trusted AWS principal that can write the table can mint:
//               • the orchestrator, once per 2-hourly fire, injecting the
//                 token into each CCR task's credentials (cron path);
//               • an operator-credentialed session (Claude Code, a CLI), for
//                 ad-hoc / interactive work (workforce/scripts/record-engagement.mjs).
//   - check → the agents-api validates a presented bearer by reading the row
//             and asserting expires_at > now. DynamoDB TTL (attribute `ttl`)
//             garbage-collects expired rows; the expiry check is the source of
//             truth, so it's correct even before TTL deletion runs.
//
// "Trust = can write the table" — minting needs AWS access, exactly the
// boundary we want. A CCR session (no AWS) can only USE a token the
// orchestrator minted for it. No static secret anywhere.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";

// Resolve TABLE_NAME lazily (on first use) rather than at module load, so
// importing this module is side-effect-free — other Lambda handlers that pull
// it in transitively (and tests of those handlers) don't need the env set
// unless they actually mint/validate a token.
function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error("TABLE_NAME env var is required");
  return t;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const AUTH_PK = "AUTH#ENGAGEMENT";

/** Default lifetime: comfortably longer than any single CCR session, shorter
 *  than the 2-hour fire cadence so tokens don't overlap-pollute across ticks. */
export const DEFAULT_TTL_SECONDS = 5400; // 90 minutes

const tokenSk = (token: string): string => `TOKEN#${token}`;

export interface MintedToken {
  token: string;
  expires_at: string;
}

/** Mint a short-lived engagement-write token (one DDB row). Requires DDB
 *  write access — that IS the trust gate. */
export async function mintEngagementToken(
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
export async function isValidEngagementToken(token: string): Promise<boolean> {
  if (!token || token.length === 0) return false;
  const res = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: { pk: AUTH_PK, sk: tokenSk(token) } }),
  );
  const item = res.Item;
  if (!item || typeof item.expires_at !== "string") return false;
  return Date.parse(item.expires_at) > Date.now();
}
