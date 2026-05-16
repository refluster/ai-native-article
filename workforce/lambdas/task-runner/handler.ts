import type { EventBridgeEvent } from 'aws-lambda'

interface ScheduledRun {
  agentSlug: string
  skillName?: string
}

/**
 * Stub. PR6 wires in:
 *   - Resolve the agent's `agent.json` from S3
 *   - Load each assigned SKILL.md from the skills registry
 *   - Invoke the LLM (router from PR4) with system + skill instructions + memory snapshot
 *   - Write the Deliverable to DDB (AGENT#{slug} / DELIV#{ts}) + S3 (deliverables/...)
 *   - Replace-and-rebuild memory/{agent}/INDEX.md (filesystem semantics, not append)
 *   - Enforce per-agent daily token budget
 */
export const handler = async (
  event: EventBridgeEvent<'WorkforceScheduledRun', ScheduledRun>,
): Promise<{ ok: boolean; stub: string }> => {
  console.log('[task-runner] stub fired', JSON.stringify(event.detail))
  return {
    ok: true,
    stub: 'task-runner scaffold — EventBridge wiring + LLM invocation land in PR6',
  }
}
