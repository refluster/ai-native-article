// Per-project knowledge-backup configuration.
//
// The workforce already models a Project as the trust boundary for
// credentials and artefacts (Epic-010 §3): one directory under
// workforce/projects/{id}/ holding project.json. A Discord guild and a Notion
// workspace belong to a *community*, and a community is a project — so the
// backup's store repo and its sources are per-project too, not one global
// destination.
//
// This config is a SIBLING file, `workforce/projects/{id}/knowledge-backup.json`,
// rather than a new block inside project.json. project.json is the creation-time
// seed for the DDB `PROJECT#{id}/META` row (its schema says so, and
// seed-projects.mjs writes from it); a GitHub-Actions-only concern has no
// business travelling into that row and out to the console. Same directory =
// same trust boundary, without the coupling.
//
// Credentials are NOT named in the file. They are derived from the project id
// by one documented convention, so there is a single rule to audit rather than
// N author-chosen strings — and so a config file never hints at where
// credential material lives.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECTS_DIR = join(HERE, "..", "..", "..", "projects");

const CONFIG_BASENAME = "knowledge-backup.json";
const ID = /^[a-z][a-z0-9-]*$/;
const GH_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const GH_REPO = /^[A-Za-z0-9._-]+$/;
const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

/**
 * Secret/env names for a project, by convention:
 *   KB_{PROJECT}_STORE_TOKEN     PAT with contents:write on the store repo
 *   KB_{PROJECT}_DISCORD_BOT_TOKEN
 *   KB_{PROJECT}_NOTION_API_KEY
 * where {PROJECT} is the id upper-cased with `-` replaced by `_`.
 */
export function envNames(projectId) {
  const slug = projectId.toUpperCase().replace(/-/g, "_");
  return {
    storeToken: `KB_${slug}_STORE_TOKEN`,
    discordBotToken: `KB_${slug}_DISCORD_BOT_TOKEN`,
    notionApiKey: `KB_${slug}_NOTION_API_KEY`,
  };
}

class ConfigError extends Error {}

function check(condition, message) {
  if (!condition) throw new ConfigError(message);
}

/**
 * Validate one parsed config. Throws on any structural problem — a
 * misconfigured project must fail loudly at load time (C-4), never silently
 * back up to the wrong repository.
 */
export function validateConfig(config, projectId, where = projectId) {
  check(config && typeof config === "object" && !Array.isArray(config), `${where}: config must be an object`);

  const known = new Set(["project_id", "store", "sources", "status", "note"]);
  for (const key of Object.keys(config)) {
    check(known.has(key), `${where}: unknown property "${key}"`);
  }

  check(config.project_id === projectId, `${where}: project_id "${config.project_id}" must equal the parent directory name "${projectId}"`);

  const store = config.store;
  check(store && typeof store === "object", `${where}: "store" is required`);
  for (const key of Object.keys(store)) {
    check(["owner", "repo", "branch"].includes(key), `${where}: unknown store property "${key}"`);
  }
  check(GH_OWNER.test(store.owner ?? ""), `${where}: store.owner "${store.owner}" is not a GitHub owner`);
  check(GH_REPO.test(store.repo ?? ""), `${where}: store.repo "${store.repo}" is not a GitHub repo name`);
  check(store.branch === undefined || (typeof store.branch === "string" && store.branch.length > 0), `${where}: store.branch must be a non-empty string when present`);

  const sources = config.sources;
  check(sources && typeof sources === "object", `${where}: "sources" is required`);
  for (const key of Object.keys(sources)) {
    check(["discord", "notion"].includes(key), `${where}: unknown source "${key}"`);
  }
  check(Object.keys(sources).length > 0, `${where}: at least one source must be declared, else the config does nothing`);

  if (sources.discord !== undefined) {
    const d = sources.discord;
    check(d && typeof d === "object", `${where}: sources.discord must be an object`);
    for (const key of Object.keys(d)) {
      check(key === "server_id", `${where}: unknown sources.discord property "${key}"`);
    }
    check(DISCORD_SNOWFLAKE.test(d.server_id ?? ""), `${where}: sources.discord.server_id "${d.server_id}" is not a Discord snowflake`);
  }

  if (sources.notion !== undefined) {
    check(sources.notion && typeof sources.notion === "object", `${where}: sources.notion must be an object`);
    // Notion has no non-secret scope selector: the integration token IS the
    // scope (it sees exactly the pages shared with it). So the object is
    // deliberately empty — presence alone enables the source.
    for (const key of Object.keys(sources.notion)) {
      check(false, `${where}: unknown sources.notion property "${key}"`);
    }
  }

  check(config.status === undefined || ["active", "paused"].includes(config.status), `${where}: status must be "active" or "paused"`);

  return config;
}

/** Fully-resolved config: parsed file + derived branch, env names, enabled sources. */
function resolve(config, projectId) {
  return {
    projectId,
    store: {
      repo: `${config.store.owner}/${config.store.repo}`,
      branch: config.store.branch ?? "main",
    },
    discord: config.sources.discord ?? null,
    notion: config.sources.notion ?? null,
    status: config.status ?? "active",
    env: envNames(projectId),
  };
}

/**
 * Load one project's config. Throws if the project has none — a caller that
 * named a project explicitly meant it.
 */
export function loadProject(projectId, projectsDir = PROJECTS_DIR) {
  check(ID.test(projectId), `"${projectId}" is not a project id`);
  const file = join(projectsDir, projectId, CONFIG_BASENAME);
  if (!existsSync(file)) {
    throw new ConfigError(`project "${projectId}" has no ${CONFIG_BASENAME} (looked in ${file})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`${projectId}/${CONFIG_BASENAME}: not valid JSON — ${err.message}`);
  }
  validateConfig(parsed, projectId, `${projectId}/${CONFIG_BASENAME}`);
  return resolve(parsed, projectId);
}

/**
 * Every project that declares a knowledge backup, in directory order.
 * Projects without the file are not backed up — absence is the opt-out.
 */
export function loadAllProjects(projectsDir = PROJECTS_DIR) {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir)
    .filter((name) => statSync(join(projectsDir, name)).isDirectory())
    .filter((name) => existsSync(join(projectsDir, name, CONFIG_BASENAME)))
    .sort()
    .map((name) => loadProject(name, projectsDir));
}
