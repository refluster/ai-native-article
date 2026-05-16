import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

/**
 * Stub. PR4 wires in:
 *   - Lambda response streaming for token-by-token output
 *   - LLM router (Azure OpenAI default, Anthropic per-agent override)
 *   - Chat DDB table writes (thread + messages)
 *   - x-workforce-api-key header check
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const slug = event.pathParameters?.slug ?? 'unknown'
  return {
    statusCode: 501,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: false,
      slug,
      stub: 'chat-api scaffold — streaming + LLM router land in PR4',
    }),
  }
}
