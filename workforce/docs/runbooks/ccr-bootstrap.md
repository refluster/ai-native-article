# Runbook — CCR routine bootstrap — **partially superseded**

> **Status (2026-05-27)**: the **label-driven state machine** described below was retired by the simplified dev process in [dev-process.md](dev-process.md). The repo now has **0 labels** — the agent holding `pr-autopilot` routes via PR comments per [pr-autopilot SKILL.md](../../skills/pr-autopilot/SKILL.md), which now also owns the reviewer-lens contract (the separate `pr-review` skill was retired), applied per nominated persona under their binding `config`, not by labels.
>
> The **CCR routine creation steps** below (how to paste a prompt into claude.ai/code/routines, where to store API tokens, etc.) are still accurate as a reference for ANY CCR routine you instantiate. The label-driven setup section was removed (FU-014, PR #859); ignore the label-triggered routine configs (Routines 2/3 triggers and the composition diagram) still below; use the per-routine specs at [routines/](../routines/) as the canonical prompts.

How the operator instantiates the three Claude Code Routines (CCR) that
back the engineering + review chain introduced in PR C of the Phase 5
series. See [bindings.md](bindings.md) for the binding-shape rationale.

The routines live in the **operator's claude.ai account** — not in the
repository, not in AWS. The repo holds the *specification* (`routine_spec`
markdown); this runbook walks the operator from spec → live routine.

## Pre-flight

1. **Claude subscription**. CCR requires Pro / Max / Team / Enterprise. Free won't see the routines surface at [claude.ai/code/routines](https://claude.ai/code/routines).
2. **Claude GitHub App** installed on `refluster/ai-native-article`. Required for GitHub-event-triggered routines (dario-review, aoi-review). The trigger setup will prompt you to install if missing.
3. **GitHub access** for cloning the repo from CCR. `web-setup` in the CLI (or the equivalent prompt in the web UI) grants repo cloning access. *Note*: `web-setup` does NOT install the GitHub App — that's a separate step prompted by the GitHub-event trigger setup.
4. **PR A merged** ([#100](https://github.com/refluster/ai-native-article/pull/100)) — the unified binding shape that these routines reference.
5. **PR B merged** ([#101](https://github.com/refluster/ai-native-article/pull/101)) — Maya's `pdm-decompose` skill that produces the issues these routines consume (the `wf:ready` label itself is retired).

## Routine 1 — `wf-dario-implement`

See [routines/dario-implement.md](../routines/dario-implement.md) for the full spec.

### Steps

1. Visit [claude.ai/code/routines](https://claude.ai/code/routines) → **New routine** → **Remote**
2. **Name**: `wf-dario-implement`
3. **Model**: `claude-opus-4-7` (or `claude-sonnet-4-6` if subscription headroom is tight — note in PR descriptions which model produced the work)
4. **Prompt**: copy the entire `## Prompt` section from [dario-implement.md](../routines/dario-implement.md) into the instruction box
5. **Repository**: `refluster/ai-native-article`. Branch push setting: **default** (`claude/`-prefixed only — do NOT enable Unrestricted)
6. **Environment**: Default cloud env, **Trusted** network access. No env vars
7. **Connectors**: keep only the GitHub MCP connector. Remove all others
8. **Permissions**: leave "Allow unrestricted branch pushes" OFF
9. **Triggers**:
   - **Schedule**: select `Hourly` preset
   - (Optional) **API**: click "Add another trigger" → API → save the routine first → return to copy the URL and generate a token

### Token storage (only if API trigger added)

When you generate the API token, it's shown ONCE. Store it immediately in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name wf/ccr/dario-implement \
  --secret-string '{"url":"https://api.anthropic.com/v1/claude_code/routines/trig_XXX/fire","token":"sk-ant-oat01-XXX"}' \
  --region us-west-2
```

The future revision of `pdm-decompose` that fires this endpoint will read from this secret.

### Verify

Click **Run now** on the routine's detail page. Confirm the session:
- Lists open issues (the retired `wf:ready` label no longer gates this)
- Either picks one and starts implementing, or exits with "no work this run"
- Does not crash

If a session crashes, read the transcript — most failures are missing connector permissions (re-check the GitHub MCP setup).

## Routine 2 — `wf-dario-review`

See [routines/dario-review.md](../routines/dario-review.md) for the full spec.

### Steps

1. [claude.ai/code/routines](https://claude.ai/code/routines) → **New routine** → **Remote**
2. **Name**: `wf-dario-review`
3. **Model**: `claude-sonnet-4-6`
4. **Prompt**: copy the `## Prompt` section from [dario-review.md](../routines/dario-review.md)
5. **Repository**: `refluster/ai-native-article`, branch push setting **default** (review-only, no push)
6. **Environment**: Default cloud env, Trusted network
7. **Connectors**: GitHub MCP only
8. **Triggers**: No automated trigger. Operator fires on demand from [claude.ai/code/routines](https://claude.ai/code/routines) with the target PR number in the session context. (The label-triggered model — `wf:needs-review-dario` — was retired 2026-05-27.)

### Verify

Fire the routine from [claude.ai/code/routines](https://claude.ai/code/routines) with a target PR number in the session context. Confirm a review comment appears on the PR within a few minutes.

## Routine 3 — `wf-aoi-review`

See [routines/aoi-review.md](../routines/aoi-review.md) for the full spec. Steps mirror Routine 2 with `wf-aoi-review` as the name and the aoi-review.md spec as the prompt. No automated trigger; operator-fired on demand. (The label-triggered model — `wf:needs-review-aoi` — was retired 2026-05-27.)

## How the three routines compose

> The label-driven state machine (`wf:ready` / `wf:in-flight` / `wf:needs-review-*`) was retired
> 2026-05-27. The current flow uses PR comments for coordination; no labels are required.

```
[New issue eligible per dario-implement Step 1 (no active PR, no operator/L0/L1 tag)]
                          │
                          ▼
[wf-dario-implement (hourly schedule or manual fire)]
   - reads issue, implements on claude/<slug>-<date> branch
   - opens draft PR
                          │
                          ▼
[pr-autopilot (github_event: pull_request, or manual sweep)]
   - routes: nominates reviewer personas via PR comment
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
[wf-dario-review]         [wf-aoi-review]
(operator-fired or        (operator-fired or
 pr-autopilot fire)        pr-autopilot fire)
   - posts architecture/     - posts design-lens
     lens review comment       review comment
                          │
                          ▼
[pr-autopilot sweep (Step 6): 🟢 → pr-merge; 🔴/🟡 → escalate]
                          │
                          ▼
[Operator reviews + merges if not autopilot-eligible]
```

## Cost notes

CCR runs draw on the operator's Claude subscription, not the workforce
W-3 envelope. The operator's daily-run cap is shared across all three
routines. Estimated runs:

- `dario-implement`: up to 24/day (hourly schedule). Most exit early with "no work" (~5 sec session). Real implementations: ~30 min × ~5/day = ~2.5 hrs of work
- `dario-review`: ~5/day at steady state (one per PR labelled)
- `aoi-review`: ~5/day at steady state

Daily-run consumption: ~35-40 sessions. Verify your remaining quota at
[claude.ai/code/routines](https://claude.ai/code/routines) → top-right.

## Turning the chain off

To stop the routines without deleting them: at [claude.ai/code/routines](https://claude.ai/code/routines), open each routine and toggle the **Repeats** schedule to OFF. GitHub-event triggers can be removed individually under the routine's edit page.

To permanently remove: delete the routines from the same page. Past run
sessions remain in the operator's session list.

## After Epic-010 Story 1 / 2 land

Once the `Project` + `MEMBER` + credential-injector work lands:

- `dario-implement` should read credentials from `wf/projects/workforce-meta/*` instead of the bare `wf/*` keys
- The `routine_spec` docs should be amended to reflect the new auth path
- The Maya → /fire dispatch path (currently optional) should become primary, with the hourly schedule kept as belt-and-suspenders

Those are separate PRs after Story 1 / 2 land.
