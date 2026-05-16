import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { dbGet, dbQuery, dbQueryGsi1, CORE_TABLE } from '../shared/ddb.js'

function ok(body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function notFound(msg: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 404,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: false, error: msg }),
  }
}

function badRequest(msg: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: false, error: msg }),
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method
  const path = event.requestContext.http.path
  const params = event.pathParameters ?? {}

  // GET /agents
  if (method === 'GET' && path === '/agents') {
    const items = await dbQueryGsi1(CORE_TABLE, 'AGENT')
    return ok({ ok: true, agents: items })
  }

  // GET /agents/{slug}
  if (method === 'GET' && params.slug && !path.includes('/deliverables') && !path.includes('/runs') && path.startsWith('/agents/')) {
    const slug = params.slug
    const item = await dbGet(CORE_TABLE, `AGENT#${slug}`, 'META')
    if (!item) return notFound(`agent '${slug}' not found`)
    return ok({ ok: true, agent: item })
  }

  // GET /agents/{slug}/deliverables
  if (method === 'GET' && params.slug && path.endsWith('/deliverables')) {
    const slug = params.slug
    const items = await dbQuery(CORE_TABLE, `AGENT#${slug}`, 'DELIV#')
    return ok({ ok: true, deliverables: items })
  }

  // GET /agents/{slug}/runs
  if (method === 'GET' && params.slug && path.endsWith('/runs')) {
    const slug = params.slug
    const items = await dbQuery(CORE_TABLE, `AGENT#${slug}`, 'RUN#')
    return ok({ ok: true, runs: items })
  }

  // GET /skills
  if (method === 'GET' && path === '/skills') {
    const items = await dbQueryGsi1(CORE_TABLE, 'SKILL')
    return ok({ ok: true, skills: items })
  }

  // GET /skills/{name}
  if (method === 'GET' && params.name) {
    const name = params.name
    const item = await dbGet(CORE_TABLE, `SKILL#${name}`, 'META')
    if (!item) return notFound(`skill '${name}' not found`)
    return ok({ ok: true, skill: item })
  }

  return badRequest(`unhandled route: ${method} ${path}`)
}
