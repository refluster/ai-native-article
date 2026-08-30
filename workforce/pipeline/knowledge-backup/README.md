# knowledge-backup — Discord + Notion → per-project knowledge stores

Deterministic daily ingest (Layer 1 of
[ADR-0026](../../docs/adr/adr-0026-knowledge-backup-ingest-pipeline.md), scoped
per project by [ADR-0027](../../docs/adr/adr-0027-per-project-knowledge-backup.md)).
Ported from `refluster/luckyhat-ms:knowledge-batch-service/`.

**No LLM, no persona, no binding, no AWS.** This is a pipeline, not a Cadence —
see ADR-0026 for why a scheduled scrape is deliberately *not* an agent task. The
sense-making layer that reads what this writes is a separate, deferred decision.

**The unit of configuration is the Project.** A Discord guild and a Notion
workspace belong to a community, and a community is a `PROJECT#{id}` — its own
credential bag, its own trust boundary. So each project declares its own store
repo and its own sources; there is no workforce-wide destination.

```
GitHub Actions cron (01:23 UTC)
  └── discover ── reads every workforce/projects/*/knowledge-backup.json
        │          (validates them; a bad config fails here, by name)
        └── matrix: one job per (project × source), fail-fast: false
              ├── luckyhat · discord ──> refluster/knowledge-store-luckyhat
              ├── luckyhat · notion  ──> refluster/knowledge-store-luckyhat
              └── conference · discord ──> refluster/knowledge-store-conference
```

Each job holds **only that project's two credentials**.

## Store layout (per store repo)

```
discord/YYYY/MM/YYYY-MM-DD.md        day-log (the reading artefact)
discord/raw/YYYY/MM/YYYY-MM-DD.json  lossless sidecar
notion/{parent}/{title}--{id8}.md    page mirror, path stable across renames
```

Discord is **day-partitioned** (a log: what was said on a date). Notion is a
**mirror** (a page keeps one path, so the store's git history *is* the page's
edit history).

## Onboarding a project

1. **Create the store repo**, e.g. `refluster/knowledge-store-luckyhat`. Private
   is fine.
2. **Register it as a `self/*` project.** R-N9 forces PR-only writes for
   *external* project repos, which would make a daily archive absurd. The store
   is the operator's own surface — register it accordingly.
3. **Add `workforce/projects/{id}/knowledge-backup.json`** beside the existing
   `project.json`:

   ```jsonc
   {
     "project_id": "luckyhat",              // MUST equal the directory name
     "store": {
       "owner": "refluster",
       "repo": "knowledge-store-luckyhat",
       "branch": "main"                     // optional, defaults to main
     },
     "sources": {
       "discord": { "server_id": "123456789012345678" },
       "notion": {}                         // presence enables it; see below
     },
     "status": "active",                    // or "paused" to stop the runs
     "note": "Community archive for the LuckyHat Discord + its Notion wiki."
   }
   ```

   A project **without** this file is not backed up — absence is the opt-out.
   `sources.notion` is deliberately an empty object: Notion has no non-secret
   scope selector, so the integration token *is* the scope.

4. **Add the project's secrets.** Names are derived from the project id — id
   upper-cased, `-` → `_` — so there is one rule to audit rather than N
   author-chosen strings, and no config file ever hints at credential material:

   | secret | needed when | what |
   |---|---|---|
   | `KB_{PROJECT}_STORE_TOKEN` | always | fine-grained PAT, `contents: write` on that project's store repo only |
   | `KB_{PROJECT}_DISCORD_BOT_TOKEN` | `sources.discord` | bot token; the **Message Content** privileged intent must be enabled and the bot must be in that guild |
   | `KB_{PROJECT}_NOTION_API_KEY` | `sources.notion` | integration token; it sees only the pages shared with it |

   For `luckyhat` that is `KB_LUCKYHAT_STORE_TOKEN`, `KB_LUCKYHAT_DISCORD_BOT_TOKEN`, …

A project whose secrets are not set yet is **skipped with a notice**, so adding
the config before the credentials does not turn the daily cron red. Every other
misconfiguration fails loud.

Notion access is the operator's lever: share a page or database with that
project's integration to include it, unshare to exclude it. The pipeline has no
allow/deny list of its own.

## Running by hand

Both scripts default to the previous whole UTC day, so a plain invocation is
what the cron does. `--project` is required — there is no implicit default.

```sh
# What would run tonight, and where each project lands
node workforce/pipeline/knowledge-backup/plan.mjs --human

export KB_LUCKYHAT_STORE_TOKEN=github_pat_...
export KB_LUCKYHAT_DISCORD_BOT_TOKEN=...

# yesterday, for one project
node workforce/pipeline/knowledge-backup/backup-discord.mjs --project luckyhat

# a specific window (compact form, as in the luckyhat-ms runbooks, or ISO-8601)
node workforce/pipeline/knowledge-backup/backup-discord.mjs --project luckyhat \
  --since 20260828T130000 --until 20260828T190000

# see what would be written without touching the store
node workforce/pipeline/knowledge-backup/backup-notion.mjs --project luckyhat --dry-run
```

From the Actions tab, `workflow_dispatch` takes `project` (omit for all),
`since`, `until` and `dry_run` — that is the backfill path.

**Backfilling is safe.** A commit is only made when the composed git tree
differs from HEAD, so re-running a window that is already archived writes
nothing. Loop the day over `--since`/`--until` for a range.

## Failure modes

| symptom | meaning |
|---|---|
| `--project <id> is required` | the scripts never guess a project |
| `project "X" has no knowledge-backup.json` | that project has not opted in |
| `project_id "A" must equal the parent directory name "B"` | the copy-paste that would have backed one community up into another's store |
| `missing required environment variable KB_X_...` | the secret is absent in a local run (in CI this is the skip-with-notice path) |
| `every one of the N channels returned 403/401` | that project's bot token is invalid, or the bot was never added to the guild. **Fails loud on purpose**: the alternative is committing an empty day that looks like a quiet one |
| `skipped N channel(s) the bot cannot read` | normal — private channels the integration was never invited to |
| `no messages in window — nothing to commit` | a genuinely quiet day. No empty artefact is written |
| `no commit — content identical to HEAD` | this window was already archived |
| `backup paused — skipping` | that project's config says `"status": "paused"` |

One project failing does not cancel the others (`fail-fast: false`), but it does
turn the workflow red.

## Tests

Pure logic (windowing, rendering, path derivation, per-project config) and the
commit path (via a stubbed `fetch`) are covered. Every `knowledge-backup.json`
checked into `workforce/projects/` is validated by the suite, so a malformed one
turns CI red like any other defect:

```sh
npm run test:scripts
```

## Known gaps

- **Notion scope is "everything that project's integration can see."** Per-database
  scoping is an open follow-up; today the sharing settings are the filter.
- **Late edits are not re-archived.** A Discord message edited after its day
  closed keeps the body captured at scrape time. A re-scrape of that window
  fixes it and is idempotent.
- **Archived threads are out of scope** — active threads only.
