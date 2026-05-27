// workforce/lambdas/shared/credential-injector.ts
//
// Type-keyed credential injection. Per Epic-010 §5 (workforce/docs/epics/
// epic-010-project-trust-boundary.md), each skill declares the credential
// types it needs (`requires: ["notion.integration_token", ...]` in
// meta.json); at invocation time the runner resolves each declared type
// from the active project and seals the result into a CredentialBag.
// Reads of any type NOT in `requires` throw — the trust boundary is
// enforced at the runner seam, not by convention.
//
// Story 2-A scope: types + helpers + tests. Pure addition; no production
// code path calls `injectCredentials` yet. Story 2-B (#91) wires it into
// the agent-runner across the three executor paths.
//
// Allowlist mirror: CREDENTIAL_TYPES below MUST stay in sync with the
// allowlist in workforce/scripts/validate-skills.mjs (CREDENTIAL_TYPES)
// and the JSON-schema enum in workforce/scripts/schemas/skill-meta.
// schema.json (requires.items.enum). To add a new type:
//   1. Add the literal to CredentialShapes here (and pick or define a TS
//      shape).
//   2. Add it to CREDENTIAL_TYPES here.
//   3. Add it to CREDENTIAL_TYPES in validate-skills.mjs.
//   4. Add it to requires.items.enum in skill-meta.schema.json.

import { getCredential, type ProjectId } from "./project.js";
import type {
  AnthropicSecret,
  GithubSecret,
  NotionSecret,
} from "./secrets.js";

/**
 * Shape of a Discord bot token credential. Distinct from `WebhookSecret`
 * (workforce/lambdas/shared/webhook.ts) — the bot token authenticates
 * the bot user for arbitrary API calls; a webhook URL authenticates a
 * single channel post-only endpoint. Different threat model, different
 * shape.
 */
export interface DiscordBotSecret {
  token: string;
}

/**
 * Type registry: maps each credential type literal to its TS shape.
 * Adding a new type requires extending this interface AND the
 * CREDENTIAL_TYPES set + the validator + schema (see file header).
 */
export interface CredentialShapes {
  "anthropic.api_key": AnthropicSecret;
  "discord.bot_token": DiscordBotSecret;
  "github.token": GithubSecret;
  "notion.integration_token": NotionSecret;
}

export type CredentialType = keyof CredentialShapes;

/**
 * Runtime mirror of the CredentialShapes keys. Defined as a frozen Set
 * for O(1) lookup; the literal-union keys give compile-time safety.
 */
export const CREDENTIAL_TYPES: ReadonlySet<CredentialType> = new Set([
  "anthropic.api_key",
  "discord.bot_token",
  "github.token",
  "notion.integration_token",
]);

export function isCredentialType(s: string): s is CredentialType {
  return (CREDENTIAL_TYPES as ReadonlySet<string>).has(s);
}

/**
 * A read-only credential bag scoped to one skill execution. The generic
 * `R` narrows the shape to exactly the types declared in `requires` —
 * undeclared keys are absent from the TS surface (compile error) AND
 * absent from the runtime bag (throw on read).
 */
export type CredentialBag<R extends CredentialType = CredentialType> = {
  readonly [K in R]: CredentialShapes[K];
};

/**
 * JS plumbing props that runtimes and libraries access on any object.
 * The bag must let these pass through (returning undefined) instead of
 * throwing, otherwise things like `await bag`, `console.log(bag)`,
 * `JSON.stringify(bag)`, and `util.inspect(bag)` break.
 *
 * Conservative list: only the props that are actually accessed by JS
 * runtime + Node inspector + Promise machinery + JSON / structured
 * clone paths. A `requires` entry that collides with this list would
 * be silently swallowed — but no credential-type literal in the
 * reverse-domain pattern `^[a-z]+\.[a-z_]+$` can match these names.
 */
const PLUMBING_PROPS: ReadonlySet<string | symbol> = new Set([
  "then",
  "catch",
  "finally",
  "constructor",
  "prototype",
  "__proto__",
  "toString",
  "toJSON",
  "valueOf",
  "length",
  "name",
  "asymmetricMatch", // vitest equality matcher hook
]);

/**
 * Resolve every credential type listed in `requires` from the given
 * project and return a sealed bag. Reads of any type NOT in `requires`
 * throw at runtime; the generic also makes them a compile error.
 *
 * Resolution: each type goes through `project.getCredential(projectId,
 * type)`, which tries `wf/projects/{projectId}/{type}` first and falls
 * back to the legacy bare `wf/{type}` path on `ResourceNotFoundException`
 * (per Epic-010 §6 deprecation window).
 *
 * @throws when `requires[]` contains an unknown credential type
 *   (defense-in-depth — `validate-skills.mjs` should have caught this
 *   at lint time, but a runtime re-check guards against schema drift).
 */
export async function injectCredentials<R extends CredentialType>(
  requires: readonly R[],
  projectId: ProjectId,
): Promise<CredentialBag<R>> {
  // Defense-in-depth: re-validate the allowlist at runtime. The validator
  // already catches this at PR-lint time; this guard fires if a bad
  // meta.json bypasses the lint somehow (e.g., direct DDB edit, schema
  // drift between Lambda and CI).
  for (const type of requires) {
    if (!isCredentialType(type)) {
      throw new Error(
        `injectCredentials: requires[] entry "${type}" not in CREDENTIAL_TYPES allowlist`,
      );
    }
  }

  const entries = await Promise.all(
    requires.map(async (type) => {
      const value = await getCredential<CredentialShapes[R]>(projectId, type);
      return [type, value] as const;
    }),
  );

  const declared = new Set<string>(requires);
  const map: Record<string, unknown> = Object.fromEntries(entries);

  return new Proxy(map, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      if (PLUMBING_PROPS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      if (!declared.has(prop)) {
        throw new Error(
          `CredentialBag: credential type "${prop}" not declared in skill meta.requires[]`,
        );
      }
      return target[prop];
    },
    has(_target, prop) {
      return typeof prop === "string" && declared.has(prop);
    },
    ownKeys() {
      return [...declared];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && declared.has(prop)) {
        return {
          enumerable: true,
          configurable: true,
          writable: false,
          value: target[prop],
        };
      }
      return undefined;
    },
    set() {
      throw new Error("CredentialBag is sealed; mutation not allowed");
    },
    deleteProperty() {
      throw new Error("CredentialBag is sealed; deletion not allowed");
    },
  }) as CredentialBag<R>;
}
