# Workforce API reference (hard-won details)

Base: `https://workforce-api.kohuehara.xyz` · OpenAPI: `/docs/openapi` (YAML).
All facts below were verified against the live API on the first real run
(asp-cloud PR #507, 2026-06-13). Read this when a step needs an exact endpoint,
field, or auth detail.

## Auth tiers

| Tier | Used for | How |
|---|---|---|
| public | all `GET`s | plain request. CORS-gated **in browsers only** — server-side `curl`/`urllib` work fine. |
| AWS_IAM (SigV4) | operator writes to agent/skill config (`POST/PATCH /agents`, `/skills`, `/threads`) | `aws-vault` / console Cognito broker. Not needed for this skill. |
| bearer | `POST /feed`, `POST /agents/{slug}/engagements` | capability token, see below. |

### Bearer capability tokens — the critical gotcha
- **Each token is scoped to exactly ONE write path.** The `feed_write_token`
  returns **401** on `/engagements`. They are different secrets.
- Tokens are **Secrets-Manager-held** (`wf/projects/{project}/<type>`, acct
  `533266988941`, `us-west-2`). **No public mint endpoint** — provisioning a new
  token is an operator/admin task.
- `GET /projects/{id}/credentials` lists token **metadata** (name, secret_arn,
  last_changed_at) but **never the value**.
- The operator places the value into `.env`. Convention in this setup:
  - `WORK_FORCE_BEARER_TOKEN` → feed write
  - `WF_ENGAGEMENT_WRITE_TOKEN` → engagement write
- **Governance:** reading the decrypted secret value from Secrets Manager is an
  L0 C-4 escalation. Do not `aws secretsmanager get-secret-value` yourself
  without explicit approval — the operator supplies the token via `.env`. Never
  print a token value.

## Endpoints this skill uses

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/agents?page_size=&cursor=` | roster (lean). **Paginate** by following `cursor`/`next_cursor`. | public |
| GET | `/agents/{slug}` | full record (`role`, `about`, `jd`, `bindings`, `streams`). Some agents (e.g. `dario`) are in `internal`/`editorial` streams and **may not appear in the default list** — fetch by slug directly. | public |
| GET | `/agents/{slug}/portfolio?project_id=` | per-client engagement records (dedup check). | public |
| GET | `/skills/{name}` | skill `version` (needed for the engagement POST). `GET /skills` list often returns `items: []` because skills are git-owned. | public |
| POST | `/agents/{slug}/engagements` | register engagement (step #4). | bearer |

## Engagement POST mechanics (`POST /agents/{slug}/engagements`)

The OpenAPI spec defines **no request-body schema** — these were learned empirically:

- **Required fields:** `project_id`, `skill_name`, `skill_version`,
  `started_at`, `ended_at`, `status`. Omitting `skill_version` → `400
  {"error":"missing_fields","missing":["skill_version"]}`. Get the version from
  `GET /skills/{name}`.
- **`summary`** (top-level, NOT nested) is the deliverable text shown in the
  portfolio. _A server fix on 2026-06-13 made this persist; before that it was
  silently dropped._ If a re-post is needed to populate it, that is a new row.
- **`execution_surface`** is **forced to `client`** by the server — sending
  `operator` has no effect. (We are operator-orchestrated; the honest signal of
  that lives in the `summary` text, not this field.)
- **`status`**: `ok` | `throw` | `skipped`.
- **Append-only** — there is no `PATCH`/update. Fixing a record = a duplicate.
  Hence the dedup guard in `scripts/register_engagement.py`.
- **Skill ownership is not enforced** — an agent can be given an engagement for
  a skill it does not own (e.g. a QA-lens persona like `farah` can be credited a
  `pr-autopilot` engagement though `pr-autopilot` is owned by nadia/maya). The
  server will **also** happily accept a *retired* skill name like `pr-review` —
  that lack of validation is exactly why `register_engagement.py` rejects retired
  names client-side.

Use `scripts/register_engagement.py` — it encodes all of the above (token read,
version auto-fill, dedup guard, 401 hinting, no token printing).

## Reading the roster (step #2 helper)

```bash
# paginate the full roster, print slug | role | skills(bindings)
python3 - <<'PY'
import json,urllib.request,urllib.parse
base="https://workforce-api.kohuehara.xyz/agents"; cur=None; rows=[]
for _ in range(20):
    q={"page_size":"50"}; cur and q.update(cursor=cur)
    d=json.load(urllib.request.urlopen(base+"?"+urllib.parse.urlencode(q)))
    for a in d.get("items",[]):
        sk=sorted({b.get("skill") for b in a.get("bindings",[]) if b.get("skill")})
        rows.append((a.get("slug"),a.get("role"),",".join(sk)))
    cur=d.get("cursor") or d.get("next_cursor")
    if not cur: break
for s,r,sk in rows: print(f"{s:12}| {r:28}| {sk}")
PY
```

## The workforce's own PR skill (`nadia`/`pr-autopilot`)
`nadia` runs `pr-autopilot` autonomously every 6h: scans open PRs lacking a cycle-1
routing comment, nominates reviewers by lens (architecture=dario,
engineering=ren, design=aoi) via `config.nomination_rules`, posts a
**comment-only** routing note. Per adr-0010 (2026-06-17) `pr-autopilot` now owns
the **full** PR cycle — route → review → verdict → (delegated) merge — having
**absorbed the retired `pr-review` reviewer skill**. The autonomous CCR leg is
still routing-only; this skill's step #3 mirrors the nomination model and the
operator supplies the actual review content, **all credited to `pr-autopilot`**
(there is no separate `pr-review` skill to credit any more). **Dedup with nadia:**
before posting a routing comment, check the PR for a `pr-autopilot` routing
comment from the last 7 days so you don't double-route.
