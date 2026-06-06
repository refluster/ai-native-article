#!/usr/bin/env node
// check-skill-spec-drift.mjs — Dario L2-1 follow-up from PR #230 review.
//
// Catches the Epic-010 retrospective canonical drift class: a workforce-
// client SKILL.md documents an API path or required JSON field that has
// silently fallen out of sync with `agents-api/handler.ts`. Without this
// lint the failure surfaces as a consumer 4xx ("workforce returned 400
// missing_fields") long after the upstream PR landed.
//
// What's checked
// --------------
//
// Scope: every `SKILL.md` under `workforce/client/templates/claude-skills/*/`.
// These are the load-bearing contracts that external repos consume —
// drift here is the most catastrophic failure mode (consumer's Claude
// Code session fires a request the workforce can't accept).
//
// Workforce-side SKILL.md files (`workforce/skills/*/SKILL.md`) are NOT
// in scope today: those are read by developers (operator + Claude Code
// sessions running in this repo), where drift surfaces locally and is
// caught at PR-review time. Adding them later is a scope amendment.
//
// Two checks:
//
//   D-1  Every API path mentioned in a SKILL.md body — extracted by
//        matching `${ENDPOINT}/agents/{slug}/<name>` or
//        `${ENDPOINT}/agents/${SLUG}/<name>` patterns — MUST resolve to
//        a `routeKey === "<METHOD> /agents/{slug}/<name>"` entry in
//        `agents-api/handler.ts`. Drift here = a documented endpoint
//        that doesn't exist (or was renamed). Fails the lint.
//
//   D-2  The `POST /agents/{slug}/engagements` body, if any of its
//        required fields are mentioned in a documented JSON example,
//        MUST include EVERY required field the handler validates. The
//        canonical required list is the `const required:` array in
//        `createEngagementRoute`. We parse it out of the source as a
//        single literal block. A SKILL.md that documents an engagement
//        record example missing one of these required fields would
//        produce `400 missing_fields` at consumer runtime.
//
// What's NOT checked
// ------------------
//
//   - Optional fields (artifact, error, etc.). Adding/removing those is
//     additive on the handler side; SKILL.md docs simply explain when
//     to use them.
//   - Header names (`Authorization: Bearer ...`). The bearer scheme is
//     stable.
//   - Query-string parameter names (`?project_id=`). Documented in the
//     SKILL.md but not extracted here; future drift class if scope
//     expands.
//   - Response body shape. The SKILL.md doesn't currently document the
//     server's response shape (the consumer doesn't depend on it for
//     decisions); if that changes, expand the lint.
//
// Exit codes
// ----------
//
//   0  No drift detected.
//   1  Drift detected; offending lines printed to stderr.
//   2  Lint-internal error (couldn't read inputs / parse). Surfaces as
//      CI failure with a distinct message.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const CLIENT_SKILLS_DIR = join(
  WORKFORCE_ROOT,
  "client",
  "templates",
  "claude-skills",
);
const HANDLER_PATH = join(
  WORKFORCE_ROOT,
  "lambdas",
  "agents-api",
  "handler.ts",
);

const violations = [];
const v = (rule, path, msg) =>
  violations.push({ rule, path: relative(REPO_ROOT, path), msg });

// --- Inputs --------------------------------------------------------------

function listClientSkills() {
  if (!existsSync(CLIENT_SKILLS_DIR)) return [];
  return readdirSync(CLIENT_SKILLS_DIR)
    .map((name) => join(CLIENT_SKILLS_DIR, name, "SKILL.md"))
    .filter((p) => existsSync(p));
}

function readHandler() {
  if (!existsSync(HANDLER_PATH)) {
    console.error(
      `check-skill-spec-drift: agents-api/handler.ts not found at ${relative(REPO_ROOT, HANDLER_PATH)}`,
    );
    process.exit(2);
  }
  return readFileSync(HANDLER_PATH, "utf8");
}

// --- D-1: path drift -----------------------------------------------------

