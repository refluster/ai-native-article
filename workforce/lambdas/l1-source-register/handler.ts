// wf-l1-source-register — mechanical (no-LLM) L1 source capture endpoint.
//
// POST /l1/register registers a web source URL as a row in the Notion L1
// source DB — the DB that workforce/skills/article-level2/pick-l1-source.mjs
// reads to find uncovered sources. It is the non-GAS replacement for the
// retired GAS `L1_SAVE` capture path: same Notion write, but NO LLM call.
// `url` is the only required field; title / category / summary /
// publicationDate are optional pass-throughs (an iOS Shortcut or the
// scripts/capture-l1.mjs CLI can supply the title it already has). We do NOT
// call any model — title defaults to the URL when absent, category/summary
// are left empty (category is re-canonicalised downstream by the L2 cadence;
// summary is only a paywall fallback the operator can fill in by hand).
//
// Auth: bearer token (no API GW authorizer on this route — the operator/
// Shortcut has no SigV4 creds), validated constant-time against the secret
// wf/api/l1-source-write-token, mirroring the agents-api POST /feed pattern.

import { timingSafeEqual } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getSecret } from "../shared/secrets.js";
import {
  insertL1Source,
  findL1SourceByUrl,
  listL1Sources,
  type NotionApiSecret,
} from "../shared/notion.js";

// Non-secret L1 source DB id — mirrors the constant in
// workforce/skills/article-level2/pick-l1-source.mjs. Env override for tests.
const L1_DB_ID =
  process.env.L1_DB_ID || "32fd0f0b-e61e-80bd-89bf-f94965d05e80";
const WRITE_TOKEN_SECRET =
  process.env.L1_WRITE_TOKEN_SECRET || "wf/api/l1-source-write-token";
// The Notion integration token is the PROJECT-scoped credential (shape
// {apiKey, databaseId}; only apiKey is read here), the same secret the
// article-level2/3 cadences and wf-podcast resolve — NOT a top-level
// `wf/notion`. The integration behind it is shared with the L1 source DB.
const NOTION_SECRET_ID =
  process.env.NOTION_SECRET_ID ||
  "wf/projects/agent-workforce/notion.integration_token";

interface WriteTokenSecret {
  token: string;
}

const json = (
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function validBearer(event: APIGatewayProxyEventV2): Promise<boolean> {
  const headers = event.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization;
  if (!raw || !raw.startsWith("Bearer ")) return false;
  const presented = raw.slice("Bearer ".length).trim();
  if (!presented) return false;
  let expected: string;
  try {
    expected = (await getSecret<WriteTokenSecret>(WRITE_TOKEN_SECRET)).token;
  } catch {
    return false;
  }
  if (!expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!(await validBearer(event))) {
    return json(401, { error: "unauthorized" });
  }

  let notionList: NotionApiSecret;
  try {
    notionList = await getSecret<NotionApiSecret>(NOTION_SECRET_ID);
  } catch {
    return json(500, { error: "notion credential unavailable" });
  }

  // GET /l1/sources — recent rows for the Capture UI list/streak.
  if ((event.requestContext?.http?.method ?? "POST").toUpperCase() === "GET") {
    try {
      const data = await listL1Sources({
        apiKey: notionList.apiKey,
        databaseId: L1_DB_ID,
        limit: 50,
      });
      return json(200, { ok: true, data });
    } catch (err) {
      return json(502, {
        error: `notion query failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // POST /l1/register — register one source URL (mechanical, no LLM).
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "body must be valid JSON" });
  }

  const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
  if (!url || !/^https?:\/\/\S+$/i.test(url)) {
    return json(400, { error: "`url` is required and must be an http(s) URL" });
  }

  const optStr = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const title = optStr(parsed.title);
  const category = optStr(parsed.category);
  const summary = optStr(parsed.summary);
  const publicationDate = optStr(parsed.publicationDate);

  try {
    // Idempotent on Source URL: a re-capture of the same URL returns the
    // existing row rather than creating a duplicate L1 entry.
    const existing = await findL1SourceByUrl({
      apiKey: notionList.apiKey,
      databaseId: L1_DB_ID,
      url,
    });
    if (existing) {
      return json(200, { ok: true, deduped: true, pageId: existing.pageId, url: existing.url });
    }
    const created = await insertL1Source({
      apiKey: notionList.apiKey,
      databaseId: L1_DB_ID,
      url,
      title,
      category,
      summary,
      publicationDate,
    });
    return json(201, { ok: true, deduped: false, pageId: created.pageId, url: created.url });
  } catch (err) {
    return json(502, {
      error: `notion write failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
