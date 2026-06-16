---
name: pr-route
description: Workforce skill that routes open PRs in a bound project's repo to 1-3 reviewer personas under the invoking agent's lens, then synthesises the verdict. Cycle 1 — discover open PRs needing routing, apply the binding's nomination_rules, post one routing comment each. Cycle 2 (verdict mode) — read the reviewers' findings, post a 🟢/🟡/🔴 verdict; and on a 🟢 verdict for an R-N10 *safe-class* PR (a delegated-merge-eligible Dependabot security PR, predicate-passing) merge it via the shared fail-closed pr-merge.mjs engine. Review/routing generalise to all PRs; autonomous merge stays gated to the R-N10 safe class — every other PR is comment-only (R-N9 / W-5). Runs as a CCR task (ADR-0005); github.token via the binding's project linkage (Epic-010 §5).
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

`pr-route-post.mjs` posts **only** an issue comment — there is no code path in *that* script to approve, request changes, merge, push, or open a PR (R-N9 / W-5). Exit 0 means the comment landed. (The bounded R-N10 merge in Step 4 goes through a separate, fail-closed script — never through `pr-route-post.mjs`.)

## Step 4 — cycle-2 verdict mode (+ bounded R-N10 safe-class merge)

Cycle 2 fires for a PR whose reviewers (the `pr-review` personas you nominated in cycle 1) have posted. You **synthesise**, you do not re-review.

1. **Discover PRs awaiting a verdict** — open PRs that carry your cycle-1 routing comment and ≥1 reviewer review, but no verdict comment yet (same `pr-route-scan.mjs` discovery discipline; skip those you've already verdicted).
2. **Synthesise the verdict** (your judgment): read the reviewers' findings + the author's response commits, and decide one of **🟢 (ship)** / **🟡 (ship after the noted fixes)** / **🔴 (do not ship)**. Write a verdict comment that names each reviewer's load-bearing finding and how it resolved, then post it with `pr-route-post.mjs` (Step 3's script — comment-only).

### The merge leg — only for an R-N10 *safe-class* PR

Autonomous merge is **gated to the R-N10 safe class** — review generalises to every PR, merge does not. Do **not** emit a merge for a feature/code PR even on 🟢; that stays a human merge. Emit a merge **only** when *all* hold (otherwise: verdict comment only, hand off):

- Your verdict is **🟢**, and
- the bound `project_id` has an **R-N10 delegation** (the target repo's own statute grants the workforce autonomous-merge authority — e.g. `PSVL/asp-cloud` → `docs/adr_autopilot_pr_merge.md`; if none, never merge), and
- the PR is in the **delegated predicate class** — a clean Dependabot **security-update** PR, lockfile/manifest-only (no L1-binding path), semver-patch or minor-on-≥1.0, all checks green, no `CHANGES_REQUESTED`, and the target's `AUTOPILOT_PR` kill-switch is `on`.

When those hold, build the decisions payload (schema in the script header) — one `{ pr, action:"merge", comment, squash_subject, squash_body }` with a **CVE/GHSA-cited** comment — and run the **shared** merge engine:

```sh
TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-route/pr-merge.mjs \
    --repo "<owner>/<repo>" --decisions /tmp/pr-merge-decisions.json
```

`pr-merge.mjs` is the same fail-closed engine the `dependabot-triage` Cadence uses: it **re-verifies the full R-N10 predicate server-side** (author, state, mergeability, file allowlist, semver delta, green checks, `AUTOPILOT_PR`) and **refuses** any merge that does not pass — so a mis-judged "🟢 + eligible" cannot cause a bad merge. Exit `2` = a decision was refused server-side or GitHub rejected the write; surface it, do not retry blindly. For anything outside the safe class, you emit **no** merge decision — the verdict comment is the deliverable and a human merges.

## Scope (this skill)

- **Cycles 1 → 2.** Cycle 1 routes; cycle 2 synthesises the 🟢/🟡/🔴 verdict and, for an R-N10 safe-class PR only, performs the bounded delegated merge.
- **Routing, not reviewing.** The actual persona reviews are the `pr-review` skill (separate). pr-route decides *who* reviews and *what the verdict is*; pr-review *is* the review.
- **Merge is the bounded R-N10 exception only.** No merge/approve outside the safe-class lane; no push or PR-open under any path. Every non-safe-class PR is comment-only (R-N9 / W-5).

Related: [pr-route routine spec](../../docs/routines/pr-route.md), [pr-review.md](../../docs/routines/pr-review.md), [R-N10 governance](../../docs/governance.md), [dependabot-triage](../dependabot-triage/SKILL.md) (the no-review fast path sharing `pr-merge.mjs`), [dev-process.md](../../docs/runbooks/dev-process.md).
