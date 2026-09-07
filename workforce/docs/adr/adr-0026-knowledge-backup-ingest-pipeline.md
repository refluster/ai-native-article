# ADR-0026 — Knowledge backup is a deterministic pipeline, not a Cadence: GHA cron ingest into a knowledge-store repo

- **Status**: Proposed
- **Date**: 2026-08-29
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's direction (substrate = GitHub Actions, sink = a dedicated knowledge-store repo, Layer 2 deferred)
- **Related**: [ADR-0005](adr-0005-single-execution-model-ccr.md) (the single CCR execution model this decision draws a boundary around), [ADR-0019](adr-0019-agent-semantic-memory.md) / [ADR-0020](adr-0020-delegated-memory-curation.md) (the Layer 2 sink deferred here), `.claude/skills/cadence-forge/references/cadence-archetype.md` (the archetype whose invariants exclude this work)

## Context

`refluster/luckyhat-ms` runs a **knowledge-batch-service**: two scheduled AWS
Lambdas that crawl Discord and Notion once a day and commit the result to a
`knowledge-store` GitHub repository.

- `src/discord-scraper/discord_scraper.py` (343 lines, Python, `discord.py`)
  opens a **gateway WebSocket**, waits for `on_ready`, walks every text channel
  for a `[yesterday 00:00, today 00:00)` UTC window, and commits one JSON blob
  per run to `discord/YYYY/MM/{start}-{end}.json`.
- `src/notion-scraper/notion_scraper.py` (925 lines) walks a configured set of
  databases, renders each page to markdown at `notion/{database}/{title}.md`,
  and diffs against the store using an **MD5 content cache** plus a GitHub file
  listing, committing via the contents API in batches.

Both are **pure ETL**: no model call, no judgment, no persona. The operator
wants this capability inside `refluster/ai-native-article` as part of the agent
workforce, and asked whether the obvious CCR-driven shape is the right one.

The tempting answer is "make it a Cadence" — the workforce's named archetype
for a scheduled periodic task. It is the wrong answer, for four reasons that
the workforce's own statute already states:

1. **The archetype excludes it.** A Cadence's invariant **I1** is *LLM
   judgment*; `validate-skills.mjs:C1-cadence-executor` rejects a deterministic
   skill outright. The archetype spec's "What is NOT a Cadence" section names
   this case twice: a deterministic scraper with no judgment, and a skill whose
   deliverable is a **committed repo artefact** rather than an authenticated
   endpoint POST (invariant **I3**). A daily scrape is both.
2. **Egress.** A CCR session runs in a managed remote environment behind a host
   allowlist — the root `CLAUDE.md` already records `article-health`'s Notion
   comparison returning `403 Host not in allowlist` there. A gateway WebSocket
   to Discord is strictly more likely to be blocked than the plain HTTPS that
   already fails.
3. **Volume and determinism.** A busy day of Discord plus a Notion diff is
   megabytes of text with no summarisation step. Paying an LLM session to page
   through it buys nothing and costs context, and a non-deterministic transport
   for an *archive* is a defect: the same window must always produce the same
   bytes.
4. **ADR-0005's accepted risk.** Collapsing to a single CCR substrate was taken
   with eyes open on one consequence — "a claude.ai CCR outage or rate-limit
   stalls the whole workforce". Backups are exactly the workload that should
   not share that lane.

ADR-0005 retired the Lambda **runner** as an execution surface for *agent
tasks*; it did not claim every scheduled thing in the workforce is an agent
task. `wf-orchestrator-tick`, `memory-compactor` and `l1-source-register` are
all scheduled, deterministic, non-agent machinery that survived it. This ingest
belongs in that family, and this repo already runs six deterministic scheduled
pipelines on **GitHub Actions** (`deploy-article-site`, `podcast-pipeline`,
`weekly-content-insights`, `corpus-freshness`, `check-workforce-api-routes`,
and the R-13 `workforce-pr-terminal-sweep`).

## Decision

**Split the capability in two, and land only the first layer now.**

1. **Layer 1 — ingest — is a deterministic GitHub Actions pipeline.** Two
   dependency-free Node entry points under
   `workforce/pipeline/knowledge-backup/`, fired by one daily cron
   (`.github/workflows/knowledge-backup.yml`, 01:23 UTC), writing to a
   **dedicated `knowledge-store` repository**. No LLM, no persona, no AWS, no
   binding.
2. **Layer 2 — sense-making — is a Cadence, and is deferred.** Reading the
   day's committed log and distilling it (into agent semantic memory per
   ADR-0019/0020, a feed post, or an L1 source row) is genuine judgment over a
   read-only recall packet with an authenticated write — a textbook Cadence,
   and it satisfies every invariant that the ingest violates. It is a separate
   ADR and a separate PR. **This ADR deliberately ships a backup, not an
   insight.**

The boundary that makes both layers clean: **the pipeline owns bytes, the
Cadence owns meaning.**

### Why GitHub Actions rather than Lambda

Lambda is the lower-effort port — the Python lifts over nearly unchanged, and
`discord.bot_token` is already a registered credential type
(`lambdas/shared/credential-injector.ts`). It was rejected because the *sink is
git*: a git-writing job on a Lambda needs a PAT in Secrets Manager, a SAM
stack, and CloudWatch to read its logs, while the same job on Actions gets the
token, the retry button (`workflow_dispatch` with an explicit window) and the
logs for free. Secondarily, `workforce/lambdas/**` is TypeScript throughout; a
first Python function there is an R-N8 uniformity cost paid for nothing.

