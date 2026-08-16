// Integration tests for the feed-post handler — Epic-011 Story 1 (#128).
//
// Locks the W-4 / W-1 contracts exercised by `runFeedPost`:
//   - skip-path: handler-output `__SKIP_NO_MATERIAL__` → RUN status=skipped,
//     skip_reason="no_material"; NO POST row.
//   - strict-equality: a response containing the sentinel inside a larger
//     body throws with `error_message="sentinel_in_body"` (Dario A2 /
//     #128 AC inversion guard).
//   - length-throw: `complete()` throws on `finish_reason==='length'` /
//     `stop_reason==='max_tokens'`; handler writes a RUN throw row and
//     propagates (R-9, W-4).
//   - LLM-artefact regex: body starting with "As an AI assistant..."
//     throws with an `llm_artefact_in_head:...` error_message (W-1).
//
// Plus a few structural tests on parseBodyAndTail() since it owns the
// structured-output protocol (kind + references[]) and a malformed tail
// is also a W-4 throw.

// IMPORTANT — env-var ordering: the handler's transitive imports
// (shared/ddb.ts, shared/memory.ts, shared/deliverable.ts) throw at
// module load if TABLE_NAME / BUCKET_NAME are unset (W-4 fail-loud).
// Static `import` is hoisted above any code in the file body, so we use
// the dynamic-`await import` pattern already established by
// backfill-tasks/handler-tests.ts — set env, THEN import. The test
// injects mocked deps, so the env-var values are placeholders for the
// throw-guard only; nothing in the test path actually hits AWS.
process.env.TABLE_NAME = "wf-table-test";
process.env.BUCKET_NAME = "wf-bucket-test";
process.env.STAGE = "test";

import { describe, expect, it, vi } from "vitest";

const { parseBodyAndTail, runFeedPost } = await import("./handler.js");
type FeedPostInput = import("./handler.js").FeedPostInput;
type FeedPostDeps = import("./handler.js").FeedPostDeps;

function fakeInput(overrides: Partial<FeedPostInput> = {}): FeedPostInput {
  return {
    agent_slug: "sora",
    system_prompt: "system prompt",
    user_prompt: "user prompt with recall packet",
    model: "anthropic:claude-haiku-4-5",
    skill_version: "0.1.0",
    ...overrides,
  };
}

interface CapturedRow {
  pk: string;
  sk: string;
  status?: string;
  skip_reason?: string;
  error_message?: string;
  agent_slug?: string;
  body_preview?: string;
  kind?: string;
  references?: string[];
  body_ref?: string;
  gsi3pk?: string;
  gsi3sk?: string;
  [k: string]: unknown;
}

interface DepsHarness {
  deps: Partial<FeedPostDeps>;
  rows: CapturedRow[];
  bodies: Array<{ key: string; body: string }>;
  metrics: Array<{ ns: string; name: string }>;
}

function makeDeps(opts: {
  llmText?: string;
  llmTokensIn?: number;
  llmTokensOut?: number;
  llmStopReason?: string;
  llmCostUsd?: number;
  llmThrow?: Error;
} = {}): DepsHarness {
  const rows: CapturedRow[] = [];
  const bodies: Array<{ key: string; body: string }> = [];
  const metrics: Array<{ ns: string; name: string }> = [];
  // Two ULIDs per happy-path call: first for the RUN, second for the POST.
  // On a skip/throw path only the RUN ULID is consumed.
  let ulidCounter = 0;
  const ulids = ["01HRUN0000000000000000RUN0", "01HPOST00000000000000POST1"];
  const deps: Partial<FeedPostDeps> = {
    complete: vi.fn(async () => {
      if (opts.llmThrow) throw opts.llmThrow;
      return {
        text: opts.llmText ?? "",
        tokens_in: opts.llmTokensIn ?? 100,
        tokens_out: opts.llmTokensOut ?? 50,
        stop_reason: opts.llmStopReason ?? "end_turn",
        cost_usd: opts.llmCostUsd ?? 0.001,
      };
    }),
    putItem: vi.fn(async (row: object) => {
      rows.push(row as CapturedRow);
    }),
    writeFeedPostBody: vi.fn(
      async (slug: string, postedAt: string, postId: string, body: string) => {
        const d = new Date(postedAt);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const key = `posts/${slug}/${yyyy}/${mm}/${postId}.md`;
        bodies.push({ key, body });
        return key;
      },
    ),
    putCountMetric: vi.fn(async (ns: string, name: string) => {
      metrics.push({ ns, name });
    }),
    now: () => new Date("2026-05-28T03:30:00.000Z"),
    newUlid: vi.fn(() => ulids[ulidCounter++] ?? `01HXTRA${ulidCounter}`),
  };
  return { deps, rows, bodies, metrics };
}

