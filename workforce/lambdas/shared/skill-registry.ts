// Registry of deterministic skill handlers. Keyed by the skill's
// meta.json:name. The runner looks up the entry when it sees
// executor==="deterministic" and runs the function with the run
// context. The function returns the bytes that should land in
// runs/{slug}/{run_id}/output.{ext}; the runner persists them and
// writes the RUN row.

import { dispatchDiscordPing, type DeterministicResult, type RunnerContext } from "./handlers/discord-ping.js";

export type DeterministicHandler = (ctx: RunnerContext) => Promise<DeterministicResult>;

const REGISTRY: Record<string, DeterministicHandler> = {
  "discord-ping": dispatchDiscordPing,
};

export function getDeterministicHandler(skillName: string): DeterministicHandler {
  const handler = REGISTRY[skillName];
  if (!handler) {
    throw new Error(
      `no deterministic handler registered for skill "${skillName}". ` +
        `Either register one in shared/skill-registry.ts or change the skill's executor.`,
    );
  }
  return handler;
}

export type { DeterministicResult, RunnerContext };
