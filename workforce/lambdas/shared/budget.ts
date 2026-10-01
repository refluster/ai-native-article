// Per-agent monthly token-budget ledger (W-3). Since ADR-0037 the per-agent
// budget is ADVISORY: every caller measures and reports the month's position;
// none refuses work because of it. Output continuity outranks the figure.
//
// State lives in DDB BUDGET#{yyyy-mm}/AGENT#{slug}. Atomic ADD updates so
// concurrent runs don't lose increments. Reads are fresh (no caching).

import { budgetMonthKey, type BudgetRow } from "./budget-schema.js";
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

export type { BudgetRow } from "./budget-schema.js";

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
  /** When the orchestrator first refused a fire for this agent this month
   *  (ML-038). Absent while the cap has not been reached. */
  cap_reached_at?: string;
}

const monthKey = budgetMonthKey;

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
    ...(row?.cap_reached_at ? { cap_reached_at: row.cap_reached_at } : {}),
  };
}

/**
 * Stamp the month's ledger row with the moment the advisory budget was first
 * crossed (ML-038 / ADR-0037). Returns TRUE only for the write that set it and
 * FALSE on every later call. Conditional on the attribute not existing, so two
 * ticks cannot both be "first". `/performance` lists every agent whose row
 * carries the stamp as over budget this month.
 */
export async function recordCapReached(slug: string, now: Date = new Date()): Promise<boolean> {
  const month = monthKey(now);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: pk(month), sk: sk(slug) },
        UpdateExpression: "SET #cap_reached_at = :now",
        ConditionExpression: "attribute_not_exists(#cap_reached_at)",
        ExpressionAttributeNames: { "#cap_reached_at": "cap_reached_at" },
        ExpressionAttributeValues: { ":now": now.toISOString() },
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/**
 * Report where a planned spend lands against the agent's monthly budget
 * (ADR-0037). Never throws and never blocks: the budget is a planning figure,
 * and output continuity outranks it. The position is logged so a caller that
 * wants to react can, and the ledger stamp (`recordCapReached`) makes the
 * first crossing of the month visible on /performance.
 */
export async function reportBudgetPosition(
  slug: string,
  budget_usd: number,
  planned_cost_usd: number,
): Promise<MonthSpend & { over_budget: boolean }> {
  const current = await getMonthSpend(slug);
  const over_budget = wouldBreachBudget(current.total_usd, budget_usd, planned_cost_usd);
  if (over_budget) {
    console.warn(JSON.stringify({
      event: "budget-advisory-exceeded",
      slug,
      month: monthKey(),
      current_usd: Number(current.total_usd.toFixed(4)),
      planned_usd: planned_cost_usd,
      budget_usd,
    }));
  }
  return { ...current, over_budget };
}

/** The over-budget predicate, shared by every reporter so they agree about
 *  what "over" means. Pure — trivially testable. */
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
