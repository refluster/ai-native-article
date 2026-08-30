# knowledge-backup — Discord + Notion → knowledge-store

Deterministic daily ingest (Layer 1 of
[ADR-0026](../../docs/adr/adr-0026-knowledge-backup-ingest-pipeline.md)). Ported
from `refluster/luckyhat-ms:knowledge-batch-service/`.

**No LLM, no persona, no binding, no AWS.** This is a pipeline, not a Cadence —
see the ADR for why a scheduled scrape is deliberately *not* an agent task. The
sense-making layer that reads what this writes is a separate, deferred decision.

```
GitHub Actions cron (01:23 UTC)
  ├── backup-discord.mjs  ── Discord REST ──┐
  └── backup-notion.mjs   ── Notion  API ───┤
                                            └──> one commit per run
                                                 into $KNOWLEDGE_STORE_REPO
```

## Store layout

```
discord/YYYY/MM/YYYY-MM-DD.md        day-log (the reading artefact)
discord/raw/YYYY/MM/YYYY-MM-DD.json  lossless sidecar
notion/{parent}/{title}--{id8}.md    page mirror, path stable across renames
```

Discord is **day-partitioned** (a log: what was said on a date). Notion is a
**mirror** (a page keeps one path, so the store's git history *is* the page's
edit history).

## Provisioning (operator, one-time)

1. **Create the store repo**, e.g. `refluster/knowledge-store`. Private is fine.
2. **Register it as a `self/*` project.** R-N9 forces PR-only writes for
   *external* project repos, which would make a daily archive absurd. The store
   is the operator's own surface — register it accordingly.
3. **Repository variable** on `refluster/ai-native-article`:
   `KNOWLEDGE_STORE_REPO` = `owner/name`. Until this is set the workflow no-ops
   with a notice, so the cron is not red before the store exists.
4. **Repository secrets**:
   | secret | what |
   |---|---|
   | `KNOWLEDGE_STORE_TOKEN` | fine-grained PAT, `contents: write` on the store repo only |
   | `DISCORD_BOT_TOKEN` | bot token; the **Message Content** privileged intent must be enabled, and the bot must be in the guild |
   | `DISCORD_SERVER_ID` | guild id |
   | `NOTION_API_KEY` | integration token; it sees only pages explicitly shared with it |

Notion access is deliberately the operator's lever: share a page or database
with the integration to include it, unshare to exclude it. The pipeline has no
allow/deny list of its own.

## Running by hand

Both scripts default to the previous whole UTC day, so a plain invocation is
the same thing the cron does.

```sh
export KNOWLEDGE_REPO=owner/knowledge-store
export KNOWLEDGE_REPO_TOKEN=github_pat_...

# yesterday
node workforce/pipeline/knowledge-backup/backup-discord.mjs

# a specific window (compact form, as in the luckyhat-ms runbooks, or ISO-8601)
node workforce/pipeline/knowledge-backup/backup-discord.mjs \
  --since 20260828T130000 --until 20260828T190000

# see what would be written without touching the store
node workforce/pipeline/knowledge-backup/backup-notion.mjs --dry-run
```

From the Actions tab, `workflow_dispatch` takes the same `since` / `until` /
`dry_run` inputs — that is the backfill path.

**Backfilling is safe.** A commit is only made when the composed git tree
differs from HEAD, so re-running a window that is already archived writes
nothing. Loop the day over `--since`/`--until` for a range.

## Failure modes

| symptom | meaning |
|---|---|
| `missing required environment variable X` | provisioning gap — see the table above |
| `every one of the N channels returned 403/401` | the bot token is invalid, or the bot was never added to the guild. **Fails loud on purpose**: the alternative is committing an empty day that looks like a quiet one |
| `skipped N channel(s) the bot cannot read` | normal — private channels the integration was never invited to |
| `no messages in window — nothing to commit` | a genuinely quiet day. No empty artefact is written |
| `no commit — content identical to HEAD` | this window was already archived |
| `HTTP 429` after retries | sustained rate limiting; both clients honour `Retry-After` and back off, so this means the upstream is degraded |

## Tests

Pure logic (windowing, rendering, path derivation) and the commit path (via a
stubbed `fetch`) are covered:

```sh
npm run test:scripts
```

## Known gaps

- **Notion scope is "everything the integration can see."** Per-database
  scoping is an open follow-up; today the sharing settings are the filter.
- **Late edits are not re-archived.** A Discord message edited after its day
  closed keeps the body captured at scrape time. A re-scrape of that window
  fixes it and is idempotent.
- **Archived threads are out of scope** — active threads only.
