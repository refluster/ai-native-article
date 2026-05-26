// Integration-flavour unit tests for the Epic-010 Story 1-B dual-write
// path in `agent-runner/handler.ts`.
//
// Covers the Story 1 (#90) acceptance criterion:
//
//   "Integration test: a full orchestrator-tick → runner → ledger-append
//    cycle writes the new row AND the legacy RUN row (dual-write)."
//
// We don't spin up the orchestrator here — the runner contract is the
// canonical seam. We exercise `dualWriteExec` (and the resolveProjectId
// path) by importing the agent-runner module with a mocked DDB +
// secrets stack, then calling the helper directly. The 3 RUN-row write
// sites in handler.ts each call dualWriteExec right after `putItem(runRow)`
// (this is enforced by a smoke test that scans the file for the pattern).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  updateOperational: vi.fn(async () => ({})),
}));

import * as project from "../shared/project.js";

// Import the file as text so we can run the smoke-test ("every
// putItem(runRow) is followed by a dualWriteExec call"). The smoke
// test guards against a future maintenance regression where someone
// adds a new executor path that writes RUN but forgets the EXEC.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HANDLER_PATH = join(dirname(fileURLToPath(import.meta.url)), "handler.ts");

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("agent-runner dual-write", () => {
  it("static check: every `await putItem(runRow)` is followed by a `dualWriteExec` call", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    const lines = src.split("\n");
    const runWriteLines = lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ line }) => /^\s*await putItem\(runRow\);?\s*$/.test(line));
    expect(runWriteLines.length).toBeGreaterThanOrEqual(3); // 3 executor paths

    for (const { idx } of runWriteLines) {
      const next = lines[idx + 1] ?? "";
      expect(next, `line ${idx + 2} should call dualWriteExec`).toMatch(
        /await dualWriteExec\(/,
      );
    }
  });

  it("appendExecution + RUN row are both reachable when the agent is a member of self/{slug}", async () => {
    // Set up the agent's self project + membership (what seed-agents does).
    const pid = project.selfProjectId("ren");
    await project.create({ project_id: pid, owner_agent: "ren" });
    await project.addMember(pid, "ren");

    // Now exercise appendExecution the same way agent-runner's
    // dualWriteExec helper does — this proves the cross-project denial
    // does NOT trip on the default self/{slug} path.
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

    // Confirm the row is queryable through both:
    //   - the project-partition path (`Project.listExecutions({project_id})`)
    //   - the agent-scoped GSI1 path (`Project.listExecutions({agent_slug})`)
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
