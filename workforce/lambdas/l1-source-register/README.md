# wf-l1-source-register

The **non-GAS replacement for the retired GAS `L1_SAVE` capture**. A mechanical
(no-LLM) HTTP endpoint that registers a web source URL as a row in the Notion
**L1 source DB** — the DB that `workforce/skills/article-level2/pick-l1-source.mjs`
reads to find uncovered sources.

## Endpoint

`POST /l1/register` on the workforce HTTP API (`WfAgentsHttpApi`).

Body (JSON):

| field | required | notes |
|---|---|---|
| `url` | ✅ | the source article URL (http/https) |
| `title` | — | defaults to the URL when absent (no model is consulted) |
| `category` | — | `A`–`E` or a canonical bucket label; re-canonicalised downstream |
| `summary` | — | the L2 cadence's only grounding fallback for unfetchable/paywalled URLs |
| `publicationDate` | — | `YYYY-MM-DD` |

Responses: `201` created · `200` `{deduped:true}` (the Source URL already had a row) ·
`400` bad input · `401` bad/missing bearer · `5xx` Notion/credential error.

**Auth:** bearer token in the `Authorization: Bearer …` header (no API Gateway
authorizer on this route — the operator/Shortcut/CLI has no SigV4 creds),
validated constant-time against the Secrets Manager secret
`wf/api/l1-source-write-token`. Same pattern as `POST /feed`.

**Notion credential:** reuses `wf/notion` (only its `apiKey`). The integration
behind that key **must be shared with the L1 source DB** (it already is — the
article cadences read that DB with the same key). The L1 DB id is the constant
`L1_DB_ID` (overridable via env), not the `wf/notion` `databaseId` (that's the
Articles DB).

## Operator setup (one-time)

1. **Create the bearer-token secret** (any strong random string):
   ```sh
   aws secretsmanager create-secret --name wf/api/l1-source-write-token \
     --secret-string "{\"token\":\"$(openssl rand -hex 24)\"}" --region us-west-2
   ```
2. **Deploy** (from `workforce/infra/sam`, operator-run — there is no CI deploy):
   ```sh
   cd workforce/lambdas && npm ci
   cd ../infra/sam && sam build && sam deploy --config-env dev
   ```
3. Note the API base from the stack output; the route is `…/l1/register`.

## Desktop CLI

```sh
export L1_CAPTURE_ENDPOINT="https://<api-id>.execute-api.us-west-2.amazonaws.com/dev/l1/register"
export L1_CAPTURE_TOKEN="<the token from step 1>"
node scripts/capture-l1.mjs https://example.com/post --title "Some title" --category B
```

## iOS Shortcut (Share Sheet capture)

Replaces the retired capture PWA's Share Sheet target:

1. New Shortcut → **Receive** URLs from the Share Sheet.
2. **Get Contents of URL** → Method `POST`, URL = the `/l1/register` endpoint.
   - Header `Authorization` = `Bearer <token>`.
   - Header `Content-Type` = `application/json`.
   - Request Body `JSON`: `url` = the Shortcut Input (optionally add `title`).
3. Share any article → the Shortcut → the L1 row appears in Notion.

## Notes

- **Idempotent:** re-capturing the same URL returns the existing row, so a
  double-share is harmless.
- **No LLM / no cost:** capture is a deterministic Notion write. See the L1
  section of [`newsletter/docs/L1-L4-PIPELINE.md`](../../../newsletter/docs/L1-L4-PIPELINE.md)
  for why the previously auto-extracted fields are not load-bearing.
