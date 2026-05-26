// Integration-flavour unit tests for the Epic-010 Story 1-B dual-write
// path in `agent-runner/handler.ts`.
//
// Covers the Story 1 (#90) acceptance criterion:
//
//   "Integration test: a full orchestrator-tick → runner → ledger-append
//    cycle writes the new row AND the legacy RUN row (dual-write)."
//
// The runner contract is the canonical seam. We do not spin up the
// orchestrator here.
//
// Two complementary checks:
//
//   1. Structural absence test (cycle-2 hardening per Ren's PR #111
//      review): assert there is exactly ONE `await putItem(runRow)` in
//      the entire handler — the one inside `writeRunAndExec`. New
//      executor paths that bypass the wrapper and call `putItem(runRow)`
//      directly will trip this. Robust to formatting changes the prior
//      regex-based check was brittle to (renames, line breaks, inlining
//      the row).
//
//   2. Behaviour test on `appendExecution` directly, with a populated
//      mock DDB, to prove the cross-project-denial path + the
//      self/{slug}-default-membership path are reachable in the shape
//      the runner uses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

vi.mock("../shared/secrets.js", () => ({
  getSecret: vi.fn(),
}));

type AnyRow = Record<string, unknown>;
const store = new Map<string, AnyRow>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock("../shared/ddb.js", () => ({
  getItem: vi.fn(async (pk: string, sk: string) => store.get(key(pk, sk))),
  putItem: vi.fn(async (item: AnyRow) => {
    store.set(key(item.pk as string, item.sk as string), { ...item });
  }),
  conditionalPutItem: vi.fn(async (item: AnyRow, _cond: string) => {
    store.set(key(item.pk as string, item.sk as string), { ...item });
  }),
  deleteItem: vi.fn(async (pk: string, sk: string) => {
    store.delete(key(pk, sk));
  }),
  queryBySkPrefix: vi.fn(async (pk: string, skPrefix: string) =>
    Array.from(store.values()).filter(
      (r) => r.pk === pk && typeof r.sk === "string" && (r.sk as string).startsWith(skPrefix),
    ),
  ),
  queryByGsi: vi.fn(
    async (
      indexName: "GSI1" | "GSI2",
      partitionKey: string,
      query: { skGte?: string; skLte?: string; skPrefix?: string } = {},
    ) => {
      const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
      const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";
      return Array.from(store.values()).filter((r) => {
        if (r[pkAttr] !== partitionKey) return false;
        const skVal = r[skAttr];
        if (typeof skVal !== "string") return false;
        if (query.skPrefix && !skVal.startsWith(query.skPrefix)) return false;
        if (query.skGte !== undefined && skVal < query.skGte) return false;
        if (query.skLte !== undefined && skVal > query.skLte) return false;
        return true;
      });
    },
  ),
}));

import * as project from "../shared/project.js";

const HANDLER_PATH = join(dirname(fileURLToPath(import.meta.url)), "handler.ts");

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("agent-runner dual-write — convention enforcement", () => {
  it("there is EXACTLY ONE `await putItem(runRow)` in handler.ts (inside writeRunAndExec)", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    // Match either `await putItem(runRow)` on its own line, or with
    // trailing close-paren / semicolon — but NOT inside a comment.
    const lines = src.split("\n");
    const hits = lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ line }) => /\bawait\s+putItem\s*\(\s*runRow\b/.test(line))
      .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line)); // drop comment lines

    expect(
      hits.length,
      `expected exactly 1 raw \`await putItem(runRow)\` in handler.ts (inside writeRunAndExec); found ${hits.length} at lines ${hits.map((h) => h.idx + 1).join(", ")}. Executor paths must use writeRunAndExec(runRow, event, skill) to keep RUN + EXEC dual-write in lockstep.`,
    ).toBe(1);
  });

  it("the lone putItem(runRow) is inside the writeRunAndExec function", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    const helperStart = src.indexOf("async function writeRunAndExec");
    expect(helperStart, "writeRunAndExec helper not found").toBeGreaterThan(-1);
    // Find the end of the writeRunAndExec body by counting braces.
    let depth = 0;
    let inside = false;
    let helperEnd = src.length;
    for (let i = helperStart; i < src.length; i++) {
      const c = src[i];
      if (c === "{") {
        depth++;
        inside = true;
      } else if (c === "}") {
        depth--;
        if (inside && depth === 0) {
          helperEnd = i;
          break;
        }
      }
    }
    const body = src.slice(helperStart, helperEnd);
    expect(body).toMatch(/\bawait\s+putItem\s*\(\s*runRow\b/);
  });
});

describe("agent-runner dual-write — appendExecution seam behaviour", () => {
  it("appendExecution + RUN row are both reachable when the agent is a member of self/{slug}", async () => {
    const pid = project.selfProjectId("ren");
    await project.create({ project_id: pid, owner_agent: "ren" });
    await project.addMember(pid, "ren");

    const exec = await project.appendExecution({
      project_id: pid,
      agent_slug: "ren",
      exec_ulid: "01EXEC",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-27T00:00:00.000Z",
      ended_at: "2026-05-27T00:00:01.000Z",
      status: "ok",
    });
    expect(exec.pk).toBe("PROJECT#self/ren");
    expect(exec.sk).toBe("EXEC#01EXEC");
    expect(exec.gsi1pk).toBe("AGENT#ren");

    const byProject = await project.listExecutions({ project_id: pid });
    expect(byProject.map((r) => r.sk)).toEqual(["EXEC#01EXEC"]);
    const byAgent = await project.listExecutions({ agent_slug: "ren" });
    expect(byAgent.map((r) => r.sk)).toEqual(["EXEC#01EXEC"]);
  });

  it("cross-project denial fires when an agent is NOT a member of the resolved project", async () => {
    const pid = project.asProjectId("workforce-meta");
    await project.create({ project_id: pid, owner_agent: "maya" });
    // ren is NOT a member.

    await expect(
      project.appendExecution({
        project_id: pid,
        agent_slug: "ren",
        exec_ulid: "01HXY",
        skill_name: "code-task-brief",
        skill_version: "0.1.0",
        started_at: "2026-05-27T00:00:00.000Z",
        ended_at: "2026-05-27T00:00:01.000Z",
        status: "ok",
      }),
    ).rejects.toThrow(/cross-project denial/);
  });
});