**R-N3 is satisfied, not bent.** The rule forbids per-runner GitHub Secrets
*"(CI excluded)"* — a CI workflow is the one place it already permits them.

### Rules this decision reads

- **R-N4** (bindings are the unified scheduler declaration) governs *workforce
  executions* — the `(project × agent × skill)` tuples the orchestrator
  dispatches. This pipeline declares no agent and no skill, so it is not one,
  exactly as the six existing GHA crons are not.
- **R-N2** (single state store) is untouched: the knowledge store holds
  **artefacts**, the category the rule explicitly assigns to GitHub. Nothing
  here is workforce state.
- **R-N9** (external git surface is PR-only) applies to a `PROJECT#{id}` that
  is not `self/*`. The knowledge store is the operator's own; **registering it
  as a `self/*` project is a provisioning prerequisite** of this ADR, and is
  called out in the runbook. If the operator instead registers it as an
  external project, the pipeline must open a PR per run — which would make a
  daily archive absurd, so the `self/*` registration is the intended path.

### What changes versus the luckyhat-ms original

The port is not a transcription. Four changes are load-bearing:

| | luckyhat-ms | here | why |
|---|---|---|---|
| Discord transport | `discord.py` gateway WebSocket + `on_ready` | REST `GET /channels/{id}/messages?after=` | No dependency, no WebSocket egress, no "`on_ready` never fired" hang. The window bound is converted to a snowflake, so a quiet channel costs one request. |
| Change detection | MD5 cache + a GitHub file listing + content fetch per page | git trees | Blobs → tree → commit; if the composed tree's SHA equals the parent's, **no commit is made**. Idempotency falls out of git instead of being maintained. |
| Commit shape | one commit per file (contents API) | one commit per run (git data API) | A day is one atomic revision, not N. |
| Discord output | JSON only | markdown day-log **+** JSON sidecar | The consumer is a reader or an agent holding the file as context; markdown is the reading shape, JSON stays as the lossless archive. |
| Notion paths | `notion/{db}/{title}.md` | `notion/{db}/{title}--{id8}.md` | Keying on the title alone orphaned the old file on every rename. The immutable id makes a rename a git rename. |

**C-4 / W-4 (fail loud) is explicit, not incidental.** A channel the bot cannot
read is skipped and reported — private channels are normal. *Every* channel
returning 403 throws, because that is a broken token, and the failure mode to
prevent is committing an empty day that looks like a quiet one. A genuinely
empty window commits nothing at all rather than an empty artefact.

## Alternatives considered

- **A CCR Cadence that runs the scrape (the operator's opening hypothesis).**
  Mechanically expressible — the session would just invoke a bundled script —
  but it violates cadence invariants I1 and I3, inherits the host allowlist,
  and puts an archive on the workforce's single throughput lane. **Rejected for
  ingest, adopted for Layer 2**, where the judgment is real.
- **Lift-and-shift the Python Lambdas into `workforce/lambdas` + SAM.** Lowest
  port cost, highest standing operational cost (a new SAM stack, the first
  Python in a TypeScript tree, a PAT in Secrets Manager to write git).
  Rejected — see above.
- **Commit into `ai-native-article` itself** (e.g. `workforce/knowledge/`).
  Avoids a second repo and sidesteps R-N9 entirely, but buries a daily
  machine-generated commit stream in the history of a repo whose CI, deploy
  triggers and PR review all assume human-scale diffs. Rejected by the operator
  in favour of the dedicated store.
- **Keep Discord's JSON-only output.** Cheaper, and lossless. Rejected as the
  *primary* artefact only — it is retained as the sidecar, so nothing is lost.

## Consequences

- **Positive.** The backup runs on a substrate matched to its sink, with no
  AWS surface, no dependencies, and no LLM cost. Re-running any window is
  idempotent, so a backfill is safe. The Cadence archetype keeps its meaning:
  "scheduled" did not become the definition of "agent task".
- **Two schedule mechanisms coexist** — EventBridge bindings for agent tasks,
  GHA cron for deterministic pipelines. This is the status quo (six such crons
  already), not a new axis, but it is the thing to re-read if R-N4 is ever
  tightened.
- **Provisioning is required before the first real run.** Until
  `vars.KNOWLEDGE_STORE_REPO` is set the workflow no-ops with a notice rather
  than failing daily; the store repo, the PAT, and the `self/*` project
  registration are operator steps (runbook:
  `workforce/pipeline/knowledge-backup/README.md`).
- **Deferred, and named so it is not forgotten.** Layer 2 (the Cadence over the
  store) and Notion database-scoping (today the ingest backs up everything the
  integration can see) are both open follow-ups.
- **Accepted limitation — archived threads and edit history.** The day-log
  captures live conversation in a window; a message edited after its day has
  closed is not re-archived, and archived threads are out of scope. Widening
  either is a re-scrape, which the idempotent commit path already supports.

## Related

- `workforce/pipeline/knowledge-backup/` — the implementation and its runbook.
- `.github/workflows/knowledge-backup.yml` — the daily cron.
- [ADR-0005](adr-0005-single-execution-model-ccr.md) — the single CCR model,
  and the "single throughput lane" risk this pipeline deliberately stays off.
- `.claude/skills/cadence-forge/references/cadence-archetype.md` — invariants
  I1/I3 and the "What is NOT a Cadence" list this decision leans on.
- `refluster/luckyhat-ms:knowledge-batch-service/` — the origin service.
