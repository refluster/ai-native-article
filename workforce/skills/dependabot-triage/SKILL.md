---
name: dependabot-triage
description: Daily Cadence (Farah's QA lens) that triages open Dependabot security PRs on a delegated external project (e.g. PSVL/asp-cloud). Per PR it investigates the target governance + deployed-artefact reachability and either performs an R-N10 delegated-merge (CVE/GHSA-cited comment → approve → squash-merge the autopilot-eligible ones) or escalates the rest (major / 0.x-minor bumps, not-clean, critical-and-reachable) by filing a tracking issue. github.token-scoped; the bundled apply-triage.mjs re-verifies the eligibility predicate server-side and fails closed; merges happen only under all four R-N10 clauses. One engagement per fire via the runner.
---

# dependabot-triage

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> Fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner` CCR
> routine, which composes your runtime prompt from (persona `system.md` × this
> `SKILL.md` × binding `config` × project credentials). The LLM (Farah) owns the
> judgment; the bundled `apply-triage.mjs` owns every GitHub write. No AWS access
> in-session — just the one project-scoped capability credential (`github.token`).

> **Governance gate (read before you merge anything).** Merging on an external
> repo is allowed for the workforce **only** under **R-N10** (`workforce/docs/governance.md`)
> — the bounded inverse of "agents never merge". All four clauses must hold:
> (1) the target repo's own statute has delegated merge authority to you
> (asp-cloud: `docs/adr_autopilot_pr_merge.md`, the Autopilot lane); (2) the
> eligibility predicate passes; (3) the kill-switches are armed; (4) the action is
> audited. If R-N10 is not in force for the target project, you do **not** merge —
> you escalate every PR.

## Read this first (the recall packet)

The runner assembles, read-only, before you act — use the injected `github.token`
with `gh`/the GitHub REST API (read calls only here; all writes go through the script):

1. **The project + its delegation.** `project_id` and its `github.{owner,repo}` from
   the task. Confirm the target repo's statute grants you merge authority and read its
   **eligibility predicate** (asp-cloud → `docs/adr_autopilot_pr_merge.md §3.1`). If no
   such grant exists, treat every PR as escalate-only.
2. **The kill-switch.** Read the target repo variable `AUTOPILOT_PR` (`gh api repos/{owner}/{repo}/actions/variables/AUTOPILOT_PR`). If it is missing or not `on`, **skip** (see skip path).
3. **Open Dependabot security PRs.** `gh pr list --repo {owner}/{repo} --author 'app/dependabot' --state open --label security`. For each: title (the `from A to B` bump), changed files, labels, `mergeable`/`mergeStateStatus`, required check conclusions on the head SHA, and any `CHANGES_REQUESTED` review.
4. **Advisory + reachability.** For each PR's package, the GHSA/CVE + CVSS severity from `gh api repos/{owner}/{repo}/dependabot/alerts`, and the **deployed-artefact reachability** (is the dependency in a *production* dependency graph, or only dev/test/sandbox tooling that never ships?). This is the crux of the severity bound.

## Do the one thing this Cadence does

For **each** open Dependabot security PR, decide — in Farah's QA voice (precise,
evidence-first, fail-loud) — exactly one disposition, and assemble the decisions
payload the script will apply:

- **`merge`** — iff the PR satisfies **all** of the target predicate: clean Dependabot
  security update · lockfile/manifest-only (no L1-binding path) · **semver-patch or
  minor-on-≥1.0** (never a major bump or a `0.x`-minor crossing) · all required checks
  green · `mergeStateStatus == CLEAN` · severity/reachability bounded (Critical-and-
  reachable is never auto-merged) · no `CHANGES_REQUESTED`. Produce a CVE/GHSA-cited
  triage **comment** (severity, advisory links, reachability finding, "merged via
  Autopilot per adr_autopilot_pr_merge.md / workforce R-N10") and a squash subject+body
  that names the advisory id(s).
- **`escalate`** — anything failing a clause: major / `0.x`-minor bumps, non-lockfile
  changes, red/pending checks, Critical-and-reachable, or any ambiguity. Produce a
  tracking **issue** (title + body organising *why* it is held + the next human step +
  labels `security,dependencies,<area>,type:chore,priority:*`). Never merge a PR you
  escalate.

Write the payload to `/tmp/dependabot-triage-decisions.json` (schema in the script
header). One PR → one decision. Lead each comment/issue with the result, never a
machine preamble (W-1).

## The skip path — when NOT to write

Do **not** run the script (a no-op fire is correct W-4 behaviour, not an error) when
**any** of: there are no open Dependabot security PRs; `AUTOPILOT_PR` is unset/not `on`;
the target project has no R-N10 delegation. A skipped fire still self-records an
engagement (`status: skipped`) whose summary says *why* (e.g. "no open Dependabot
security PRs on PSVL/asp-cloud this cycle").

## Write — run the script, do NOT merge/comment/file by hand

Every GitHub mutation is owned by the **deterministic** `apply-triage.mjs`, which
**re-verifies the predicate server-side and fails closed** (R-N10 clause 2): it
re-checks author, state, mergeability, the file allowlist, green checks, the semver
delta, and the `AUTOPILOT_PR` switch before it will merge — so a hallucinated "eligible"
in your payload cannot cause a bad merge.

```sh
TOKEN="<credentials['github.token'] from your task>" \
  node workforce/skills/dependabot-triage/apply-triage.mjs \
    --repo "<owner>/<repo>" \
    --decisions /tmp/dependabot-triage-decisions.json \
    --skill-version "0.1.0"
```

Exit codes:
- `0` — all decisions applied (merges done, issues filed). Done.
- `2` — a decision was **refused server-side** (predicate re-check failed) or GitHub rejected a write (`401`/`403`/`422`/`405`). Read stderr; that PR stays open/un-actioned — do not retry blindly, surface it.
- `1` / `3` — bad args / network error.

The credential comes from your task's injected `credentials["github.token"]` — never
read it from anywhere else, never hard-code it.

## Engagement (per fire)

The `agent-runner` self-records **one** engagement for this fire (R-N1 audit ledger) —
you do not call `record-engagement`. Make the run summary business-level and honest,
e.g. *"Dependabot triage (PSVL/asp-cloud): merged 2 clean security patches (CVE-…,
CVE-…); escalated 1 major bump → issue #NNN."* A `skipped` fire says why.

## When NOT to use this skill

This Cadence is **security-update triage only**. It does not review feature PRs (that is
`pr-review`/`pr-route`), does not author code, and does not merge anything outside the
R-N10 delegated lane. Time-driven (non-security) Dependabot bumps are out of scope —
they are suppressed at the target's `dependabot.yml` during pilot. If a PR needs design
judgement or touches an L1-binding path, it is an `escalate`, never a `merge`.
