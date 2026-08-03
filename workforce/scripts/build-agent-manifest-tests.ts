// Guard tests for `build-agent-manifest.mjs --check-skills` (issue #185).
//
// Each case names the bug it would catch. Every one runs against a FIXTURE
// skills tree via --skills-dir/--manifest, so nothing here depends on the real
// workforce/skills/ contents (a test that goes red when someone adds a skill
// is a tripwire, not a guard). The script is driven as a child process because
// that is the interface CI actually invokes; it also keeps the module's
// top-level agents-api fetch out of the test process.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "build-agent-manifest.mjs");

const META = (name: string, version = "0.1.0") =>
  JSON.stringify({
    name,
    version,
    status: "active",
    cost_class: "small",
    owners: ["ren"],
    improvement_agent: null,
    created_at: "2026-08-01",
  });

const SKILL_MD = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n\nBody.\n`;

/** A fixture skills tree; returns its path. */
function skillsTree(skills: Array<{ name: string; version?: string; description?: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "wf-skills-"));
  for (const s of skills) {
    const dir = join(root, s.name);
    mkdirSync(dir);
    writeFileSync(join(dir, "meta.json"), META(s.name, s.version));
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD(s.name, s.description ?? "does a thing"));
  }
  return root;
}

/** Build the manifest the way the write path does, so the fixtures agree with
 *  the real emitter rather than with a hand-rolled copy of its shape. */
function manifestFor(skillsDir: string): string {
  const out = join(mkdtempSync(join(tmpdir(), "wf-manifest-")), "workforce-skills.json");
  const r = spawnSync("node", [SCRIPT, "--emit-skills", "--skills-dir", skillsDir, "--manifest", out], {
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return out;
}

function check(skillsDir: string, manifest: string) {
  return spawnSync("node", [SCRIPT, "--check-skills", "--skills-dir", skillsDir, "--manifest", manifest], {
    encoding: "utf8",
  });
}

describe("build-agent-manifest.mjs --check-skills", () => {
  it("passes when the manifest matches the skills tree", () => {
    // Would catch: a check that can never go green, i.e. one comparing the
    // `generated_at` stamp, which differs on every run by construction.
    const tree = skillsTree([{ name: "alpha" }, { name: "beta" }]);
    const manifest = manifestFor(tree);
    const r = check(tree, manifest);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("OK (2 skill(s)");
  });

  it("fails and names the skill when one is added without regenerating", () => {
    // Would catch: the #185 symptom itself — discord-heartbeat shipped in the
    // tree, absent from the committed manifest, so the SPA under-reports.
    const before = skillsTree([{ name: "alpha" }]);
    const manifest = manifestFor(before);
    const after = skillsTree([{ name: "alpha" }, { name: "gamma" }]);
    const r = check(after, manifest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is stale");
    expect(r.stderr).toContain("missing 1 skill(s): gamma");
  });

  it("fails and names the skill when one is removed without regenerating", () => {
    // Would catch: a retired skill still rendering in the SPA directory.
    const before = skillsTree([{ name: "alpha" }, { name: "gamma" }]);
    const manifest = manifestFor(before);
    const after = skillsTree([{ name: "alpha" }]);
    const r = check(after, manifest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("stale 1 skill(s) no longer in workforce/skills/: gamma");
  });

  it("fails when an existing skill's meta.json changes (version bump)", () => {
    // Would catch: the drift class the issue's "stale discord-ping description"
    // names — the skill set is unchanged, only its contents moved, so a
    // set-difference-only check would wave it through.
    const before = skillsTree([{ name: "alpha", version: "0.1.0" }]);
    const manifest = manifestFor(before);
    const after = skillsTree([{ name: "alpha", version: "0.2.0" }]);
    const r = check(after, manifest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("1 skill(s) out of date: alpha");
  });

  it("fails when only the SKILL.md description changes", () => {
    // Would catch: description drift, which lives in SKILL.md frontmatter
    // rather than meta.json — a meta.json-only comparison would miss it.
    const before = skillsTree([{ name: "alpha", description: "old copy" }]);
    const manifest = manifestFor(before);
    const after = skillsTree([{ name: "alpha", description: "new copy" }]);
    const r = check(after, manifest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("1 skill(s) out of date: alpha");
  });

  it("fails loudly when the manifest file is missing entirely", () => {
    // Would catch: a check that treats "no file" as "nothing to compare" and
    // exits 0 — the silent-pass failure C-4 forbids.
    const tree = skillsTree([{ name: "alpha" }]);
    const r = check(tree, join(tmpdir(), "definitely-not-here-workforce-skills.json"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is missing");
  });

  it("fails loudly when the manifest is unparseable", () => {
    // Would catch: a truncated/corrupt manifest being read as an empty set,
    // which would then report every skill as merely "missing" — or, worse,
    // throw an unhandled parse error with no remediation line.
    const tree = skillsTree([{ name: "alpha" }]);
    const bad = join(mkdtempSync(join(tmpdir(), "wf-bad-")), "workforce-skills.json");
    writeFileSync(bad, "{ not json");
    const r = check(tree, bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not readable as JSON");
    expect(r.stderr).toContain("npm run build:agents");
  });

  it("fails loudly when the manifest has no skills array", () => {
    // Would catch: a shape change (e.g. the array renamed) silently reducing
    // the guard to a no-op.
    const tree = skillsTree([{ name: "alpha" }]);
    const bad = join(mkdtempSync(join(tmpdir(), "wf-shape-")), "workforce-skills.json");
    writeFileSync(bad, JSON.stringify({ generated_at: "2026-08-01T00:00:00.000Z" }));
    const r = check(tree, bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no `skills` array");
  });
});
