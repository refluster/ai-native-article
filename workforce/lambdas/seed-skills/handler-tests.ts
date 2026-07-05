// Unit tests for the ADR-0018 version-gated skill seed (wf-seed-skills).
//
//   - a new skill folder creates its SKILL#{name}/META row
//   - re-seeding the SAME version is a noop (no body/version change)
//   - a git version BUMP syncs the judgment-side fields + appends one AUDIT
//     item, preserving computed/operational row state
//   - a git version OLDER-OR-EQUAL never overwrites the live body (no clobber)
//   - `deliverable` reconciles from git even without a version bump
//
// Pattern: real fs (temp fixture dir behind SKILLS_ROOT) + real skill-audit /
// skill-identity-hash modules, with only shared/ddb.js mocked by an in-memory
// row map (mirrors patch-skill-tests.ts).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

interface AnyRow {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
const rows = new Map<string, AnyRow>();
const rowKey = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock("../shared/ddb.js", () => ({
  getItem: vi.fn(async (pk: string, sk: string) => rows.get(rowKey(pk, sk))),
  putItem: vi.fn(async (item: AnyRow) => {
    rows.set(rowKey(item.pk, item.sk), item);
    return item;
  }),
  queryBySkPrefixPaged: vi.fn(async (pk: string, skPrefix: string) => {
    const items = Array.from(rows.values()).filter(
      (r) => r.pk === pk && r.sk.startsWith(skPrefix),
    );
    return { items, cursor: undefined };
  }),
}));

import { handler, compareSemver } from "./handler.js";

let root: string;

function writeSkill(
  name: string,
  opts: { version: string; description?: string; body: string; deliverable?: unknown },
): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const meta = {
    name,
    version: opts.version,
    status: "active",
    archetype: "cadence",
    cost_class: "medium",
    owners: ["elena"],
    improvement_agent: "sana",
    created_at: "2026-06-01",
    deliverable: opts.deliverable ?? { type: "article", publish_notion: false },
    requires: ["notion.integration_token"],
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  const desc = opts.description ?? `desc for ${name}`;
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n${opts.body}\n`,
  );
}

function metaRow(name: string): AnyRow | undefined {
  return rows.get(rowKey(`SKILL#${name}`, "META"));
}
function auditRows(name: string): AnyRow[] {
  return Array.from(rows.values()).filter(
    (r) => r.pk === `SKILL#${name}` && r.sk.startsWith("AUDIT#"),
  );
}

beforeEach(() => {
  rows.clear();
  root = mkdtempSync(join(tmpdir(), "seed-skills-test-"));
  process.env.SKILLS_ROOT = root;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.SKILLS_ROOT;
});

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("0.3.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.3.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0", "0.2.0")).toBe(0);
  });
  it("fails safe: a malformed version parses as 0.0.0 and never wins", () => {
    expect(compareSemver("garbage", "0.1.0")).toBeLessThan(0);
    expect(compareSemver("0.0.1", "garbage")).toBeGreaterThan(0);
  });
});

describe("wf-seed-skills — version-gated seed (ADR-0018)", () => {
  it("creates a new skill row", async () => {
    writeSkill("alpha", { version: "0.1.0", body: "# alpha\n\nfirst body" });
    const res = await handler();
    expect(res.upserts).toEqual([{ name: "alpha", action: "created" }]);
    const row = metaRow("alpha");
    expect(row?.version).toBe("0.1.0");
    expect(row?.body).toContain("first body");
    expect(row?.invocations_this_month).toBe(0);
    expect(auditRows("alpha")).toHaveLength(0);
  });

  it("re-seeding the same version is a noop and never touches the body", async () => {
    writeSkill("alpha", { version: "0.1.0", body: "# alpha\n\nfirst body" });
    await handler();
    // Simulate a later LIVE API edit that git does not know about.
    metaRow("alpha")!.body = "# alpha\n\nLIVE-EDITED body";
    // Re-seed with the SAME git version but the OLD git body.
    const res = await handler();
    expect(res.upserts).toEqual([{ name: "alpha", action: "noop" }]);
    expect(metaRow("alpha")!.body).toBe("# alpha\n\nLIVE-EDITED body");
    expect(auditRows("alpha")).toHaveLength(0);
  });

  it("syncs judgment fields on a version BUMP and appends one audit item", async () => {
    writeSkill("beta", { version: "0.1.0", body: "# beta\n\nold body" });
    await handler();
    // A later stats aggregator wrote a computed field onto the live row.
    metaRow("beta")!.invocations_this_month = 42;

    // Author a newer body + bumped version in git.
    writeSkill("beta", {
      version: "0.3.0",
      description: "sharper beta",
      body: "# beta\n\nNEW body with the 5-loop",
    });
    const res = await handler();

    expect(res.upserts).toEqual([{ name: "beta", action: "updated" }]);
    const row = metaRow("beta")!;
    expect(row.version).toBe("0.3.0");
    expect(row.body).toContain("5-loop");
    expect(row.description).toBe("sharper beta");
    // computed state preserved across the sync
    expect(row.invocations_this_month).toBe(42);

    const audits = auditRows("beta");
    expect(audits).toHaveLength(1);
    const fields = (audits[0]!.changes as Array<{ field: string }>).map((c) => c.field);
    expect(fields).toContain("body");
    expect(fields).toContain("version");
  });

  it("never overwrites a live body when the git version is not newer", async () => {
    writeSkill("gamma", { version: "0.3.0", body: "# gamma\n\nlive v0.3.0 body" });
    await handler();
    // git regresses to an OLDER version (e.g. a stale bundle) — must not win.
    writeSkill("gamma", { version: "0.2.0", body: "# gamma\n\nstale older body" });
    const res = await handler();
    expect(res.upserts).toEqual([{ name: "gamma", action: "noop" }]);
    expect(metaRow("gamma")!.body).toBe("# gamma\n\nlive v0.3.0 body");
    expect(metaRow("gamma")!.version).toBe("0.3.0");
  });

  it("reconciles deliverable from git even without a version bump", async () => {
    writeSkill("delta", {
      version: "0.1.0",
      body: "# delta\n\nbody",
      deliverable: { type: "article", publish_notion: false },
    });
    await handler();
    metaRow("delta")!.body = "# delta\n\nLIVE body";
    // Same version, but the git-authoritative deliverable changed.
    writeSkill("delta", {
      version: "0.1.0",
      body: "# delta\n\nbody",
      deliverable: { type: "article", publish_notion: true },
    });
    const res = await handler();
    expect(res.upserts).toEqual([{ name: "delta", action: "updated" }]);
    // deliverable reconciled, but the live body is untouched (no version bump).
    expect((metaRow("delta")!.deliverable as { publish_notion: boolean }).publish_notion).toBe(true);
    expect(metaRow("delta")!.body).toBe("# delta\n\nLIVE body");
  });
});
