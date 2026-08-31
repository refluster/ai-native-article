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
// actually resolves at fire time. The project-side allowlists are a deliberate
// SUBSET of it — they govern what an operator may DECLARE in a project.json,
// and some registry types are never declared because they are minted per fire
// (`workforce.dispatch_token`, ADR-0025) rather than provisioned as a secret.
//
// So the assertion is not equality. It is:
//   (a) the two project-side mirrors agree with each other EXACTLY, and
//   (b) registry MINUS mirrors equals an explicitly named exclusion set.
//
// (b) is what keeps this honest. A plain "mirrors ⊆ registry" check would pass
// when someone adds a declarable type to the registry and forgets the mirrors —
// the exact drift this file exists to catch. Naming the exclusions means a new
// type must either appear in the mirrors or be added to the list below with a
// reason, and both are deliberate acts.
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

/**
 * Registry types an operator never declares in a project.json, with the reason.
 * Anything here is expected to be absent from both project-side mirrors;
 * anything NOT here is expected to be present in both.
 */
const NEVER_DECLARED: Record<string, string> = {
  "workforce.dispatch_token": "minted per fire by the orchestrator (ADR-0025), never provisioned as a secret",
};

function schemaPattern(): string {
  const schema = JSON.parse(
    readFileSync(join(HERE, "schemas", "project.schema.json"), "utf8"),
  ) as { properties: { credential_types: { items: { pattern: string } } } };
  return schema.properties.credential_types.items.pattern;
}

function validatorPattern(): string {
  const src = readFileSync(join(HERE, "validate-projects.mjs"), "utf8");
  const m = /const CREDENTIAL_KEY\s*=\s*\n?\s*\/(\^\([^)]+\)[^/]*)\//.exec(src);
  if (!m) throw new Error("CREDENTIAL_KEY regex not found in validate-projects.mjs");
  return m[1]!;
}

describe("credential-type mirrors", () => {
  it("the schema and the validator agree with each other exactly", () => {
    // These two govern the same thing — what a project.json may declare — so
    // any difference between them is a bug in one of them, never a policy.
    expect(baseTypesFrom(validatorPattern())).toEqual(baseTypesFrom(schemaPattern()));
  });

  it("every declarable registry type appears in both mirrors", () => {
    const declarable = registry.filter((t) => !(t in NEVER_DECLARED));
    expect(baseTypesFrom(schemaPattern())).toEqual(declarable);
  });

  it("the mirrors admit nothing the registry cannot resolve", () => {
    // The other direction: a type the mirrors accept but the injector does not
    // know would fail at fire time, in a cadence's logs.
    for (const type of baseTypesFrom(schemaPattern())) {
      expect(registry, `${type} is declarable but not in CREDENTIAL_TYPES`).toContain(type);
    }
  });

  it("every exclusion is a real registry type, with a stated reason", () => {
    // Guards the exclusion list itself: a stale entry here would silently
    // excuse a type from the mirrors forever.
    for (const [type, reason] of Object.entries(NEVER_DECLARED)) {
      expect(registry, `${type} is excluded but no longer in the registry`).toContain(type);
      expect(reason.length).toBeGreaterThan(20);
    }
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
