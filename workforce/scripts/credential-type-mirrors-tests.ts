// The credential-type set is mirrored in several places. This asserts they agree.
//
// Added by the ADR-0029 review (`wf:dario` A1, `wf:rafael` A2, `wf:ren` A3),
// which found the mirrors had already drifted THREE ways without anyone
// noticing: the injector's registry held 9 types, `project.schema.json`
// enumerated 6, and `validate-projects.mjs` enumerated 7. The consequence is
// not theoretical — a value the console accepts can make `workforce:projects`
// fail CI for the same project later, and a credential type declared in a
// project.json that the injector knows can be rejected at validation time.
//
// The injector's registry is the source of truth: it is what the orchestrator
// actually resolves at fire time. The other two are allowlists that must not be
// narrower (they would reject a usable type) or wider (they would accept one
// the runtime cannot resolve).
//
// Why a test and not codegen: codegen would need a build step in front of two
// files that are otherwise plain data. This is the §6.1 ratchet's cheaper half —
// the drift is caught, and whoever adds a type is told exactly where to add it.
//
// All three lists are read as SOURCE TEXT rather than imported: importing
// credential-injector.ts pulls in shared/ddb.ts, which throws without a
// TABLE_NAME at module load. A mirrors check should not need the runtime it is
// checking the configuration of.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Pull the alternation out of a `^(a|b|c)(@…)?$` pattern. */
function baseTypesFrom(pattern: string): string[] {
  const alternation = /^\^\(([^)]+)\)/.exec(pattern);
  if (!alternation) throw new Error(`unrecognised pattern shape: ${pattern}`);
  return alternation[1]!.split("|").map((t) => t.replace(/\\/g, "")).sort();
}

function registryTypes(): string[] {
  const src = readFileSync(
    join(HERE, "..", "lambdas", "shared", "credential-injector.ts"),
    "utf8",
  );
  const block = /export const CREDENTIAL_TYPES[\s\S]*?\]\)/.exec(src);
  if (!block) throw new Error("CREDENTIAL_TYPES not found in credential-injector.ts");
  const types = block[0].match(/"[^"]+"/g);
  if (!types) throw new Error("CREDENTIAL_TYPES appears empty");
  return types.map((t) => t.slice(1, -1)).sort();
}

const registry = registryTypes();

describe("credential-type mirrors agree with the injector registry", () => {
  it("project.schema.json credential_types pattern", () => {
    const schema = JSON.parse(
      readFileSync(join(HERE, "schemas", "project.schema.json"), "utf8"),
    ) as { properties: { credential_types: { items: { pattern: string } } } };
    expect(baseTypesFrom(schema.properties.credential_types.items.pattern)).toEqual(registry);
  });

  it("validate-projects.mjs CREDENTIAL_KEY", () => {
    const src = readFileSync(join(HERE, "validate-projects.mjs"), "utf8");
    const pattern = /const CREDENTIAL_KEY\s*=\s*\n?\s*\/(\^\([^)]+\)[^/]*)\//.exec(src);
    expect(pattern, "CREDENTIAL_KEY regex not found in validate-projects.mjs").toBeTruthy();
    expect(baseTypesFrom(pattern![1]!)).toEqual(registry);
  });

  it("project.schema.json accepts the owner_agent values the API accepts", () => {
    // The API accepts `_operator` explicitly; the schema's pattern rejected it,
    // so a project owned by the operator could not be expressed in the file
    // the schema governs.
    const schema = JSON.parse(
      readFileSync(join(HERE, "schemas", "project.schema.json"), "utf8"),
    ) as { properties: { owner_agent: { pattern: string } } };
    const re = new RegExp(schema.properties.owner_agent.pattern);
    expect(re.test("_operator")).toBe(true);
    expect(re.test("ren")).toBe(true);
    expect(re.test("Ren")).toBe(false);
    expect(re.test("")).toBe(false);
  });
});
