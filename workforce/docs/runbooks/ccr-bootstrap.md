# Runbook — CCR routine bootstrap

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
5. **PR B merged** ([#101](https://github.com/refluster/ai-native-article/pull/101)) — Maya's `pdm-decompose` skill that produces the `wf:ready` issues these routines consume.

## Labels — one-time setup on the GH repo

Create these labels in the repo settings (Issues → Labels) if they don't exist yet. They drive the state machine:

| Label | Color | Description |
|---|---|---|
| `wf:ready` | green | `pdm-decompose` adds this to child issues; `dario-implement` picks them up |
| `wf:in-flight` | blue | `dario-implement` replaces `wf:ready` with this when it opens a PR |
| `wf:needs-review-dario` | orange | `dario-implement` applies this on the PR; `dario-review` reacts and removes when done |
| `wf:needs-review-aoi` | purple | Same pattern, design lens |
| `role:engineering` | grey | `pdm-decompose` adds this for engineering-flavoured children |
| `role:architecture` | grey | Architecture-flavoured children |
| `role:design` | grey | Design-flavoured children |
| `role:qa` | grey | QA-flavoured children |
| `coordination_required:dario` | red | Surfaces architecture decisions that need human go/no-go before merge |
| `epic:N-M` | grey | One per (Epic, Story) pair, e.g. `epic:10-1` for Epic-010 Story 1 |

These labels are referenced by all three routine prompts. Without them, the routines will fail when trying to apply / remove labels.

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
  --region ap-northeast-1
```

The future revision of `pdm-decompose` that fires this endpoint will read from this secret.

### Verify

Click **Run now** on the routine's detail page. Confirm the session:
- Lists open `wf:ready` issues
- Either picks one and starts implementing, or exits with "no work this run"
- Does not crash

If a session crashes, read the transcript — most failures are missing labels or missing connector permissions (re-check the GitHub MCP setup).

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
8. **Triggers**: GitHub event → `Pull request` → action `labeled` → filter: Labels **is one of** `wf:needs-review-dario`. **No schedule trigger.**

The Claude GitHub App must already be installed on `refluster/ai-native-article` for the GitHub event trigger to receive webhooks. The setup wizard prompts the install.

### Verify

Manually add the `wf:needs-review-dario` label to any open PR. Within ~30 seconds, the routine fires; check the session transcript at [claude.ai/code](https://claude.ai/code).

## Routine 3 — `wf-aoi-review`

See [routines/aoi-review.md](../routines/aoi-review.md) for the full spec. Steps mirror routine 2 with label filter `wf:needs-review-aoi`.

## How the three routines compose

```
[Maya's pdm-decompose creates a child issue with wf:ready + role:* + reviewer:*]
                          │
                          ▼
[wf-dario-implement (hourly schedule)]
   - reads issue, implements in worktree
   - opens draft PR with wf:in-flight + wf:needs-review-dario [+ wf:needs-review-aoi]
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
[wf-dario-review fires]    [wf-aoi-review fires]
   - posts review comments    - posts review comments
   - removes wf:needs-review-dario   - removes wf:needs-review-aoi
                          │
                          ▼
[Operator reviews + merges]
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