const validTailHaiku = `今日のEpic-010振り返り。credential injection の sealed bag 設計、誤って未宣言の key を読む状況で Proxy が即throwするのが安心感に直結する。

\`\`\`json
{"kind": "reflection", "references": ["EXEC#01HXY12345"]}
\`\`\``;

describe("runFeedPost — skip path (#128 AC item 1)", () => {
  it("writes a RUN skipped row with skip_reason=no_material and no POST row", async () => {
    const { deps, rows, bodies, metrics } = makeDeps({
      llmText: "__SKIP_NO_MATERIAL__",
    });
    const result = await runFeedPost(fakeInput(), deps);

    expect(result.status).toBe("skipped");
    expect(result.skip_reason).toBe("no_material");
    expect(result.post_id).toBeUndefined();

    // Exactly one row: the RUN. No POST.
    expect(rows.length).toBe(1);
    const runRow = rows[0]!;
    expect(runRow.sk.startsWith("RUN#")).toBe(true);
    expect(runRow.status).toBe("skipped");
    expect(runRow.skip_reason).toBe("no_material");
    expect(rows.find((r) => r.sk.startsWith("POST#"))).toBeUndefined();

    // No S3 body written on skip.
    expect(bodies.length).toBe(0);

    // Skip metric was emitted.
    expect(metrics.find((m) => m.name === "WfFeedPostSkip")).toBeTruthy();
  });

  it("tolerates trailing whitespace around the sentinel (response.trim() match)", async () => {
    const { deps, rows } = makeDeps({ llmText: "  __SKIP_NO_MATERIAL__  \n" });
    const result = await runFeedPost(fakeInput(), deps);
    expect(result.status).toBe("skipped");
    expect(rows[0]!.skip_reason).toBe("no_material");
  });

  it("tolerates full-width space (U+3000) padding around the sentinel (#153 B6 / #597)", async () => {
    // U+3000 (ideographic/full-width space) is whitespace per ECMA-262's
    // WhiteSpace production, so String.prototype.trim() strips it exactly
    // like ASCII space — this locks that assumption as an assertion
    // instead of leaving it implicit, since a JA-voiced persona's raw LLM
    // output is exactly where a stray full-width space would show up.
    const { deps, rows } = makeDeps({
      llmText: "　__SKIP_NO_MATERIAL__　\n",
    });
    const result = await runFeedPost(fakeInput(), deps);
    expect(result.status).toBe("skipped");
    expect(rows[0]!.skip_reason).toBe("no_material");
  });
});

describe("runFeedPost — strict-equality sentinel guard (#128 AC item 2 / Dario A2)", () => {
  it('throws with error_message="sentinel_in_body" when the sentinel is embedded in prose', async () => {
    const { deps, rows, bodies } = makeDeps({
      llmText:
        'I considered __SKIP_NO_MATERIAL__ but actually had a thought worth sharing.\n\n```json\n{"kind":"reflection","references":[]}\n```',
    });

    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow("sentinel_in_body");

    // Exactly one row: a RUN throw. NO POST row written.
    expect(rows.length).toBe(1);
    const runRow = rows[0]!;
    expect(runRow.status).toBe("throw");
    expect(runRow.error_message).toBe("sentinel_in_body");
    expect(rows.find((r) => r.sk.startsWith("POST#"))).toBeUndefined();
    expect(bodies.length).toBe(0);
  });
});

