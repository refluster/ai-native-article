#!/usr/bin/env node
// Validates workforce/tools/*/{tool.json,system.md} against the contract
// in scripts/schemas/tool.schema.json (ADR-0027 §3, Epic-025 Phase 2).
//
// Hand-rolled rather than Ajv-driven, matching validate-projects.mjs and
// validate-skills.mjs — the workforce carries no JSON-schema runtime, and
// the checks worth having are mostly cross-field ones a schema cannot
// express anyway (a `required` naming a field that does not exist; an
// input field the console cannot draw).
//
// Rule ids are T-*, so a CI failure names the rule rather than a line.
//
// Invocation: node workforce/scripts/validate-tools.mjs

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const TOOLS_DIR = join(WORKFORCE_ROOT, "tools");

const violations = [];
const v = (rule, path, msg) => violations.push({ rule, path: relative(REPO_ROOT, path), msg });

const TOOL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// Mirror of credential-injector.ts:CREDENTIAL_TYPES (see that file's
// header for the full mirror-point list — this is a consumer of the set,
// not a ninth mirror: a tool may only require a type that exists).
const CREDENTIAL_TYPES = new Set([
  "anthropic.api_key",
  "azure.openai",
  "discord.bot_token",
  "discord.webhook_url",
  "github.token",
  "notion.integration_token",
  "voyage.api_key",
  "workforce.feed_write_token",
  "workforce.memory_write_token",
  "workforce.dispatch_token",
]);

// What the console's schema-driven form can actually draw. A tool
// declaring anything else would render a field the operator cannot fill,
// so it fails here rather than silently at runtime.
const RENDERABLE_INPUT_TYPES = new Set(["string", "integer", "number", "boolean"]);

function listToolDirs() {
  if (!existsSync(TOOLS_DIR)) return [];
  return readdirSync(TOOLS_DIR)
    .filter((n) => !n.startsWith(".") && statSync(join(TOOLS_DIR, n)).isDirectory())
    .sort();
}

function checkSchemaObject(label, schema, metaPath, { renderable }) {
  if (!schema || typeof schema !== "object") {
    v("T7-schema-shape", metaPath, `${label} must be an object schema`);
    return;
  }
  if (schema.type !== "object") {
    v("T7-schema-shape", metaPath, `${label}.type must be "object" (got ${JSON.stringify(schema.type)})`);
  }
  const props = schema.properties;
  if (!props || typeof props !== "object" || Object.keys(props).length === 0) {
    v("T7-schema-shape", metaPath, `${label}.properties must be a non-empty object`);
    return;
  }
  // A `required` entry with no matching property is the classic schema
  // typo: the model is told to always return a field nobody declared, or
  // the form marks a field the operator cannot see.
  for (const name of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(props, name)) {
      v("T8-required-unknown", metaPath, `${label}.required names "${name}", which is not in ${label}.properties`);
    }
  }
  if (!renderable) return;
  for (const [name, field] of Object.entries(props)) {
    if (!field || typeof field !== "object") {
      v("T9-input-field", metaPath, `input.properties.${name} must be an object`);
      continue;
    }
    if (!RENDERABLE_INPUT_TYPES.has(field.type)) {
      v(
        "T9-input-field",
        metaPath,
        `input.properties.${name}.type="${field.type}" is not renderable by the console form ` +
          `(allowed: ${[...RENDERABLE_INPUT_TYPES].join(", ")})`,
      );
    }
    if (field.enum !== undefined && (!Array.isArray(field.enum) || field.enum.length === 0)) {
      v("T9-input-field", metaPath, `input.properties.${name}.enum must be a non-empty array when present`);
    }
    if (field.default !== undefined && Array.isArray(field.enum) && !field.enum.includes(field.default)) {
      v("T9-input-field", metaPath, `input.properties.${name}.default is not one of its enum values`);
    }
    if (!field.title) {
      v("T10-input-label", metaPath, `input.properties.${name} needs a title — it is the form's field label`);
    }
  }
}

