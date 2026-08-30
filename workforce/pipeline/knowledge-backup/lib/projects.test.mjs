import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  envNames,
  validateConfig,
  loadProject,
  loadAllProjects,
  PROJECTS_DIR,
} from "./projects.mjs";
import { buildMatrix } from "../plan.mjs";

const GUILD = "123456789012345678";

const valid = (over = {}) => ({
  project_id: "luckyhat",
  store: { owner: "refluster", repo: "knowledge-store-luckyhat" },
  sources: { discord: { server_id: GUILD } },
  ...over,
});

function withProjects(files) {
  const dir = mkdtempSync(join(tmpdir(), "kb-projects-"));
  for (const [project, config] of Object.entries(files)) {
    mkdirSync(join(dir, project), { recursive: true });
    if (config !== null) {
      writeFileSync(
        join(dir, project, "knowledge-backup.json"),
        typeof config === "string" ? config : JSON.stringify(config),
      );
    }
  }
  return dir;
}

test("secret names derive from the project id by one convention", () => {
  assert.deepEqual(envNames("luckyhat"), {
    storeToken: "KB_LUCKYHAT_STORE_TOKEN",
    discordBotToken: "KB_LUCKYHAT_DISCORD_BOT_TOKEN",
    notionApiKey: "KB_LUCKYHAT_NOTION_API_KEY",
  });
  // Hyphens are not legal in an env name.
  assert.equal(envNames("agent-workforce").storeToken, "KB_AGENT_WORKFORCE_STORE_TOKEN");
});

test("a well-formed config validates", () => {
  assert.doesNotThrow(() => validateConfig(valid(), "luckyhat"));
  assert.doesNotThrow(() =>
    validateConfig(valid({ sources: { notion: {} }, status: "paused", note: "why" }), "luckyhat"),
  );
});

test("project_id must match the directory — the mismatch that would back up to the wrong store", () => {
  assert.throws(
    () => validateConfig(valid({ project_id: "conference" }), "luckyhat"),
    /must equal the parent directory name/,
  );
});

test("a malformed store is rejected rather than defaulted", () => {
  assert.throws(() => validateConfig(valid({ store: undefined }), "luckyhat"), /"store" is required/);
  assert.throws(
    () => validateConfig(valid({ store: { owner: "bad owner", repo: "r" } }), "luckyhat"),
    /is not a GitHub owner/,
  );
  assert.throws(
    () => validateConfig(valid({ store: { owner: "o", repo: "r", oops: 1 } }), "luckyhat"),
    /unknown store property "oops"/,
  );
});

test("a config with no source does nothing and is rejected", () => {
  assert.throws(() => validateConfig(valid({ sources: {} }), "luckyhat"), /at least one source/);
  assert.throws(
    () => validateConfig(valid({ sources: { slack: {} } }), "luckyhat"),
    /unknown source "slack"/,
  );
});

test("a Discord server id must be a snowflake, not a name or a typo", () => {
  assert.throws(
    () => validateConfig(valid({ sources: { discord: { server_id: "my-server" } } }), "luckyhat"),
    /is not a Discord snowflake/,
  );
  assert.throws(
    () => validateConfig(valid({ sources: { discord: {} } }), "luckyhat"),
    /is not a Discord snowflake/,
  );
});

test("unknown top-level keys are rejected — a typo must not silently disable a source", () => {
  assert.throws(() => validateConfig(valid({ sourcs: {} }), "luckyhat"), /unknown property "sourcs"/);
  assert.throws(() => validateConfig(valid({ status: "archived" }), "luckyhat"), /status must be/);
});

test("loadProject resolves the store, the branch default and the env names", () => {
  const dir = withProjects({ luckyhat: valid() });
  try {
    const project = loadProject("luckyhat", dir);
    assert.equal(project.store.repo, "refluster/knowledge-store-luckyhat");
    assert.equal(project.store.branch, "main");
    assert.equal(project.status, "active");
    assert.deepEqual(project.discord, { server_id: GUILD });
    assert.equal(project.notion, null);
    assert.equal(project.env.storeToken, "KB_LUCKYHAT_STORE_TOKEN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit branch overrides the default", () => {
  const dir = withProjects({
    luckyhat: valid({ store: { owner: "o", repo: "r", branch: "archive" } }),
  });
  try {
    assert.equal(loadProject("luckyhat", dir).store.branch, "archive");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("naming a project that has no config is an error, not a silent skip", () => {
  const dir = withProjects({ conference: null });
  try {
    assert.throws(() => loadProject("conference", dir), /has no knowledge-backup\.json/);
    assert.throws(() => loadProject("nope", dir), /has no knowledge-backup\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid JSON fails loud with the file named", () => {
  const dir = withProjects({ luckyhat: "{ not json" });
  try {
    assert.throws(() => loadProject("luckyhat", dir), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadAllProjects picks up only the projects that opt in, sorted", () => {
  const dir = withProjects({
    zeta: valid({ project_id: "zeta" }),
    conference: null, // opted out — no file
    alpha: valid({ project_id: "alpha", sources: { notion: {} } }),
  });
  try {
    assert.deepEqual(
      loadAllProjects(dir).map((p) => p.projectId),
      ["alpha", "zeta"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the matrix is one row per (project × enabled source), carrying secret NAMES only", () => {
  const dir = withProjects({
    luckyhat: valid({ sources: { discord: { server_id: GUILD }, notion: {} } }),
  });
  try {
    const rows = buildMatrix(loadAllProjects(dir));
    assert.deepEqual(rows.map((r) => r.source), ["discord", "notion"]);
    assert.deepEqual(rows[0], {
      project: "luckyhat",
      store: "refluster/knowledge-store-luckyhat",
      branch: "main",
      store_token_secret: "KB_LUCKYHAT_STORE_TOKEN",
      source: "discord",
      source_secret: "KB_LUCKYHAT_DISCORD_BOT_TOKEN",
    });
    // No row may carry anything that looks like a credential value.
    for (const row of rows) {
      for (const value of Object.values(row)) {
        assert.ok(!/^(gh[pous]_|ntn_|secret_)/.test(String(value)), `row leaked a credential: ${value}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a paused project produces no matrix rows", () => {
  const dir = withProjects({ luckyhat: valid({ status: "paused" }) });
  try {
    assert.deepEqual(buildMatrix(loadAllProjects(dir)), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The repo's own configs are validated here rather than in a separate CI step,
// so a malformed one turns `npm run test:scripts` red like any other defect.
test("every knowledge-backup.json checked into workforce/projects/ is valid", () => {
  assert.doesNotThrow(() => loadAllProjects(PROJECTS_DIR));
});
