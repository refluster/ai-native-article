// wf-memory-compactor Lambda — Epic-012 Story 2.
//
// Nightly sweep. For every agent whose memory has accumulated
// COMPACTION_THRESHOLD run chunks since its last rolling summary, fold those
// chunks into a fresh long-term-memory summary chunk (which then becomes the
// agent's "previous memory" on its next run).
//
// Modelled on wf-audit (lambdas/audit): a standalone scheduled Lambda, not a
// skill — there is no persona acting and the work is system maintenance, not
// agent output. The one LLM call per compacting agent is a summariser, not a
// deliverable.
//
// Failure isolation: a single agent's compaction error (LLM failure, identity
// loss, or a mid-sweep memver conflict) is caught, counted, surfaced as a
// metric, and the sweep continues. One bad agent never aborts the others.

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { scanPrefix } from "../shared/ddb.js";
import {
  readChunk,
  readChunksSince,
  commitCompaction,
  type MemoryIndex,
} from "../shared/memory.js";
import {
  shouldCompact,
  buildCompactionSystemPrompt,
  buildCompactionUserPrompt,
  buildCompactionChunk,
  assertIdentityPreserved,
  IdentityLossError,
  COMPACTION_MODEL,
  COMPACTION_MAX_TOKENS,
} from "../shared/memory-compaction.js";
import { complete } from "../shared/llm-anthropic.js";
import { recordSpend } from "../shared/budget.js";

const METRIC_NAMESPACE = "Workforce/Memory";
const STAGE = process.env.STAGE ?? "dev";

const cw = new CloudWatchClient({});

export interface CompactionResult {
  scanned: number;
  compacted: number;
  skipped: number;
  identity_loss: number;
  errors: { slug: string; message: string }[];
}

export async function handler(): Promise<CompactionResult> {
  const result: CompactionResult = {
    scanned: 0,
    compacted: 0,
    skipped: 0,
    identity_loss: 0,
    errors: [],
  };

  for await (const index of iterateMemoryIndexes()) {
    result.scanned++;
    const slug = index.pk.replace(/^AGENT#/, "");
    if (!shouldCompact(index)) {
      result.skipped++;
      continue;
    }
    try {
      await compactAgent(slug, index);
      result.compacted++;
    } catch (err) {
      if (err instanceof IdentityLossError) {
        result.identity_loss++;
        result.errors.push({ slug, message: err.message });
        console.error(JSON.stringify({ event: "compaction_identity_loss", slug, dropped: err.dropped }));
        continue;
      }
      result.errors.push({ slug, message: err instanceof Error ? err.message : String(err) });
      console.error(JSON.stringify({ event: "compaction_error", slug, message: err instanceof Error ? err.message : String(err) }));
    }
  }

  await emitMetrics(result);
  console.log(JSON.stringify({ event: "compaction_sweep_complete", result }));
  return result;
}

async function compactAgent(slug: string, index: MemoryIndex): Promise<void> {
  const fromMemver = index.last_compacted_memver ?? 0;
  const priorSummary = index.latest_summary_key ? await readChunk(index.latest_summary_key) : "";
  const newChunks = await readChunksSince(slug, fromMemver, index.memver);

  const llm = await complete({
    model: COMPACTION_MODEL,
    system: buildCompactionSystemPrompt(),
    user: buildCompactionUserPrompt(priorSummary, newChunks),
    maxTokens: COMPACTION_MAX_TOKENS,
  });

  // Mechanical identity guard (C-4): throws IdentityLossError if the summary
  // dropped a prior identity fact. Ordered BEFORE the write so a bad summary
  // never lands.
  assertIdentityPreserved(priorSummary, llm.text);

  const chunkBody = buildCompactionChunk(slug, index.memver + 1, fromMemver, llm.text);
  const snippet = llm.text.replace(/\s+/g, " ").trim().slice(0, 240);
  // Conditional on memver = index.memver — a run that appended mid-sweep makes
  // this throw ConditionalCheckFailed, which the per-agent catch records.
  await commitCompaction(slug, chunkBody, snippet, index.memver);

  // Attribute the summariser spend to the agent (honest books; not budget-
  // gated — compaction is maintenance, not agent work).
  await recordSpend(slug, llm.tokens_in, llm.tokens_out, llm.cost_usd);
}

async function* iterateMemoryIndexes(): AsyncGenerator<MemoryIndex> {
  let cursor: string | undefined;
  do {
    const page = await scanPrefix<MemoryIndex>("AGENT#", "MEMORY#INDEX", 100, cursor);
    for (const item of page.items) yield item;
    cursor = page.cursor;
  } while (cursor);
}

async function emitMetrics(result: CompactionResult): Promise<void> {
  const dims = [{ Name: "Stage", Value: STAGE }];
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: [
          { MetricName: "WfMemoryCompacted", Value: result.compacted, Unit: "Count", Dimensions: dims },
          { MetricName: "WfMemoryCompactionIdentityLoss", Value: result.identity_loss, Unit: "Count", Dimensions: dims },
          { MetricName: "WfMemoryCompactionErrors", Value: result.errors.length, Unit: "Count", Dimensions: dims },
        ],
      }),
    );
  } catch (err) {
    // Best-effort: never fail the sweep on metric emission.
    console.warn(JSON.stringify({ event: "compaction_metric_emit_failed", error: err instanceof Error ? err.message : String(err) }));
  }
}
