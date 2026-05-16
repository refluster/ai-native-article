/**
 * Stub. PR2 wires in:
 *   - Walk workforce/agents/ → upload agent.json + system.md to S3, write AGENT#META to DDB
 *   - Walk workforce/skills/ → upload SKILL.md to S3, write SKILL#META to DDB
 *   - Read seed/assignments.yaml → write AGENT#{slug}/SKILL#{id} and SKILL#{id}/AGENT#{slug} link rows
 *
 * Must be idempotent — safe to invoke repeatedly. Uses conditional DDB writes on a content SHA.
 *
 * Invoked manually via `aws lambda invoke`, not on a schedule.
 */
export const handler = async (): Promise<{
  ok: boolean
  loaded: { agents: number; skills: number; links: number }
  stub: string
}> => {
  console.log('[seed] stub fired — registry load lands in PR2')
  return {
    ok: true,
    loaded: { agents: 0, skills: 0, links: 0 },
    stub: 'seed scaffold — registry load lands in PR2',
  }
}
