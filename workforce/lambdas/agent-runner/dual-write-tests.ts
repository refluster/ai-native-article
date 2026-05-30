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
//      the entire handler — the one inside `writeExec`. New
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

describe("agent-runner — Epic-010 C2 cutover (legacy RUN/DELIV writes removed)", () => {
  it("there is ZERO `await putItem(runRow)` in handler.ts success path (C2 cutover removed the dual-write to legacy RUN)", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    const lines = src.split("\n");
    const hits = lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ line }) => /\bawait\s+putItem\s*\(\s*runRow\b/.test(line))
      .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line));
    expect(
      hits.length,
      `expected ZERO \`await putItem(runRow)\` calls in handler.ts post-C2; found ${hits.length} at lines ${hits.map((h) => h.idx + 1).join(", ")}. The Story-1-B dual-write was removed by C2; new executors must use writeExec(...) (EXEC-only).`,
    ).toBe(0);
  });

  it("there is ZERO `await putItem(delivRow)` in handler.ts (C2 cutover removed the legacy DELIV write)", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    const lines = src.split("\n");
    const hits = lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ line }) => /\bawait\s+putItem\s*\(\s*delivRow\b/.test(line))
      .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line));
    expect(
      hits.length,
      `expected ZERO \`await putItem(delivRow)\` calls in handler.ts post-C2; found ${hits.length} at lines ${hits.map((h) => h.idx + 1).join(", ")}. DELIV writes were removed by C2; deliverable deeplinks (notion_page_url / pr_url) will be re-promoted onto EXEC via FU-NEW-G.`,
    ).toBe(0);
  });

  it("writeExec calls appendExecution (EXEC-only post-C2)", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    const helperStart = src.indexOf("async function writeExec");
    expect(helperStart, "writeExec helper not found").toBeGreaterThan(-1);
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
    // Body must dispatch into dualWriteExec (the EXEC writer wrapper).
    // It must NOT contain a raw putItem(runRow) call any more.
    expect(body).toMatch(/\bawait\s+dualWriteExec\s*\(/);
    expect(body).not.toMatch(/\bawait\s+putItem\s*\(\s*runRow\b/);
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

// --- Story 3 (#92) ------------------------------------------------------
//
// AC 3 (failed_artefact_redaction EXEC row) and AC 5 (PutObject ordered
// before the EXEC insert) live at the runner integration layer. The
// helper-level redaction + write-order tests are in
// shared/artefact-writer-tests.ts; here we assert the wire-up in
// agent-runner/handler.ts.
//
// Approach for AC 5: structural source-grep that each call-site does
// `writeProjectArtefactForRun(...)` BEFORE `writeExec(...)`. This
// matches the dual-write-convention style above (structural absence test
// on `putItem(runRow)`) — robust to formatting changes, doesn't require
// fully spinning up the executor switch with all its dependencies.
//
// Approach for AC 3: behaviour test directly on appendExecution to
// confirm `status: "failed_artefact_redaction"` round-trips through the
// project ledger row shape. The runner's recordFailedRedactionExec
// helper produces exactly this row.

describe("agent-runner artefact write order (Story 3 / #92 AC 5)", () => {
  it("every writeExec call is preceded by a writeProjectArtefactForRun call in the same executor", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    // Find each `await writeExec(...)` call and walk backwards to
    // the previous `await writeProjectArtefactForRun(...)`. Both must
    // appear in the same executor function body. The simplest robust
    // check: the count of writeProjectArtefactForRun callsites equals
    // the count of writeExec callsites that carry an artifactRef
    // (4-arg form).
    const projectWrites = src.match(/\bawait\s+writeProjectArtefactForRun\s*\(/g) ?? [];
    const runExecCalls = src.match(/\bawait\s+writeExec\s*\(/g) ?? [];
    expect(projectWrites.length, "expected three project-artefact writes (one per executor path)").toBe(3);
    expect(runExecCalls.length, "expected three writeExec callsites (one per executor path)").toBe(3);

    // For each writeExec, the index of the preceding
    // writeProjectArtefactForRun must be less. Use string-index search.
    let cursor = 0;
    for (let i = 0; i < runExecCalls.length; i++) {
      const runIdx = src.indexOf("await writeExec", cursor);
      const projIdx = src.lastIndexOf("await writeProjectArtefactForRun", runIdx);
      expect(projIdx, `writeProjectArtefactForRun must precede writeExec #${i + 1}`).toBeGreaterThan(-1);
      expect(projIdx).toBeLessThan(runIdx);
      cursor = runIdx + 1;
    }
  });

  it("the writeProjectArtefactForRun helper calls writeProjectArtefact BEFORE returning so PutObject happens before the EXEC insert", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    const helperStart = src.indexOf("async function writeProjectArtefactForRun");
    expect(helperStart, "writeProjectArtefactForRun helper not found").toBeGreaterThan(-1);
    // The helper body must contain the PutObject call (via
    // writeProjectArtefact). We use brace-walking to bound the helper
    // body and then assert the marker, matching the existing
    // putItem(runRow) check style above.
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
    expect(body).toMatch(/await\s+writeProjectArtefact\s*\(/);
  });
});

describe("agent-runner failed-redaction EXEC row (Story 3 / #92 AC 3)", () => {
  it("appendExecution accepts status=failed_artefact_redaction and round-trips it through the project ledger", async () => {
    const pid = project.selfProjectId("ren");
    await project.create({ project_id: pid, owner_agent: "ren" });
    await project.addMember(pid, "ren");

    const exec = await project.appendExecution({
      project_id: pid,
      agent_slug: "ren",
      exec_ulid: "01REDACTED",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-27T00:00:00.000Z",
      ended_at: "2026-05-27T00:00:01.000Z",
      status: "failed_artefact_redaction",
      error: "failed_artefact_redaction: github_pat pattern matched",
    });
    expect(exec.status).toBe("failed_artefact_redaction");
    expect(exec.error).toContain("github_pat");
    // EXEC row has NO artifact_ref — the artefact was never written.
    expect(exec.artifact_ref).toBeUndefined();

    const fromLedger = await project.listExecutions({ project_id: pid });
    expect(fromLedger).toHaveLength(1);
    expect(fromLedger[0]!.status).toBe("failed_artefact_redaction");
  });

  it("the runner's failed-redaction helper is wired through the writeProjectArtefactForRun catch branch", async () => {
    const src = await readFile(HANDLER_PATH, "utf8");
    // Defence-in-depth structural check: the catch in
    // writeProjectArtefactForRun calls recordFailedRedactionExec on a
    // RedactionViolation. A refactor that drops this branch silently
    // would re-introduce the "silent drop" the AC explicitly forbids.
    expect(src).toMatch(/if\s*\(\s*err\s+instanceof\s+RedactionViolation\s*\)/);
    expect(src).toMatch(/recordFailedRedactionExec\s*\(/);
    expect(src).toMatch(/status:\s*"failed_artefact_redaction"/);
  });
});
