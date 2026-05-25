// Stub handler for the pdm-charter skill. See ./SKILL.md for the
// intended v2 contract. The Maya binding is executor=cli + scheduler=manual,
// so this handler is never auto-fired by the orchestrator. Implemented as
// a throw so any accidental dispatch surfaces loudly (W-1 fail-loud).

import type { DeterministicResult, RunnerContext } from "../../lambdas/shared/skill-types.js";

export async function dispatchPdmCharter(_ctx: RunnerContext): Promise<DeterministicResult> {
  throw new Error(
    "pdm-charter is a stub — see workforce/skills/pdm-charter/SKILL.md for the v2 contract. " +
      "The Maya binding is executor=cli scheduler=manual, so this handler should not be auto-dispatched.",
  );
}