// Matches `/agents/<slug-placeholder>/<endpoint>` — but ONLY when the
// path is an API client reference, not a github raw URL.
//
// API form (matches): `${WF_ENDPOINT}/agents/${SLUG}/portfolio`
// API form (matches): `${ENDPOINT}/agents/{slug}/engagements`
// GitHub raw (rejects): `raw.githubusercontent.com/.../workforce/agents/${SLUG}/system.md`
//
// The negative-lookbehind `(?<!/workforce)` rejects the GitHub raw path
// (which always has `/workforce/agents/...` as the URL segment). The
// preceding-character check `(?<=[\s"$}])` requires the `/agents/`
// substring to start at a "natural" boundary — after a quote, a space,
// or the end of an interpolated variable — so e.g. `multi/agents/...`
// (prose) doesn't match.
const SKILL_PATH_RE =
  /(?<=[\s"$}])(?<!\/workforce)\/agents\/(?:\{slug\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)\/([a-z][a-z0-9-]*)/g;

// Matches the canonical routeKey === "METHOD /agents/{slug}/<endpoint>"
// constants in agents-api/handler.ts.
const ROUTE_RE =
  /routeKey === "(?:GET|POST|PUT|PATCH|DELETE) \/agents\/\{slug\}\/([a-z][a-z0-9-]*)"/g;

function extractSkillPaths(body) {
  const out = new Set();
  for (const m of body.matchAll(SKILL_PATH_RE)) {
    out.add(m[1]);
  }
  return out;
}

function extractRoutedPaths(handlerBody) {
  const out = new Set();
  for (const m of handlerBody.matchAll(ROUTE_RE)) {
    out.add(m[1]);
  }
  return out;
}

// --- D-2: required-fields drift ------------------------------------------

// Parse the `const required: Array<keyof typeof parsed> = [ ... ]` block
// from createEngagementRoute. We pin to the `const required` identifier;
// the parser is brittle by design — if the createEngagementRoute author
// renames the variable, this lint correctly flags the drift as a
// "couldn't find the required list" error and CI turns red.
function extractRequiredFields(handlerBody) {
  // Match `const required: ... = [ "a", "b", ... ];`
  const m = handlerBody.match(
    /const required:[^=]*=\s*\[([\s\S]*?)\];/,
  );
  if (!m) {
    console.error(
      "check-skill-spec-drift: could not locate `const required:` array in agents-api/handler.ts " +
        "(createEngagementRoute). If the variable was renamed, update this script.",
    );
    process.exit(2);
  }
  const fields = new Set();
  for (const sm of m[1].matchAll(/"([a-z_]+)"/g)) {
    fields.add(sm[1]);
  }
  return fields;
}

// Find documented `POST /agents/{slug}/engagements` examples and return
// the set of known JSON field names that appear anywhere in the file.
//
// Approach: rather than try to delimit "the engagements section" (the
// JSON body example, the field-list bullets, and the endpoint mention
// can be in any order — the lazy `[\s\S]*?` window approach proved
// brittle), we (a) confirm the file documents the engagements endpoint
// at all (gates whether to run D-2 at all), then (b) globally scan for
// `"<known-field>":` JSON-key tokens and check the required ones are
// present.
//
// The trade-off: if a future SKILL.md mentions `"project_id":` in a
// non-engagement code block (e.g. project.json), this lint would
// (correctly) count that as documented coverage. For workforce-client
// SKILL.md files specifically, all known-field mentions ARE engagement-
// related — `project_id` etc. don't appear elsewhere — so the false-
// negative risk is low. Worth tightening if a multi-purpose SKILL.md
// arrives later.
const KNOWN_ENGAGEMENT_FIELDS = new Set([
  "project_id",
  "skill_name",
  "skill_version",
  "started_at",
  "ended_at",
  "status",
  "engagement_id",
  "artifact",
  "error",
  "used_credential_types",
  "inputs_hash",
  "execution_surface",
]);

function extractDocumentedEngagementFields(body) {
  // Gate: does this SKILL.md document the engagements endpoint at all?
  // If not, skip D-2 (return null = "no engagement docs to check").
  if (!/\/agents\/(?:\{slug\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)\/engagements\b/.test(body)) {
    return null;
  }
  const seen = new Set();
  for (const m of body.matchAll(/"([a-z_]+)"\s*:/g)) {
    if (KNOWN_ENGAGEMENT_FIELDS.has(m[1])) {
      seen.add(m[1]);
    }
  }
  return seen;
}

// --- Run -----------------------------------------------------------------

function main() {
  const skills = listClientSkills();
  if (skills.length === 0) {
    console.log(
      "check-skill-spec-drift: no SKILL.md files under workforce/client/templates/claude-skills/; nothing to check.",
    );
    process.exit(0);
  }

  const handler = readHandler();
  const routedPaths = extractRoutedPaths(handler);
  const requiredFields = extractRequiredFields(handler);

  for (const skill of skills) {
    const body = readFileSync(skill, "utf8");

    // D-1: path drift
    const skillPaths = extractSkillPaths(body);
    for (const path of skillPaths) {
      if (!routedPaths.has(path)) {
        v(
          "D-1",
          skill,
          `documented endpoint /agents/{slug}/${path} has no matching routeKey in agents-api/handler.ts`,
        );
      }
    }

    // D-2: required-fields drift (engagements only — that's the load-
    // bearing example today; expand when other endpoints get documented
    // example bodies).
    const documentedFields = extractDocumentedEngagementFields(body);
    if (documentedFields !== null) {
      for (const required of requiredFields) {
        if (!documentedFields.has(required)) {
          v(
            "D-2",
            skill,
            `engagements example missing required field "${required}" (createEngagementRoute validates it; consumer would get 400 missing_fields)`,
          );
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-skill-spec-drift: ${skills.length} client SKILL.md file(s) validated — D-1 (path drift) + D-2 (required-fields drift) both clean.`,
    );
    process.exit(0);
  }

  for (const { rule, path, msg } of violations) {
    console.error(`[${rule}] ${path}: ${msg}`);
  }
  console.error(
    `\n${violations.length} drift violation(s). Either update the SKILL.md to match agents-api/handler.ts, or fix the API drift — do not loosen this lint.`,
  );
  process.exit(1);
}

main();
