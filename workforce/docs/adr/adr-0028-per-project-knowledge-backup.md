# ADR-0028 — The knowledge backup is scoped per Project, not per workforce

- **Status**: Proposed
- **Date**: 2026-08-30
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's direction (「プロジェクトとNotionは1:1で関係し、プロジェクトとDiscordも1:1で関係する前提とする」)
- **Related**: [ADR-0026](adr-0026-knowledge-backup-ingest-pipeline.md) (the pipeline this refines — its substrate, determinism and two-layer split are unchanged), [Epic-010](../epics/epic-010-project-trust-boundary.md) §3/§5 (the Project trust boundary and the credential-type registry this leans on)

## Context

[ADR-0026](adr-0026-knowledge-backup-ingest-pipeline.md) shipped the ingest
pipeline against **one** destination: a repository variable
`KNOWLEDGE_STORE_REPO` plus three workforce-wide secrets
(`DISCORD_BOT_TOKEN`, `DISCORD_SERVER_ID`, `NOTION_API_KEY`). That shape has one
Discord guild, one Notion workspace, and one store, for the whole workforce.

The operator's actual model is different, and it is the one the repository
already encodes everywhere else:

> A project relates 1:1 to a Notion workspace, and 1:1 to a Discord guild —
> because each project has its own community and its own way of communicating.

The workforce already models exactly this. `Project` is *the* trust boundary for
credentials, executions and artefacts (Epic-010 §3): one directory per project
under `workforce/projects/{id}/` holding `project.json`, a scoped credential bag
at `wf/projects/{id}/{type}`, its own EXEC ledger, its own S3 prefix. The
registry is live and populated — `agent-workforce`, `asp-cloud`, `conference`,
`luckyhat`, `project-ind`, `smartmeter-data-analysis` — and `luckyhat` already
declares `discord.bot_token` in its own bag, with a `note` that spells out the
reasoning: a bot token is strictly more powerful than a webhook URL, so it lives
behind its own boundary rather than in the shared `agent-workforce` bag.

ADR-0026's pipeline ignored all of that. Three consequences, in increasing
severity:

1. **It cannot express the operator's model at all.** Two communities means two
   guilds and two workspaces; the pipeline has room for one of each.
2. **It collapses the trust boundary the workforce spent an epic establishing.**
   One `DISCORD_BOT_TOKEN` secret means one bot token reachable by every backup
   run — precisely the "a bot token has no business being reachable from
   elsewhere" argument `luckyhat/project.json` makes, inverted.
3. **A silent mis-archive is possible.** With a single global destination there
   is nothing to disagree with, so nothing detects one community's log landing in
   another's store.

## Decision

**Make the Project the unit of configuration. Each project declares its own
store repo and its own sources; a project that declares nothing is not backed
up.**

1. **Config lives at `workforce/projects/{id}/knowledge-backup.json`** — a
   *sibling* of `project.json`, not a new block inside it:

   ```jsonc
   {
     "project_id": "luckyhat",
     "store": { "owner": "refluster", "repo": "knowledge-store-luckyhat" },
     "sources": { "discord": { "server_id": "1234…" }, "notion": {} },
     "status": "active"
   }
   ```

   Sibling, because `project.json`'s own schema declares it the creation-time
   seed for the DDB `PROJECT#{id}/META` row that `seed-projects.mjs` writes and
   the console renders. A GitHub-Actions-only concern has no business travelling
   into that row. Same directory means the same trust boundary without the
   coupling — and no change to a schema with existing consumers.

   `sources.notion` is deliberately an empty object: Notion exposes no
   non-secret scope selector, so the integration token *is* the scope. Presence
   enables the source; the operator widens or narrows it by sharing pages with
   that project's integration.

2. **Credentials are derived, never named in the config.** One convention —
   project id upper-cased, `-` → `_`:

   | secret | needed when |
   |---|---|
   | `KB_{PROJECT}_STORE_TOKEN` | always |
   | `KB_{PROJECT}_DISCORD_BOT_TOKEN` | `sources.discord` declared |
   | `KB_{PROJECT}_NOTION_API_KEY` | `sources.notion` declared |

   One rule to audit rather than N author-chosen strings, and a config file
   never hints at where credential material lives. (R-N3 is unchanged: it
   excludes CI from its per-runner-secret prohibition, which is the carve-out
   ADR-0026 already relies on.)

