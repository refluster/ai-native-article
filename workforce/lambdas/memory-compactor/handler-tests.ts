// Unit tests for workforce/lambdas/memory-compactor/handler.ts
//
// ROADMAP Phase 4 — "Memory compaction" acceptance criteria:
//   - Compaction runs without losing agent identity.
//   - memver is monotonic (commitCompaction is called with the correct
//     expected memver so the conditional write enforces it).
//   - Per-agent errors are isolated; one bad agent never aborts the sweep.
//
// The DDB / S3 / LLM surfaces are mocked so tests are pure-unit. The real
// memory-compaction.ts (shouldCompact, assertIdentityPreserved, etc.) runs
// unmodified — this exercises the identity-preservation guard end-to-end.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPACTION_THRESHOLD } from "../shared/memory-compaction.js";
import type { MemoryIndex } from "../shared/memory.js";

// memory.ts has a module-top-level env-var guard; set both vars before the
// handler is dynamically imported below so the mock intercepts all accesses
// before the real module is ever evaluated.
process.env.TABLE_NAME = "wf-table-test";
process.env.BUCKET_NAME = "wf-bucket-test";
process.env.STAGE = "test";

// ── Mutable state consumed by mock callbacks ──────────────────────────────

interface ScanPage {
  items: MemoryIndex[];
  cursor?: string;
}

/** Pages to return from scanPrefix, one per iteration of the do-while loop. */
const scanQueue: ScanPage[] = [];

/** LLM text replies returned by complete(), one per compactAgent() call. */
const llmQueue: string[] = [];

/** Chunk body store keyed by S3 key; used by readChunk / readChunksSince. */
const chunkStore = new Map<string, string>();

/** commitCompaction calls observed: { slug, expectedMemver }. */
const commitLog: { slug: string; expectedMemver: number }[] = [];

/** When non-null, the next commitCompaction() call throws this error. */
let nextCommitError: Error | null = null;

/** CloudWatch PutMetricData payloads captured. */
const cwBatches: {
  Namespace: string;
  MetricData: { MetricName: string; Value: number }[];
}[] = [];

/** recordSpend calls observed. */
const spendLog: { slug: string; cost_usd: number }[] = [];

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock("../shared/ddb.js", () => ({
  scanPrefix: async () => {
    const page = scanQueue.shift();
    return page ?? { items: [] };
  },
}));

// Mock memory.js without importOriginal so the real module (and its
// top-level env-var guard) is never executed.
vi.mock("../shared/memory.js", () => ({
  readChunk: async (key: string) => {
    const val = chunkStore.get(key);
    if (!val) throw new Error(`no chunk at s3://${key}`);
    return val;
  },
  readChunksSince: async (slug: string, from: number, to: number) => {
    const chunks: string[] = [];
    for (let v = from + 1; v <= to; v++) {
      const key = `memory/${slug}/v${String(v).padStart(4, "0")}.md`;
      const val = chunkStore.get(key);
      if (val) chunks.push(val);
    }
    return chunks;
  },
  commitCompaction: async (
    slug: string,
    _body: string,
    _snippet: string,
    expectedMemver: number,
  ) => {
    if (nextCommitError) {
      const err = nextCommitError;
      nextCommitError = null;
      throw err;
    }
    const newMemver = expectedMemver + 1;
    commitLog.push({ slug, expectedMemver });
    return {
      newKey: `memory/${slug}/v${String(newMemver).padStart(4, "0")}.md`,
      newMemver,
    };
  },
}));

vi.mock("../shared/llm-anthropic.js", () => ({
  complete: async () => {
    const text =
      llmQueue.shift() ??
      "## Identity-laminated facts\n- placeholder identity.\n\n## Recent\n- done.";
    return { text, tokens_in: 100, tokens_out: 50, cost_usd: 0.001 };
  },
}));

vi.mock("../shared/budget.js", () => ({
  recordSpend: async (slug: string, _ti: number, _to: number, cost_usd: number) => {
    spendLog.push({ slug, cost_usd });
  },
}));

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    async send(cmd: {
      input: {
        Namespace: string;
        MetricData: { MetricName: string; Value: number }[];
      };
    }) {
      cwBatches.push(cmd.input);
    }
  },
  PutMetricDataCommand: class {
    input: {
      Namespace: string;
      MetricData: { MetricName: string; Value: number }[];
    };
    constructor(input: {
      Namespace: string;
      MetricData: { MetricName: string; Value: number }[];
    }) {
      this.input = input;
    }
  },
}));

const { handler } = await import("./handler.js");

// ── Test helpers ───────────────────────────────────────────────────────────

function memoryIndex(
  slug: string,
  memver: number,
  lastCompacted = 0,
  latestSummaryKey?: string,
): MemoryIndex {
  return {
    pk: `AGENT#${slug}`,
    sk: "MEMORY#INDEX",
    memver,
    latest_chunk_key: `memory/${slug}/v${String(memver).padStart(4, "0")}.md`,
    summary_snippet: "prior snippet",
    updated_at: "2026-01-01T00:00:00Z",
    last_compacted_memver: lastCompacted,
    latest_summary_key: latestSummaryKey,
  };
}

