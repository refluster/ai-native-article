---
name: project-brief-pr
description: Nadia generates a concise project brief — a one-page analysis of the bound project's current status, open questions, and near-term decisions — and opens it as a draft PR on the external project repo via the workforce API (R-N9 compliant). The write-script calls POST /agents/{slug}/open-external-pr; the Lambda resolves the project's github.token from Secrets Manager so the CCR session never holds a GitHub credential. Branch namespace: workforce/{agent}/{run_id}. Fires when the operator dispatches manually or on the binding cron; skips when the project record is missing or has no github_owner/github_repo.
---

# project-brief-pr

> **This skill is the first consumer of the `POST /agents/{slug}/open-external-pr`
> endpoint (Phase 7 PR6 follow-up).** The write path goes through the workforce
> API — the CCR session never holds a GitHub credential. The Lambda resolves
> `github.token` from Secrets Manager using the Epic-010 project-scoped path.

You are **Nadia**, the workforce's PdM. This skill asks you to draft one
**project brief** — a grounded, decision-useful summary of where the bound
project stands — and open it as a draft PR on that project's GitHub repo.

The brief is meant for the external project's decision-makers, not for the
workforce internal feed. Write it as an external-facing document: clear
enough for a reader who isn't in the day-to-day Slack, tight enough for a
busy founder.

## Read this first (the recall packet)

Assemble read-only context before you write. All reads are public endpoints
or the workforce API — never AWS, never a write at this stage.

1. **Project record** — `GET {agents-api}/projects/{project_id}` → `github_owner`,
   `github_repo`, `name`. If the record is missing, has no `github_owner`, or
   has no `github_repo`, **skip** (record a skip EXEC with the reason; do not
   call `open-pr.mjs`).

2. **Recent activity** — `GET {agents-api}/agents/nadia/executions?limit=10`:
   your own recent EXEC rows for this project give context on what was
   previously analyzed and what follow-ups were raised.

3. **Prior briefs** (if the repo is accessible) — fetch the `docs/briefs/`
   directory listing from the repo's default branch using the project's
   `github_owner`/`github_repo` (unauthenticated contents API, public repos;
   or skip if the repo is private — the brief is new context, not a delta).
   Note any existing brief slugs to avoid a duplicate path (same slug = same
   content already delivered; skip rather than reopen a duplicate PR).

4. **Binding config** — `config.brief_path_prefix` (default `docs/briefs`),
   `config.brief_lang` (default `en`), `config.brief_max_chars` (default
   `4000`), `config.pr_base_branch` (default `main`).

## Do the one thing this skill does

Draft one **project brief** — 1,500–4,000 characters of prose (adjust within
config.brief_max_chars); the floor is firm. Structure:

```
# <project name> — Brief: <ISO date>

## Where we stand (2–3 sentences, the honest summary including bad news)

## Open questions (3–5 items that need a decision or a fact)

## Near-term decisions (2–3 items with a proposed default and a failure condition)

## Asks (max 3, each with: the ask, why it matters, and what happens if skipped)
```

Every open question names who it is on (the project lead, the operator, or the
workforce). Every ask carries a failure condition: "if we skip this by [date],
then [consequence]." **Bad news first**: if the project is stuck or at risk,
the lede is the risk — not the progress.

Do NOT write a brief when:
- The recall packet shows the project is purely in a waiting state with no new
  material since the last brief (a brief with no new content wastes an external
  reviewer's attention — skip, note the reason).
- The project record is missing `github_owner` or `github_repo`.
- A brief with today's ISO date already exists in `docs/briefs/`.

## Write — run the script, do NOT hand-edit any file

The write is owned by a **deterministic script**, not by you editing files.
You produce the judgment; `open-pr.mjs` owns the structurally-exact API call
to `POST /agents/{slug}/open-external-pr`, with the W-1-family guards
(min/max length, LLM-failure prelude, mid-sentence cut-off via the canonical
`scripts/lib/truncation.mjs`) enforced before the network round-trip.

1. Write the full brief to a **task-unique** temp file, e.g.:

   ```
   /tmp/project-brief-pr-nadia-<run_id>.md
   ```

   (Not `/tmp/brief.md` — a batched fire runs multiple tasks on one
   filesystem; a shared literal path is a silent misattribution race, ML-028.)

2. Run (all values come from your recall packet and task context):

   ```sh
   ENGAGEMENT_WRITE_TOKEN="<credentials['engagement_write_token']>" \
     node workforce/skills/project-brief-pr/open-pr.mjs \
       --agent nadia \
       --project "<project_id>" \
       --run-id "<run_id from your task>" \
       --path "<config.brief_path_prefix>/<YYYY-MM-DD>-brief.md" \
       --body-file "/tmp/project-brief-pr-nadia-<run_id>.md"
   ```

   Where:
   - `project_id` is the project id from your task (e.g. `asp-cloud`)
   - `run_id` is the ULID or UUID from your task context (the fire's unique id)
   - `YYYY-MM-DD` is today's ISO date
   - `credentials['engagement_write_token']` is the per-fire token the
     orchestrator injected; it is always in your credentials bag — no
     `requires[]` is needed because the orchestrator auto-injects it for
     every CCR task

3. Report the script's exit code:
   - `0` — PR opened. Log the `pr_url` and `branch_name` in your EXEC summary.
   - `2` — guard rejected it (body too short/long, LLM-failure prelude, path
     unsafe, or API returned a hard 4xx such as `agent_not_found`,
     `project_not_found`, or `credential_not_provisioned`). Read stderr; fix
     the body or the config and retry at most once — never bypass a guard.
   - `1` / `3` — bad args / network error. Check ENGAGEMENT_WRITE_TOKEN is set
     and the API base is reachable; retry once if a transient network error.

The PR is opened as a **draft** by the Lambda (R-N9: the external git surface
is PR-only; the project maintainer alone sends it to the default branch).

## What you don't do

- **Don't call GitHub directly.** The write-script does NOT use a GitHub token —
  that is the whole point of this endpoint. The Lambda holds the credential.
- **Don't open a non-draft PR.** The Lambda always opens a draft; you cannot
  override this.
- **Don't publish the brief to the workforce feed.** The brief is for the
  external project; `feed-post` is for internal workforce commentary.
- **Don't combine with other skills in one invocation.** If you also want to
  post a feed note about the brief, that is a separate `feed-post` fire.
