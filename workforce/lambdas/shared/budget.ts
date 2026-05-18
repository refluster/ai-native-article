// Per-agent monthly token-budget guard. Enforces W-3 at the LLM call site:
// the orchestrator/runner consults this before invoking complete(), and
// throws (rather than silently overrun) if the projected cost would
// breach the agent's cap.
//
// State lives in DDB BUDGET#{yyyy-mm}/AGENT#{slug}. Atomic ADD updates so
// concurrent runs don't lose increments. Reads are fresh (no caching).

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) throw new Error("TABLE_NAME env var is required");
const tableName: string = TABLE_NAME;

const raw = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

export interface BudgetRow {
  pk: `BUDGET#${string}`;
  sk: `AGENT#${string}`;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  last_updated_at: string;
}

function monthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function pk(month: string): `BUDGET#${string}` {
  return `BUDGET#${month}`;
}
function sk(slug: string): `AGENT#${string}` {
  return `AGENT#${slug}`;
}

/** Read the current month's spend for an agent. Returns zeros if no row yet. */
export async function getMonthSpend(slug: string): Promise<{ cost_usd: number; tokens_in: number; tokens_out: number }> {
  const month = monthKey();
  const res = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { pk: pk(month), sk: sk(slug) } }),
  );
  const row = res.Item as BudgetRow | undefined;
  return {
    cost_usd: row?.cost_usd ?? 0,
    tokens_in: row?.tokens_in ?? 0,
    tokens_out: row?.tokens_out ?? 0,
  };
}

/**
 * Throws if a planned spend would breach the agent's monthly cap.
 * `cap_usd` is the *effective* cap (override or default).
 * `planned_cost_usd` is the worst-case spend the runner is about to incur.
 */
export async function assertWithinBudget(
  slug: string,
  cap_usd: number,
  planned_cost_usd: number,
): Promise<void> {
  const current = await getMonthSpend(slug);
  const projected = current.cost_usd + planned_cost_usd;
  if (projected > cap_usd) {
    throw new Error(
      `budget guard: agent ${slug} would exceed monthly cap. current=${current.cost_usd.toFixed(2)} planned=${planned_cost_usd.toFixed(2)} projected=${projected.toFixed(2)} cap=${cap_usd.toFixed(2)} (month=${monthKey()})`,
    );
  }
}

/** Atomic increment after the run. Idempotency is the runner's job (one increment per RUN row). */
export async function recordSpend(
  slug: string,
  tokens_in: number,
  tokens_out: number,
  cost_usd: number,
): Promise<void> {
  const month = monthKey();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: pk(month), sk: sk(slug) },
      UpdateExpression:
        "ADD #tokens_in :ti, #tokens_out :to, #cost_usd :cost SET #last_updated_at = :now",
      ExpressionAttributeNames: {
        "#tokens_in": "tokens_in",
        "#tokens_out": "tokens_out",
        "#cost_usd": "cost_usd",
        "#last_updated_at": "last_updated_at",
      },
      ExpressionAttributeValues: {
        ":ti": tokens_in,
        ":to": tokens_out,
        ":cost": cost_usd,
        ":now": new Date().toISOString(),
      },
    }),
  );
}