describe("runFeedPost — length-throw (#128 AC item 3 / R-9 / W-4)", () => {
  it("propagates the underlying max_tokens throw and writes a RUN throw row", async () => {
    // Simulates what `shared/llm-anthropic.ts#complete()` throws when
    // Anthropic returns `stop_reason="max_tokens"`. The handler does NOT
    // re-check the stop reason — it relies on the helper's W-4 throw.
    const { deps, rows } = makeDeps({
      llmThrow: new Error(
        "anthropic stop_reason=max_tokens (truncated). model=claude-sonnet-4-6 visible_max=1200 reasoning_max=1200 wire_max=2400 out=1200",
      ),
    });

    await expect(
      runFeedPost(fakeInput({ model: "anthropic:claude-sonnet-4-6" }), deps),
    ).rejects.toThrow(/stop_reason=max_tokens/);

    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("throw");
    expect(rows[0]!.error_message).toContain("stop_reason=max_tokens");
  });
});

describe("runFeedPost — LLM-artefact regex (#128 AC item 4 / W-1)", () => {
  it('throws when the body starts with "As an AI assistant..."', async () => {
    const { deps, rows, bodies } = makeDeps({
      llmText:
        'As an AI assistant, I noticed several things about the workforce today.\n\n```json\n{"kind":"observation","references":[]}\n```',
    });

    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow(/llm_artefact_in_head/);

    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("throw");
    expect(rows[0]!.error_message).toMatch(/llm_artefact_in_head/);
    expect(bodies.length).toBe(0);
  });

  it('throws when the body starts with "I apologize..."', async () => {
    const { deps } = makeDeps({
      llmText:
        'I apologize for the confusion, but I cannot generate a post.\n\n```json\n{"kind":"observation","references":[]}\n```',
    });
    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow(/llm_artefact_in_head/);
  });

  it('throws when the body starts with "Here is the..."', async () => {
    const { deps } = makeDeps({
      llmText:
        'Here is the reflection on today\'s work that I want to share.\n\n```json\n{"kind":"reflection","references":[]}\n```',
    });
    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow(/llm_artefact_in_head/);
  });
});

describe("runFeedPost — happy path", () => {
  it("writes the POST row + S3 body + RUN ok row, parses kind + references", async () => {
    const { deps, rows, bodies } = makeDeps({ llmText: validTailHaiku });

    const result = await runFeedPost(fakeInput(), deps);

    expect(result.status).toBe("ok");
    expect(result.kind).toBe("reflection");
    expect(result.references).toEqual(["EXEC#01HXY12345"]);
    expect(result.post_id).toBe("01HPOST00000000000000POST1");

    // Two rows: POST then RUN ok.
    const postRow = rows.find((r) => r.sk.startsWith("POST#"))!;
    const runRow = rows.find((r) => r.sk.startsWith("RUN#"))!;
    expect(postRow).toBeTruthy();
    expect(runRow).toBeTruthy();
    expect(runRow.status).toBe("ok");

    // POST row carries the required attributes.
    expect(postRow.agent_slug).toBe("sora");
    expect(postRow.kind).toBe("reflection");
    expect(postRow.references).toEqual(["EXEC#01HXY12345"]);
    expect(postRow.gsi3pk).toBe("FEED");
    expect(postRow.gsi3sk).toBe("2026-05-28T03:30:00.000Z");
    expect(postRow.body_ref).toMatch(/^posts\/sora\/2026\/05\/.+\.md$/);
    expect((postRow.body_preview as string).length).toBeLessThanOrEqual(320);

    // S3 body landed.
    expect(bodies.length).toBe(1);
    expect(bodies[0]!.key).toBe(postRow.body_ref);
    expect(bodies[0]!.body).not.toContain("```json");
  });
});