beforeEach(() => {
  scanQueue.length = 0;
  llmQueue.length = 0;
  chunkStore.clear();
  commitLog.length = 0;
  cwBatches.length = 0;
  spendLog.length = 0;
  nextCommitError = null;
});

afterEach(() => vi.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("memory-compactor handler", () => {
  it("skips agents whose chunk count is below the compaction threshold", async () => {
    scanQueue.push({
      items: [memoryIndex("elena", COMPACTION_THRESHOLD - 1, 0)],
    });

    const res = await handler();

    expect(res.scanned).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.compacted).toBe(0);
    expect(res.errors).toHaveLength(0);
    expect(commitLog).toHaveLength(0);
  });

  it("compacts an agent at the threshold — memver increments monotonically", async () => {
    const memver = COMPACTION_THRESHOLD;
    scanQueue.push({ items: [memoryIndex("elena", memver, 0)] });
    // Seed run chunks so readChunksSince returns non-empty content.
    for (let v = 1; v <= memver; v++) {
      chunkStore.set(
        `memory/elena/v${String(v).padStart(4, "0")}.md`,
        `run ${v} produced output`,
      );
    }
    llmQueue.push(
      "## Identity-laminated facts\n- Elena is an editor.\n\n## Recent\n- 10 articles shipped.",
    );

    const res = await handler();

    expect(res.compacted).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.errors).toHaveLength(0);
    // memver monotonicity: commit records the current memver so the
    // conditional DDB write will advance it to memver + 1.
    expect(commitLog).toHaveLength(1);
    expect(commitLog[0]).toEqual({ slug: "elena", expectedMemver: memver });
    expect(spendLog[0]!.slug).toBe("elena");
  });

  it("isolates identity-loss to the failing agent — sweep continues", async () => {
    // sora's prior summary has a named identity fact.
    const priorSummary =
      "## Identity-laminated facts\n- I am Sora, a content researcher.\n\n## Recent\n- old.";
    chunkStore.set("memory/sora/v0000.md", priorSummary);
    const soraIdx: MemoryIndex = {
      ...memoryIndex("sora", COMPACTION_THRESHOLD, 0, "memory/sora/v0000.md"),
      last_compacted_memver: 0,
    };
    const renIdx = memoryIndex("ren", COMPACTION_THRESHOLD, 0);

    scanQueue.push({ items: [soraIdx, renIdx] });
    // sora: LLM drops the identity fact — triggers IdentityLossError.
    llmQueue.push("## Recent deliverables\n- published 10 articles.");
    // ren: valid summary that includes its identity fact.
    llmQueue.push(
      "## Identity-laminated facts\n- Ren is an engineer.\n\n## Recent\n- PR merged.",
    );

    const res = await handler();

    expect(res.scanned).toBe(2);
    expect(res.identity_loss).toBe(1); // sora failed identity check
    expect(res.compacted).toBe(1);     // ren succeeded
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.slug).toBe("sora");
    // Commit must only have fired for ren, never for sora.
    expect(commitLog).toHaveLength(1);
    expect(commitLog[0]!.slug).toBe("ren");
  });

  it("isolates a non-identity error (commitCompaction throws) per agent", async () => {
    scanQueue.push({ items: [memoryIndex("maya", COMPACTION_THRESHOLD, 0)] });
    llmQueue.push(
      "## Identity-laminated facts\n- Maya is a PM.\n\n## Recent\n- epic filed.",
    );
    nextCommitError = new Error("ConditionalCheckFailedException");

    const res = await handler();

    expect(res.compacted).toBe(0);
    expect(res.identity_loss).toBe(0); // not an identity error
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.slug).toBe("maya");
    expect(res.errors[0]!.message).toMatch(/ConditionalCheck/);
  });

  it("drains multiple scan pages (memver monotonic across pagination)", async () => {
    scanQueue.push({
      items: [memoryIndex("elena", COMPACTION_THRESHOLD, 0)],
      cursor: "page1",
    });
    scanQueue.push({
      items: [memoryIndex("ren", COMPACTION_THRESHOLD, 0)],
    });
    llmQueue.push("## Identity-laminated facts\n- Elena.");
    llmQueue.push("## Identity-laminated facts\n- Ren.");

    const res = await handler();

    expect(res.scanned).toBe(2);
    expect(res.compacted).toBe(2);
    // Each agent commits with its own expected memver.
    const bySlug = new Map(commitLog.map((c) => [c.slug, c.expectedMemver]));
    expect(bySlug.get("elena")).toBe(COMPACTION_THRESHOLD);
    expect(bySlug.get("ren")).toBe(COMPACTION_THRESHOLD);
  });

  it("emits Workforce/Memory metrics with correct counts after a mixed sweep", async () => {
    // One compactable, one below threshold.
    scanQueue.push({
      items: [
        memoryIndex("elena", COMPACTION_THRESHOLD, 0),
        memoryIndex("below", COMPACTION_THRESHOLD - 1, 0),
      ],
    });
    llmQueue.push("## Identity-laminated facts\n- Elena.");

    await handler();

    expect(cwBatches).toHaveLength(1);
    const batch = cwBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/Memory");
    const by = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(by.get("WfMemoryCompacted")).toBe(1);
    expect(by.get("WfMemoryCompactionIdentityLoss")).toBe(0);
    expect(by.get("WfMemoryCompactionErrors")).toBe(0);
  });
});
