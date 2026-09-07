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
  /** MODELLED spend from CCR fires the data plane dispatched but could not
   *  meter (#661). Kept in its own field on purpose: it must never be
   *  mistaken for `cost_usd`, which is measured at an LLM call site. */
  estimated_cost_usd?: number;
  /** Count of dispatched CCR fires behind `estimated_cost_usd`. */
  estimated_fires?: number;
  last_updated_at: string;
}

/** What an agent has spent this month for the purpose of the W-3 cap:
 *  measured spend plus modelled spend. Both halves are reported separately so
 *  a reader can always see which is which. */
export interface MonthSpend {
  /** Metered at an LLM call site. */
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  /** Modelled from dispatched CCR fires (#661). */
  estimated_cost_usd: number;
  estimated_fires: number;
  /** `cost_usd + estimated_cost_usd` — what the cap is checked against. */
  total_usd: number;
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
export async function getMonthSpend(slug: string): Promise<MonthSpend> {
  const month = monthKey();
  const res = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { pk: pk(month), sk: sk(slug) } }),
  );
  const row = res.Item as BudgetRow | undefined;
  const cost_usd = row?.cost_usd ?? 0;
  const estimated_cost_usd = row?.estimated_cost_usd ?? 0;
  return {
    cost_usd,
    tokens_in: row?.tokens_in ?? 0,
    tokens_out: row?.tokens_out ?? 0,
    estimated_cost_usd,
    estimated_fires: row?.estimated_fires ?? 0,
    total_usd: cost_usd + estimated_cost_usd,
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
  if (wouldBreachBudget(current.total_usd, cap_usd, planned_cost_usd)) {
    throw new Error(
      `budget guard: agent ${slug} would exceed monthly cap. current=${current.total_usd.toFixed(2)} (measured ${current.cost_usd.toFixed(2)} + modelled ${current.estimated_cost_usd.toFixed(2)}) planned=${planned_cost_usd.toFixed(2)} cap=${cap_usd.toFixed(2)} (month=${monthKey()})`,
    );
  }
}

/** The cap predicate on its own, so callers that must not throw (the
 *  orchestrator skips a binding rather than failing a whole tick) share the
 *  comparison with the ones that do. Pure — trivially testable. */
export function wouldBreachBudget(current_usd: number, cap_usd: number, planned_cost_usd: number): boolean {
  return current_usd + planned_cost_usd > cap_usd;
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

/**
 * Atomic increment of the MODELLED half of the ledger (#661), for a CCR fire
 * the orchestrator dispatched and cannot meter.
 *
 * Deliberately a separate function writing separate attributes rather than a
 * flag on `recordSpend`: the two numbers have different epistemic status, and
 * one call site should never be able to write a modelled figure into the
 * measured column by passing the wrong argument.
 *
 * Called after the routine actually fired, so a failed batch is not charged.
 */
export async function recordEstimatedSpend(slug: string, estimated_cost_usd: number): Promise<void> {
  const month = monthKey();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: pk(month), sk: sk(slug) },
      UpdateExpression:
        "ADD #estimated_cost_usd :cost, #estimated_fires :one SET #last_updated_at = :now",
      ExpressionAttributeNames: {
        "#estimated_cost_usd": "estimated_cost_usd",
        "#estimated_fires": "estimated_fires",
        "#last_updated_at": "last_updated_at",
      },
      ExpressionAttributeValues: {
        ":cost": estimated_cost_usd,
        ":one": 1,
        ":now": new Date().toISOString(),
      },
    }),
  );
}
