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
// ─── Variant syntax (Epic-010 §Q2, RFC v1 "tolerate @") ───────────────
//
// A `requires` entry may be either a base type (`notion.integration_token`)
// or a variant of one (`notion.integration_token@editorial`). The variant
// suffix is opaque to this module — its meaning ("editorial Notion
// workspace" vs "internal Wiki") is owned by whoever provisions the
// secrets. The TS shape behind a variant is the same as its base type
// (variant Notion → NotionSecret).
//
// Secrets Manager path for a variant: wf/projects/{id}/{type@variant}.
// Names containing `@` are valid Secrets Manager names; `getCredential`
// passes the full key through unchanged.
//
// ─── Mirror points (per cycle-1 review, Dario A4) ─────────────────────
//
// The credential-type set has FIVE sync points today (Q1 lands at
// status-quo per operator 2026-05-27):
//
//   1. CredentialShapes interface           (this file — type registry)
//   2. CREDENTIAL_TYPES Set                 (this file — runtime allowlist)
//   3. validate-skills.mjs:CREDENTIAL_TYPES (lint-time allowlist mirror)
//   4. skill-meta.schema.json pattern       (JSON-schema allowlist mirror)
//   5. The runtime allowlist re-check below (defense-in-depth, catches
//      drift between #2 and #3/#4)
//
// Adding a new base type touches all 5. If the count grows past ~10
// types and the mirrors become drift-prone, codegen from #1+#2 to
// #3+#4+#5 is the planned consolidation (Q1 Option B; not implemented).
//
// Story 4 (#93) added `voyage.api_key` — the Voyage AI embedding API
// key used by the EXEC-row embedding-write path. The operator must
// provision `wf/projects/_default/voyage.api_key` (or a per-project
// override) before the embedding path lights up; until then the
// embedding helper lands rows with `embedding_status='pending'` per
// the AC4 failure-isolation contract.

