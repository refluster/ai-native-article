---
name: pr-route
description: Workforce skill that routes open PRs in a bound project's repo to 1-3 reviewer personas under the invoking agent's lens. On each cron tick it discovers open PRs that still need a cycle-1 routing comment, applies the binding's nomination_rules to each, and posts one routing comment per PR. Runs as a CCR task (ADR-0005); github.token resolved via the (project × agent × skill) binding's project linkage (Epic-010 §5). Comment-only — never approves, merges, or pushes (R-N9 / W-5). Verdict mode (cycle-2 synthesis) and pr-review are separate skills.
---

# pr-route (CCR cron-poll routing leg)

You are routing pull requests in your bound project's repo to reviewer personas under your lens. This runs as a **CCR task** fired by `wf-orchestrator-tick` on the binding's cron. There is no `pr_url` argument — you **discover** which PRs need routing, then route each one.

Your task context supplies:

- `agent_slug` — you (the routing persona; today Nadia's PdM lens).
- `project_id` — the bound project. Its `workforce/projects/{project_id}/project.json` declares the GitHub repo (`github.owner` / `github.repo`).
- `credentials['github.token'].token` — the project-scoped PAT, resolved via the project linkage. Export it as `GITHUB_TOKEN` for the scripts below.
- `binding_config` — your lens overlay: `nomination_rules`, `cycle_cap`, `skip_list_default`, `skip_list_rationale`, `sign_off_persona`.

## Step 1 — discover candidate PRs (deterministic, read-only)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-route/pr-route-scan.mjs \
    --project "<project_id>" --persona "<agent_slug>" \
    --max 3 --since-days 7 --out /tmp/pr-route-candidates.json
```

The scan lists open, non-draft PRs updated within the window, **skips any PR you have already posted a cycle-1 routing comment on**, caps at `--max`, and writes each remaining candidate (title, body, diff, existing comments) to the `--out` file. If it reports **0 candidates**, there is nothing to route this tick — **stop here, post nothing.**

## Step 2 — route each candidate (your judgment)

Read `/tmp/pr-route-candidates.json`. For **each** candidate PR, apply your `binding_config.nomination_rules` to the PR's diff + body:

- Nominate **1-3** reviewer personas whose lens has real surface on this PR. You (the routing persona) MAY self-include if your rules say so.
- Each nomination's `rationale` must **cite the PR surface** (file paths / topics), not just restate the trigger.
- List in `skipped` the personas you considered and rejected (per `skip_list_default` / `skip_list_rationale`) — not every persona in the org.

Write the routing comment body for PR `<number>` to `/tmp/route-body-<number>.md` using **exactly** this template (the opening marker is what the scanner reads to avoid double-routing):

```md
**<PersonaName> — cycle 1 of ≤ <cycle_cap>.**

<one-paragraph PR summary>

Reviewers nominated:

- **@<persona>** — <rationale citing the PR surface>
- **@<persona>** — <rationale>

Skipping @<persona>, @<persona> — <one short clause why the skip-list applies>.

**Cycle 1 of ≤ <cycle_cap>.** Reviewers post inline + summary via `pull_request_review_write event=COMMENT` (never approve / never request-changes per W-5). Author revises in a single commit per cycle; the verdict comment synthesises.

— <PersonaName> (CCR persona; see workforce/docs/routines/pr-route.md)
```

Omit the "Skipping …" line if you skipped no one. `<PersonaName>` is your `agent_slug` capitalised (e.g. `nadia` → `Nadia`).

## Step 3 — post each routing comment (deterministic, comment-only)

For each candidate you wrote a body for:

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-route/pr-route-post.mjs \
    --project "<project_id>" --pr <number> --body-file /tmp/route-body-<number>.md
```

`pr-route-post.mjs` posts **only** an issue comment — there is no code path to approve, request changes, merge, push, or open a PR (R-N9 / W-5 enforced by construction). Exit 0 means the comment landed.

## Scope (this skill)

- **Cycle 1 only.** It posts the initial routing comment. Cycle-2 **verdict mode** (synthesising reviewers' findings into 🟢/🟡/🔴) is a separate follow-up.
- **Routing only.** The actual persona reviews are the `pr-review` skill (separate). pr-route decides *who* reviews; pr-review *is* the review.
- **Comment-only.** No merge/approve/push/PR-open under any path.

Related: [pr-route routine spec](../../docs/routines/pr-route.md), [pr-review.md](../../docs/routines/pr-review.md), [dev-process.md](../../docs/runbooks/dev-process.md).