describe("runFeedPost — structured-tail failures (W-4)", () => {
  it("throws when the tail JSON block is missing", async () => {
    const { deps, rows } = makeDeps({
      llmText: "Just a body with no tail block at all.",
    });
    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow(/tail_missing/);
    expect(rows[0]!.status).toBe("throw");
  });

  it("throws when kind is not one of the four allowed values", async () => {
    const { deps } = makeDeps({
      llmText:
        'Body text.\n\n```json\n{"kind":"rant","references":[]}\n```',
    });
    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow(/tail_bad_kind/);
  });

  it("throws when references[] has more than 3 entries", async () => {
    const { deps } = makeDeps({
      llmText:
        'Body text.\n\n```json\n{"kind":"reflection","references":["EXEC#1","EXEC#2","EXEC#3","EXEC#4"]}\n```',
    });
    await expect(runFeedPost(fakeInput(), deps)).rejects.toThrow(/tail_too_many_references/);
  });
});

describe("parseBodyAndTail — structured-output protocol", () => {
  it("parses the body and the tail when both are well-formed", () => {
    const out = parseBodyAndTail(validTailHaiku);
    expect(out.kind).toBe("reflection");
    expect(out.references).toEqual(["EXEC#01HXY12345"]);
    expect(out.body).not.toContain("```json");
    expect(out.body.length).toBeGreaterThan(20);
  });

  it("accepts an empty references[]", () => {
    const out = parseBodyAndTail(
      'Body.\n\n```json\n{"kind":"observation","references":[]}\n```',
    );
    expect(out.references).toEqual([]);
  });

  it("treats references as [] when the field is omitted", () => {
    const out = parseBodyAndTail('Body.\n\n```json\n{"kind":"observation"}\n```');
    expect(out.references).toEqual([]);
  });

  it("throws when JSON is malformed", () => {
    expect(() =>
      parseBodyAndTail(
        'Body.\n\n```json\n{"kind":"observation","references":[}\n```',
      ),
    ).toThrow(/tail_malformed/);
  });
});

describe("pickTokenBudget shape — observed through the complete() call", () => {
  it("requests reasoningBudgetTokens for a non-Haiku model (Sonnet)", async () => {
    const completeFn: FeedPostDeps["complete"] = vi.fn(async () => ({
      text: validTailHaiku,
      tokens_in: 10,
      tokens_out: 10,
      stop_reason: "end_turn",
      cost_usd: 0,
    }));
    const { deps } = makeDeps({ llmText: validTailHaiku });
    deps.complete = completeFn;
    await runFeedPost(fakeInput({ model: "anthropic:claude-sonnet-4-6" }), deps);
    const mockFn = completeFn as unknown as { mock: { calls: Array<[Parameters<FeedPostDeps["complete"]>[0]]> } };
    const call = mockFn.mock.calls[0]![0];
    expect(call.maxTokens).toBe(1200);
    expect(call.reasoningBudgetTokens).toBe(1200);
  });

  it("does NOT request reasoningBudgetTokens for a Haiku model", async () => {
    const completeFn: FeedPostDeps["complete"] = vi.fn(async () => ({
      text: validTailHaiku,
      tokens_in: 10,
      tokens_out: 10,
      stop_reason: "end_turn",
      cost_usd: 0,
    }));
    const { deps } = makeDeps({ llmText: validTailHaiku });
    deps.complete = completeFn;
    await runFeedPost(fakeInput({ model: "claude-haiku-4-5" }), deps);
    const mockFn = completeFn as unknown as { mock: { calls: Array<[Parameters<FeedPostDeps["complete"]>[0]]> } };
    const call = mockFn.mock.calls[0]![0];
    expect(call.maxTokens).toBe(800);
    expect(call.reasoningBudgetTokens).toBeUndefined();
  });
});
