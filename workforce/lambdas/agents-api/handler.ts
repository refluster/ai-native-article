import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

/**
 * Stub. PR2 wires in DynamoDB reads against `WorkforceCore`.
 * Routes (declared in SAM):
 *   GET /agents
 *   GET /agents/{slug}
 * PR2 adds: /skills, /skills/{name}, /agents/{slug}/deliverables, /agents/{slug}/runs.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const route = event.requestContext.http.path
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      route,
      stub: 'agents-api scaffold — PR2 will wire in DynamoDB',
      stage: process.env.STAGE ?? 'unknown',
    }),
  }
}
