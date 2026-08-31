#!/usr/bin/env node
// Scans workforce/tools/*/{tool.json,system.md} and generates TWO
// registries (ADR-0027 §3, Epic-025 Phase 2):
//
//   1. workforce/lambdas/shared/tool-registry-generated.ts — the FULL
//      registry, system prompts included. Consumed by tools-api.
//   2. workforce/app/src/lib/tool-registry-generated.ts — the same
//      entries WITHOUT `system`. Consumed by the console.
//
// The split is the point, not an optimisation: the console needs the
// schemas to draw a form and a result, and nothing else. Shipping the
// system prompts into a browser bundle would publish them to anyone who
// opens devtools, for no rendering benefit.
//
// Contract:
//   - Directory name === tool.json:tool_id (the route segment).
//   - Both generated files are committed to git; CI runs this with
//     --check and asserts no diff (workforce:tool-registry:check).
//
// Invocation:
//   node workforce/scripts/build-tool-registry.mjs         # writes
//   node workforce/scripts/build-tool-registry.mjs --check # exits 1 on diff

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const TOOLS_DIR = join(WORKFORCE_ROOT, "tools");
const LAMBDA_OUT = join(WORKFORCE_ROOT, "lambdas", "shared", "tool-registry-generated.ts");
const APP_OUT = join(WORKFORCE_ROOT, "app", "src", "lib", "tool-registry-generated.ts");

const CHECK = process.argv.includes("--check");

function listToolDirs() {
  if (!existsSync(TOOLS_DIR)) return [];
  return readdirSync(TOOLS_DIR)
    .filter((n) => !n.startsWith(".") && statSync(join(TOOLS_DIR, n)).isDirectory())
    .sort();
}

const tools = [];
for (const dir of listToolDirs()) {
  const metaPath = join(TOOLS_DIR, dir, "tool.json");
  const promptPath = join(TOOLS_DIR, dir, "system.md");
  if (!existsSync(metaPath)) {
    console.error(`build-tool-registry: ${relative(REPO_ROOT, metaPath)} missing`);
    process.exit(1);
  }
  if (!existsSync(promptPath)) {
    console.error(`build-tool-registry: ${relative(REPO_ROOT, promptPath)} missing`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.tool_id !== dir) {
    console.error(
      `build-tool-registry: ${relative(REPO_ROOT, metaPath)} tool_id="${meta.tool_id}" ` +
        `does not match its directory "${dir}" — the directory is the route segment`,
    );
    process.exit(1);
  }
  tools.push({ ...meta, system: readFileSync(promptPath, "utf8").trim() });
}

const BANNER = (script) =>
  `// GENERATED FILE — do not edit by hand.\n` +
  `// Source: workforce/tools/*/{tool.json,system.md}\n` +
  `// Regenerate: node workforce/scripts/${script}\n`;

const lambdaSrc =
  BANNER("build-tool-registry.mjs") +
  `//\n// The FULL registry, system prompts included. Server-side only —\n` +
  `// the console gets the prompt-free sibling at app/src/lib/.\n\n` +
  `import type { ToolDefinition } from "./tool-types.js";\n\n` +
  `export const TOOL_REGISTRY: readonly ToolDefinition[] = ${JSON.stringify(tools, null, 2)} as const;\n`;

const appTools = tools.map(({ system: _system, ...rest }) => rest);
const appSrc =
  BANNER("build-tool-registry.mjs") +
  `//\n// The console's view of the registry: everything needed to draw the\n` +
  `// form and the result, and NOT the system prompts (they stay in the\n` +
  `// Lambda's copy — a browser bundle is a publication).\n\n` +
  `import type { ToolDefinition } from '../types/tool';\n\n` +
  `export const TOOL_REGISTRY: readonly ToolDefinition[] = ${JSON.stringify(appTools, null, 2)};\n`;

let failed = false;
for (const [path, src] of [
  [LAMBDA_OUT, lambdaSrc],
  [APP_OUT, appSrc],
]) {
  const rel = relative(REPO_ROOT, path);
  if (CHECK) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (current !== src) {
      console.error(`build-tool-registry: ${rel} is stale — run node workforce/scripts/build-tool-registry.mjs`);
      failed = true;
    }
  } else {
    writeFileSync(path, src);
  }
}
if (failed) process.exit(1);
console.log(`build-tool-registry: OK (${tools.length} tool(s))`);
