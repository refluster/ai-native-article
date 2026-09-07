// budget-schema.ts — the shape of the W-3 ledger and how its partition key is
// derived. No DynamoDB client, no environment: importable by anything that
// needs to *read about* the ledger without being a writer to it.
//
// Split out of budget.ts because that module constructs a DDB client and
// throws on a missing TABLE_NAME at import time. When agents-api's
// /performance route started reporting spend (#661) it only needed the month
// key and the row type — dragging the client in with them broke six unrelated
// test files that mock `shared/ddb.js` rather than setting TABLE_NAME. The
// schema is not the client.

/** A month's ledger row for one agent: `BUDGET#{yyyy-mm}` / `AGENT#{slug}`. */
export interface BudgetRow {
  pk: `BUDGET#${string}`;
  sk: `AGENT#${string}`;
  tokens_in: number;
  tokens_out: number;
  /** Metered at an LLM call site. */
  cost_usd: number;
  /** MODELLED spend from CCR fires the data plane dispatched but could not
   *  meter (#661). Kept in its own field on purpose: it must never be
   *  mistaken for `cost_usd`. */
  estimated_cost_usd?: number;
  /** Count of dispatched CCR fires behind `estimated_cost_usd`. */
  estimated_fires?: number;
  last_updated_at: string;
}

/**
 * The billing month, "YYYY-MM", in UTC.
 *
 * One definition, so the writer (orchestrator, per fire) and the reader
 * (agents-api `/performance`) can never disagree about which month a fire
 * belongs to — a disagreement would silently split one month's spend across
 * two partitions and under-report both.
 */
export function budgetMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** The roll-up `GET /performance` serves. Shape mirrors `BudgetBlock` in
 *  shared/performance.ts (which is itself mirrored client-side); this module
 *  stays free of that import so the schema has no dependencies at all. */
export interface BudgetRollup {
  month: string;
  modelled_usd: number;
  measured_usd: number;
  fires: number;
  agents_charged: number;
  ceiling_usd: number;
}

/**
 * Sum a month's ledger rows into the roll-up.
 *
 * Returns `undefined` for an empty month rather than a zero-filled block. A
 * fresh month and a writer that has stopped charging look identical from the
 * client, and a rendered `$0.00` would claim the first while hiding the
 * second — the "an unknown is never a measured zero" line this codebase
 * already holds elsewhere.
 *
 * Pure so the arithmetic is testable without a DynamoDB fixture; the handler
 * owns the (drained) query.
 */
export function summariseBudgetRows(
  rows: readonly Partial<BudgetRow>[],
  month: string,
  ceiling_usd: number,
): BudgetRollup | undefined {
  if (rows.length === 0) return undefined;
  let modelled = 0;
  let measured = 0;
  let fires = 0;
  for (const row of rows) {
    modelled += row.estimated_cost_usd ?? 0;
    measured += row.cost_usd ?? 0;
    fires += row.estimated_fires ?? 0;
  }
  return {
    month,
    // Repeated float addition drifts into sub-cent noise ($1.0000000000000002);
    // the ledger's own precision is cents.
    modelled_usd: Math.round(modelled * 100) / 100,
    measured_usd: Math.round(measured * 100) / 100,
    fires,
    agents_charged: rows.length,
    ceiling_usd,
  };
}