3. **The workflow discovers, then fans out.** A `discover` job runs
   `plan.mjs`, which loads and **validates** every config and emits one matrix
   row per `(project × source)`. Rows carry secret *names*; the workflow
   resolves values through the `secrets` context. `fail-fast: false` — one
   project's outage must not cancel every other project's backup.

4. **Each job holds exactly one project's two credentials.** The trust boundary
   is enforced by the fan-out, not by convention: a `luckyhat` job cannot see
   `conference`'s bot token because it is never put in its environment.

5. **`--project` is required; there is no implicit default.** A backup that
   guesses its destination is the failure mode worth designing out.

### What this does not change

ADR-0026's load-bearing decisions all stand: GitHub Actions as the substrate
(the sink is git), deterministic ingest with no LLM, the pipeline-vs-Cadence
boundary, one commit per run via the git data API with no-op-on-unchanged-tree,
the markdown-plus-JSON Discord day-log, and the deferral of Layer 2. This ADR
refines *where the bytes go*, not *how they are produced*.

## Alternatives considered

- **Extend `project.json` with a `knowledge_backup` block.** Fewer files, and
  the config would ride the existing validator. **Rejected**: it pushes a
  GHA-pipeline concern into the DDB `PROJECT#{id}/META` row and the console,
  and it changes a schema (`additionalProperties: false`) with several existing
  consumers, for no gain the sibling file does not already give.
- **One store repo with a per-project top-level directory.** Half the repos to
  create, and cross-project search would work out of the box. **Rejected by the
  operator's premise**: communities differ, and a single store means a single
  PAT that can write every community's archive — the same boundary collapse this
  ADR exists to fix. It also forces one access-control decision (who can read
  the store) across communities that may not share one.
- **Derive the guild id from the project's credential bag at runtime.** Would
  remove `server_id` from the config. **Rejected**: a guild id is not a secret,
  and putting a non-secret in a secret is how a secret becomes hard to audit.
  It would also need AWS credentials the runner deliberately does not have.
- **Keep a workforce-wide fallback for projects that declare nothing.** Rejected
  — an implicit default destination is exactly the silent mis-archive risk;
  absence of a config is the opt-out, and it is loud.

## Consequences

- **Positive.** The pipeline can express the operator's actual model. The
  credential blast radius per run drops from "every community" to "one". Adding
  a community is a config file plus its own secrets, with no code change.
  Validation happens in `discover`, before any credential is injected.
- **Migration is a no-op.** ADR-0026 shipped with `KNOWLEDGE_STORE_REPO`
  unset, so the pipeline has never run. There is no data to move and no store
  to re-point; the old global variable and secrets are simply never read again.
  The operator provisions per project from scratch.
- **More secrets to manage** — up to three per project rather than four total.
  This is the cost of the boundary, and the naming convention is what keeps it
  auditable. If the count becomes unwieldy, the follow-up is a single
  Secrets-Manager-backed resolver, not a shared token.
- **The skip-until-provisioned path is per project.** A project whose secrets
  are absent is skipped with a notice rather than failing the cron. That is a
  deliberate softening of C-4 at exactly one point — the un-provisioned state —
  and it is the same posture ADR-0026 took for the global variable. A revoked
  secret therefore reads as "not provisioned" and skips silently; the mitigation
  is the job summary that `discover` writes on every run, which lists what was
  planned.
- **Open follow-up.** Per-database Notion scoping (today the integration's
  sharing settings are the only filter) and Layer 2 both remain open.

## Related

- `workforce/pipeline/knowledge-backup/` — the implementation and its runbook.
- `workforce/pipeline/knowledge-backup/lib/projects.mjs` — the config loader,
  validator and the secret-name convention.
- `workforce/pipeline/knowledge-backup/plan.mjs` — the discover/fan-out planner.
- `.github/workflows/knowledge-backup.yml` — the daily cron and the matrix.
- `workforce/projects/README.md` — the Project trust boundary this rides.
