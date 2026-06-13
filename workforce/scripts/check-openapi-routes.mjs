#!/usr/bin/env node
// check-openapi-routes.mjs — guard spec↔handler fidelity (PR #305 review M1).
//
// The OpenAPI spec in workforce/lambdas/agents-api/openapi.ts is the
// published API contract (GET /docs/openapi). check-api-routes.mjs guards
// template→live-APIGW drift; this guards the OTHER direction the reviewer
// flagged: the spec silently desyncing from the handler's routeKey dispatch
// when a route is added/removed. It is the same extraction Mateo ran by
// hand, mechanised — the memory→lint ratchet (governance §6.1) applied to a
// once-observed gap.
//
// Method: extract `routeKey === "METHOD /path"` literals from handler.ts and
// `path:` × method keys from the OPENAPI_YAML block, normalise, diff. Any
// route live-but-undocumented OR documented-but-dead is a hard failure
// (C-4: fail loud). The two `/docs/*` routes ARE in both (the spec
// documents itself).
//
// No YAML dependency: the spec's paths/methods are regular enough to walk
// line-by-line within the template literal.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const HANDLER = join(ROOT, "workforce", "lambdas", "agents-api", "handler.ts");
const OPENAPI = join(ROOT, "workforce", "lambdas", "agents-api", "openapi.ts");

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Routes the handler actually dispatches: `routeKey === "METHOD /path"`. */
function handlerRoutes() {
  const src = readFileSync(HANDLER, "utf8");
  const out = new Set();
  const re = /routeKey === "([A-Z]+) ([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.add(`${m[1].toLowerCase()} ${m[2]}`);
  }
  return out;
}

/** Routes the spec documents: walk the OPENAPI_YAML template literal,
 *  tracking the current `  /path:` and emitting each child method key. */
function specRoutes() {
  const src = readFileSync(OPENAPI, "utf8");
  const start = src.indexOf("export const OPENAPI_YAML = `");
  if (start === -1) throw new Error("check-openapi-routes: OPENAPI_YAML block not found");
  const yaml = src.slice(src.indexOf("`", start) + 1, src.indexOf("`;", start));
  const out = new Set();
  let inPaths = false;
  let path = null;
  for (const line of yaml.split("\n")) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (!inPaths) continue;
    if (/^\S/.test(line)) break; // dedent out of paths:
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) { path = pathMatch[1]; continue; }
    const methodMatch = /^ {4}([a-z]+):\s*$/.exec(line);
    if (methodMatch && path && METHODS.has(methodMatch[1])) {
      out.add(`${methodMatch[1]} ${path}`);
    }
  }
  return out;
}

const handler = handlerRoutes();
const spec = specRoutes();

const undocumented = [...handler].filter((r) => !spec.has(r)).sort();
const dead = [...spec].filter((r) => !handler.has(r)).sort();

if (undocumented.length === 0 && dead.length === 0) {
  console.log(`check-openapi-routes.mjs: OK (${handler.size} routes, spec↔handler in sync)`);
  process.exit(0);
}

console.error("check-openapi-routes.mjs: spec↔handler drift");
for (const r of undocumented) console.error(`  live but UNDOCUMENTED in openapi.ts:  ${r}`);
for (const r of dead) console.error(`  documented but NO handler route:       ${r}`);
console.error("Fix: update workforce/lambdas/agents-api/openapi.ts to match the handler routeKey dispatch.");
process.exit(1);