for (const dir of listToolDirs()) {
  const metaPath = join(TOOLS_DIR, dir, "tool.json");
  const promptPath = join(TOOLS_DIR, dir, "system.md");

  if (!existsSync(metaPath)) {
    v("T1-files", metaPath, "tool.json is missing");
    continue;
  }
  if (!existsSync(promptPath)) {
    v("T1-files", promptPath, "system.md is missing — a tool without a prompt cannot run");
  } else if (readFileSync(promptPath, "utf8").trim().length < 100) {
    v("T2-prompt", promptPath, "system.md is under 100 characters — that is a placeholder, not a prompt");
  }

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (err) {
    v("T3-json", metaPath, `not valid JSON: ${err.message}`);
    continue;
  }

  if (meta.tool_id !== dir) {
    v("T4-id", metaPath, `tool_id="${meta.tool_id}" must equal its directory name "${dir}" — the directory is the route segment`);
  }
  if (!TOOL_ID.test(meta.tool_id ?? "")) {
    v("T4-id", metaPath, `tool_id="${meta.tool_id}" must be kebab-case (the console's route pattern)`);
  }
  for (const field of ["display_name", "summary"]) {
    if (typeof meta[field] !== "string" || meta[field].trim().length === 0) {
      v("T5-required", metaPath, `${field} must be a non-empty string`);
    }
  }
  if (typeof meta.summary === "string" && meta.summary.length > 240) {
    v("T5-required", metaPath, `summary is ${meta.summary.length} chars; the index card allows 240`);
  }
  if (!SEMVER.test(meta.version ?? "")) {
    v("T6-version", metaPath, `version="${meta.version}" must be semver — it is recorded on every EXEC row`);
  }

  if (!Array.isArray(meta.requires)) {
    v("T5-required", metaPath, "requires must be an array (use [] for a tool that needs no credentials)");
  } else {
    for (const key of meta.requires) {
      const base = String(key).split("@")[0];
      if (!CREDENTIAL_TYPES.has(base)) {
        v("T11-credential", metaPath, `requires "${key}" — base type "${base}" is not a known credential type`);
      }
    }
    if (new Set(meta.requires).size !== meta.requires.length) {
      v("T11-credential", metaPath, "requires contains duplicates");
    }
  }

  const model = meta.model;
  if (!model || typeof model !== "object") {
    v("T12-model", metaPath, "model must be an object with max_tokens");
  } else {
    if (!Number.isInteger(model.max_tokens) || model.max_tokens < 256 || model.max_tokens > 32000) {
      v("T12-model", metaPath, `model.max_tokens=${model.max_tokens} must be an integer in [256, 32000]`);
    }
    if (model.temperature !== undefined) {
      // Not a range check — the field is forbidden outright. gpt-5.4
      // rejects any non-default temperature with HTTP 400
      // `unsupported_value` (newsletter/docs/azure-budget-rules.md: "do
      // not re-add it"), and a stubbed-fetch test cannot catch it, so the
      // only place this can be caught before a live call is here.
      v(
        "T13-temperature",
        metaPath,
        "model.temperature is not permitted: gpt-5.4 rejects a non-default temperature with " +
          "HTTP 400 unsupported_value (see newsletter/docs/azure-budget-rules.md). Remove the field.",
      );
    }
  }

  checkSchemaObject("input", meta.input, metaPath, { renderable: true });
  checkSchemaObject("output", meta.output, metaPath, { renderable: false });
}

if (violations.length > 0) {
  for (const { rule, path, msg } of violations) {
    console.error(`${path}: [${rule}] ${msg}`);
  }
  console.error(`\nworkforce/scripts/validate-tools.mjs: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log(`workforce/scripts/validate-tools.mjs: OK (${listToolDirs().length} tool(s))`);
