// Public API for resolving deterministic skill handlers at runtime.
//
// The handler map itself is build-time generated from
// workforce/skills/*/meta.json (executor === "deterministic") — see
// ./skill-registry-generated.ts and workforce/scripts/build-skill-registry.mjs.
// Adding a deterministic skill = drop a folder under workforce/skills/{name}/
// with SKILL.md + meta.json + handler.ts. No edits to this file.

import { DETERMINISTIC_HANDLERS } from "./skill-registry-generated.js";
import type { DeterministicHandler, DeterministicResult, RunnerContext } from "./skill-types.js";

export function getDeterministicHandler(skillName: string): DeterministicHandler {
  const handler = DETERMINISTIC_HANDLERS[skillName];
  if (!handler) {
    throw new Error(
      `no deterministic handler registered for skill "${skillName}". ` +
        `Add workforce/skills/${skillName}/handler.ts with executor=deterministic in meta.json, ` +
        `then run \`npm run workforce:skill-registry\`.`,
    );
  }
  return handler;
}

export type { DeterministicHandler, DeterministicResult, RunnerContext };