import { getCredential, type ProjectId } from "./project.js";
import type {
  AnthropicSecret,
  GithubSecret,
  NotionSecret,
  VoyageSecret,
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
 * Discord webhook URL — for fire-and-forget channel posts (heartbeat,
 * deploy notifications, etc.) that don't need bot identity. Inbound
 * channel posts via webhook are unauthenticated to the bot graph; the
 * URL itself is the capability. Stored at `wf/projects/{project_id}/discord.webhook_url`.
 */
export interface DiscordWebhookSecret {
  url: string;
}

/**
 * Type registry: maps each credential type literal to its TS shape.
 * Adding a new type requires extending this interface AND the five
 * sync points listed in the file header.
 */
export interface CredentialShapes {
  "anthropic.api_key": AnthropicSecret;
  "discord.bot_token": DiscordBotSecret;
  "discord.webhook_url": DiscordWebhookSecret;
  "github.token": GithubSecret;
  "notion.integration_token": NotionSecret;
  "voyage.api_key": VoyageSecret;
}

export type CredentialType = keyof CredentialShapes;

/**
 * A variant-suffixed key (`type@variant`). The variant is opaque — see
 * file header. TS shape is derived from the base type.
 */
export type VariantKey = `${CredentialType}@${string}`;

/**
 * Any well-formed key the bag can hold: a base credential type or a
 * `type@variant` suffix of one.
 */
export type CredentialKey = CredentialType | VariantKey;

/**
 * Extract the base credential type from a key. `BaseOf<"github.token">`
 * is `"github.token"`; `BaseOf<"notion.integration_token@wiki">` is
 * `"notion.integration_token"`.
 */
export type BaseOf<K extends string> = K extends `${infer B}@${string}`
  ? B
  : K;

/**
 * Runtime mirror of the CredentialShapes keys. Defined as a frozen Set
 * for O(1) lookup; the literal-union keys give compile-time safety.
 *
 * Mirror point #2 — see file header.
 */
export const CREDENTIAL_TYPES: ReadonlySet<CredentialType> = new Set([
  "anthropic.api_key",
  "discord.bot_token",
  "discord.webhook_url",
  "github.token",
  "notion.integration_token",
  "voyage.api_key",
]);

/**
 * Variant naming convention: starts with a letter, then kebab/snake.
 * Empty variants (`type@`) are rejected at the seam below — the schema
 * and validator both also reject them.
 */
const VARIANT_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Parse a `requires` entry into its base type and (optional) variant.
 * Returns `null` for the variant slot when no `@` is present.
 */
export function parseCredentialKey(key: string): {
  baseType: string;
  variant: string | null;
} {
  const atIdx = key.indexOf("@");
  if (atIdx === -1) return { baseType: key, variant: null };
  return { baseType: key.slice(0, atIdx), variant: key.slice(atIdx + 1) };
}

/**
 * Check whether a string is a base credential type in the allowlist.
 * Does NOT accept variants — callers that need to validate a possibly-
 * variant key should `parseCredentialKey` first.
 */
export function isCredentialType(s: string): s is CredentialType {
  return (CREDENTIAL_TYPES as ReadonlySet<string>).has(s);
}

/**
 * A read-only credential bag scoped to one skill execution. The generic
 * `R` narrows the shape to exactly the keys declared in `requires` —
 * undeclared keys are absent from the TS surface (compile error) AND
 * absent from the runtime bag (throw on read).
 *
 * The bag value type is derived from the base type via `BaseOf<K>`, so
 * a variant key gets the same shape as its base type.
 */
export type CredentialBag<R extends string = CredentialKey> = {
  readonly [K in R]: BaseOf<K> extends CredentialType
    ? CredentialShapes[BaseOf<K>]
    : never;
};

/**
 * JS plumbing props that runtimes and libraries access on any object.
 * The bag must let these pass through (returning whatever the underlying
 * map has — typically undefined) instead of throwing, otherwise things
 * like `await bag`, `console.log(bag)`, `JSON.stringify(bag)`, and
 * `util.inspect(bag)` break.
 *
 * Collision guarantee: a future credential type literal could in
 * principle shadow one of these names (e.g. `aws.length`, `oauth.name`).
 * The cold-start assertion below blocks such a base type at module
 * load. Note that the assertion checks BASE types only — a variant
 * `oauth.token@name` does not collide with `name` because the bag's
 * Proxy receives the full `oauth.token@name` string as the prop key,
 * which is not in PLUMBING_PROPS.
 */
const PLUMBING_PROPS: ReadonlySet<string> = new Set([
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
 * Cold-start defense-in-depth (per cycle-1 review, Dario A3 + Ren B8):
 * the no-collision invariant between CREDENTIAL_TYPES and PLUMBING_PROPS
 * is promoted from a prose comment to a mechanical check that fires at
 * module load, BEFORE any handler invocation. A collision here would be
 * silently swallowed at runtime (the prop returns the credential value
 * instead of the plumbing default, or vice versa) — the assertion makes
 * it a fail-loud W-4 event instead.
 */
{
  const collisions: string[] = [];
  for (const t of CREDENTIAL_TYPES) {
    if (PLUMBING_PROPS.has(t)) collisions.push(t);
  }
  if (collisions.length > 0) {
    throw new Error(
      `credential-injector: CREDENTIAL_TYPES ∩ PLUMBING_PROPS must be empty; collisions: ${collisions.join(", ")}`,
    );
  }
}

/**
 * Context passed to `injectCredentials` for actionable error messages.
 * The skill name (and any future labels) is woven into "undeclared
 * access" throws so the operator can pinpoint the offending skill
 * without cross-referencing logs.
 */
export interface InjectionContext {
  skillName?: string;
}

/**
 * Resolve every credential key listed in `requires` from the given
 * project and return a sealed bag. Reads of any key NOT in `requires`
 * throw at runtime; the generic also makes them a compile error.
 *
 * Resolution: each key (base type OR `type@variant`) goes through
 * `project.getCredential(projectId, key)`, which tries
 * `wf/projects/{projectId}/{key}` first and falls back to the legacy
 * bare `wf/{key}` path on `ResourceNotFoundException` (per Epic-010
 * §6 deprecation window).
 *
 * @throws when `requires[]` contains an unknown base type or a malformed
 *   variant (defense-in-depth — `validate-skills.mjs` should have caught
 *   these at lint time, but a runtime re-check guards against drift).
 */
export async function injectCredentials<R extends CredentialKey>(
  requires: readonly R[],
  projectId: ProjectId,
  ctx?: InjectionContext,
): Promise<CredentialBag<R>> {
  const skillLabel = ctx?.skillName ?? "<unknown>";

  // Defense-in-depth: re-validate the allowlist at runtime. Caught by
  // PR-lint, but a runtime re-check guards against schema drift.
  for (const key of requires) {
    const { baseType, variant } = parseCredentialKey(key);
    if (!isCredentialType(baseType)) {
      throw new Error(
        `injectCredentials: requires[] entry "${key}" base type "${baseType}" not in CREDENTIAL_TYPES allowlist (skill="${skillLabel}")`,
      );
    }
    if (variant !== null) {
      if (variant.length === 0) {
        throw new Error(
          `injectCredentials: requires[] entry "${key}" has empty variant after "@" (skill="${skillLabel}")`,
        );
      }
      if (!VARIANT_PATTERN.test(variant)) {
        throw new Error(
          `injectCredentials: requires[] entry "${key}" variant "${variant}" must match ${VARIANT_PATTERN} (skill="${skillLabel}")`,
        );
      }
    }
  }

  // Per-element generic narrows the fetched value's TS shape to exactly
  // the iteration key — cycle-1 review (Dario A5 / Ren B1). Without the
  // inner `<K extends R>`, `getCredential<CredentialShapes[R]>` would
  // widen to the union of all declared shapes.
  const entries = await Promise.all(
    requires.map(async <K extends R>(key: K) => {
      type Shape = BaseOf<K> extends CredentialType
        ? CredentialShapes[BaseOf<K>]
        : never;
      const value = await getCredential<Shape>(projectId, key);
      return [key, value] as const;
    }),
  );

  const declared = new Set<string>(requires);
  // Freeze the underlying map so its own-property descriptors report
  // `configurable: false, writable: false` — required for the Proxy
  // `getOwnPropertyDescriptor` trap to honestly mirror the runtime
  // contract without violating Proxy invariants. The Proxy `set` and
  // `deleteProperty` traps still throw with our custom messages first;
  // the frozen target is the defense-in-depth backstop.
  const map: Record<string, unknown> = Object.freeze(Object.fromEntries(entries));

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
          `CredentialBag: credential key "${prop}" not declared in skill meta.requires[] (skill="${skillLabel}")`,
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
    // Descriptor reports `configurable: false, writable: false` to match
    // the runtime contract — the `set` and `deleteProperty` traps below
    // throw, so introspectors that read the descriptor get a consistent
    // story (per cycle-1 review, Ren B5).
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && declared.has(prop)) {
        return {
          enumerable: true,
          configurable: false,
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
