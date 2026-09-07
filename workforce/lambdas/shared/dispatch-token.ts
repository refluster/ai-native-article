// Ephemeral capability tokens for the binding-dispatch surface (adr-0025).
//
// `POST /dispatch` lets a running CCR session ask the workforce to fire an
// ALREADY-DECLARED binding immediately — the event-driven half of the author
// lane's hand-off (adr-0022): pr-autopilot parks a PR in the lane and, in the
// same breath, asks for pr-remediate to be fired rather than leaving the PR to
// wait for that cadence's next cron.
//
// The capability is a SHORT-LIVED token minted into DynamoDB — the same
// dynamic-token idiom engagement-token.ts (ADR-0009) and memory-write-token.ts
// (ADR-0021) established, for the same reason: "trust = can write the table".
// Minting needs AWS access; a CCR session (which holds no AWS credentials) can
// only USE a token the orchestrator minted into its task's credential bag.
//
//   - mint  → one AUTH#DISPATCH / TOKEN#{token} row with an expiry. Minted by
//             the orchestrator, once per fire, for every task whose skill
//             declares `workforce.dispatch_token` in meta.json:requires[].
//   - check → the agents-api validates a presented bearer by reading the row
//             and asserting expires_at > now. DynamoDB TTL garbage-collects
//             the expired rows; the expiry check is the source of truth, so it
//             is correct even before TTL deletion runs.
//
// There is deliberately NO static-secret fallback path (unlike the memory and
// engagement validators, which carry one for their pre-ADR consumers): this
// surface starts a *fire*, so the only holder should be a session the
// orchestrator itself started this cycle.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";

// Resolved lazily (on first use) so importing this module is side-effect-free
// — mirrors engagement-token.ts / memory-write-token.ts.
function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error("TABLE_NAME env var is required");
  return t;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const AUTH_PK = "AUTH#DISPATCH";

/** Default lifetime. A pr-autopilot fire routes, reviews and verdicts several
 *  PRs before it reaches the hand-off that wants the dispatch, so the token
 *  has to outlive the whole run; 90 minutes matches the sibling tokens. */
export const DEFAULT_TTL_SECONDS = 5400; // 90 minutes

const tokenSk = (token: string): string => `TOKEN#${token}`;

export interface MintedDispatchToken {
  token: string;
  expires_at: string;
}

/** Mint a short-lived dispatch token (one DDB row). Requires DDB write access
 *  — that IS the trust gate. */
export async function mintDispatchToken(
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<MintedDispatchToken> {
  const token = randomBytes(24).toString("base64url");
  const nowMs = Date.now();
  const expires_at = new Date(nowMs + ttlSeconds * 1000).toISOString();
  const ttlEpoch = Math.floor(nowMs / 1000) + ttlSeconds;
  // UpdateItem (upsert) rather than PutItem: the orchestrator's IAM grants
  // UpdateItem, and the key is unique-by-random-token so there is never an
  // existing row to clobber.
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
export async function isValidDispatchToken(token: string): Promise<boolean> {
  if (!token || token.length === 0) return false;
  const res = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: { pk: AUTH_PK, sk: tokenSk(token) } }),
  );
  const item = res.Item;
  if (!item || typeof item.expires_at !== "string") return false;
  return Date.parse(item.expires_at) > Date.now();
}
