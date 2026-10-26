// wf-lesson-distiller Lambda — Epic-022 Story 1, ADR-0032 §3.
//
// Daily. Reads the previous UTC day of cross-agent EXEC ledger rows, makes ONE
// bounded cheap-model pass, deterministically pre-filters the proposals, and
// writes survivors as `LESSON` / `LESSON#{scope}#{ulid}` candidates.
//
// Modelled on wf-memory-compactor: standalone scheduled Lambda, no persona.
// Spend is charged to a system-scoped DAILY row (BUDGET#{yyyy-mm-dd} /
// SYSTEM#lesson-distiller) with a throwing ceiling — never silently truncated.
//
// Slice 1 reads EXEC rows only. DLQ'd failures and W-1 guard trips (the other
// two ADR-0032 sources) are not yet scanned.

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { ConditionalCheckFailedException, conditionalPutItem, ddb, getItem, scanExecWindow } from "../shared/ddb.js";
import { complete } from "../shared/llm-anthropic.js";
import type { ExecLedgerRow } from "../shared/exec-ledger-types.js";
import {
  DISTILLER_CAP_TOKENS,
  DISTILLER_MAX_TOKENS,
  DISTILLER_MODEL,
  allowedScopesFor,
  assertWithinDailyBudget,
  buildDistillerSystemPrompt,
  buildDistillerUserPrompt,
  buildLessonRow,
  estimateTokens,
  lessonId,
  parseCandidates,
  previousUtcDay,
  refRowsFor,
  selectSourceRows,
  validateCandidate,
} from "../shared/lesson-distiller.js";

const STAGE = process.env.STAGE ?? "dev";
const cw = new CloudWatchClient({});

export interface DistillerResult {
  day: string;
  scanned: number;
  fed: number;
  proposed: number;
  written: number;
  rejected: Record<string, number>;
  duplicates: number;
  tokens: number;
  skipped?: "no_rows";
}

interface DailyBudgetRow {
  tokens_in?: number;
  tokens_out?: number;
}

const BUDGET_SK = "SYSTEM#lesson-distiller";

export async function handler(event?: { now?: string }): Promise<DistillerResult> {
  const now = event?.now ? new Date(event.now) : new Date();
  const runId = `lesson-distiller-${now.toISOString()}`;
  const { day, from, to } = previousUtcDay(now);
  const result: DistillerResult = { day, scanned: 0, fed: 0, proposed: 0, written: 0, duplicates: 0, tokens: 0, rejected: {} };

  const all = await scanExecWindow<ExecLedgerRow>(from, to);
  result.scanned = all.length;
  const rows = selectSourceRows(all);
  result.fed = rows.length;
  if (rows.length === 0) {
    result.skipped = "no_rows";
    await emitMetrics(result);
    return result;
  }

  const system = buildDistillerSystemPrompt();
  const user = buildDistillerUserPrompt(day, rows);

  // Pre-call guard: throws (W-4 → WfLessonDistillerErrorsAlarm, no retry) rather than truncating.
  const budgetPk = `BUDGET#${now.toISOString().slice(0, 10)}`;
  const spent = await getItem<DailyBudgetRow>(budgetPk, BUDGET_SK);
  const planned = estimateTokens(system + user) + DISTILLER_MAX_TOKENS;
  assertWithinDailyBudget((spent?.tokens_in ?? 0) + (spent?.tokens_out ?? 0), planned, DISTILLER_CAP_TOKENS);

  const llm = await complete({ model: DISTILLER_MODEL, system, user, maxTokens: DISTILLER_MAX_TOKENS });
  await recordDailySpend(budgetPk, llm.tokens_in, llm.tokens_out, llm.cost_usd);
  result.tokens = llm.tokens_in + llm.tokens_out;

  const candidates = parseCandidates(llm.text);
  result.proposed = candidates.length;
  const scopes = allowedScopesFor(rows);
  const refRows = refRowsFor(rows);

  for (const c of candidates) {
    const verdict = validateCandidate(c, scopes, refRows);
    if (!verdict.ok) {
      result.rejected[verdict.reason] = (result.rejected[verdict.reason] ?? 0) + 1;
      continue;
    }
    // Deterministic sk + conditional put: a retry after a mid-loop throw
    // skips rows already written instead of duplicating them.
    const id = lessonId(day, verdict.lesson.scope, verdict.lesson.body);
    try {
      await conditionalPutItem(buildLessonRow(verdict.lesson, id, runId, now), "attribute_not_exists(pk)");
      result.written++;
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      result.duplicates++;
    }
  }

  await emitMetrics(result);
  console.log(JSON.stringify({ event: "lesson_distiller_complete", result }));
  return result;
}

async function recordDailySpend(pk: string, tin: number, tout: number, cost: number): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { pk, sk: BUDGET_SK },
      UpdateExpression:
        "ADD #ti :ti, #to :to, #c :c SET #cap = :cap, #lu = :now",
      ExpressionAttributeNames: { "#ti": "tokens_in", "#to": "tokens_out", "#c": "cost_usd", "#cap": "cap_tokens", "#lu": "last_updated_at" },
      ExpressionAttributeValues: { ":ti": tin, ":to": tout, ":c": cost, ":cap": DISTILLER_CAP_TOKENS, ":now": new Date().toISOString() },
    }),
  );
}

async function emitMetrics(r: DistillerResult): Promise<void> {
  const dims = [{ Name: "Stage", Value: STAGE }];
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Lessons",
        MetricData: [
          { MetricName: "WfLessonDistillerRuns", Value: 1, Unit: "Count", Dimensions: dims },
          { MetricName: "WfLessonDistillerSkipped", Value: r.skipped ? 1 : 0, Unit: "Count", Dimensions: dims },
          { MetricName: "WfLessonDistillerTokensSpent", Value: r.tokens, Unit: "Count", Dimensions: dims },
          { MetricName: "WfLessonCandidatesWritten", Value: r.written, Unit: "Count", Dimensions: dims },
          { MetricName: "WfLessonCandidatesRejected", Value: Object.values(r.rejected).reduce((a, b) => a + b, 0), Unit: "Count", Dimensions: dims },
        ],
      }),
    );
  } catch (err) {
    console.warn(JSON.stringify({ event: "lesson_metric_emit_failed", error: err instanceof Error ? err.message : String(err) }));
  }
}
