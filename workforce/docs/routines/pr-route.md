# `pr-route` — Generic PR routing + verdict skill (persona-agnostic)

**Skill type**: routing + synthesis.
**Trigger**: invoked on every new draft PR (Phase C of [dev-process.md](../runbooks/dev-process.md)) and on every revise push (Phase F). Operator-conversational today; future CCR `pull_request.opened` + `pull_request.synchronize` triggers.
**Purpose**: pick the 1-3 reviewer personas for a PR (routing mode), then synthesise their reviews into a 🟢/🟡/🔴 verdict (verdict mode). The skill is **persona-agnostic** — Maya holds the binding today, but any agent (Dario in Maya's absence, a future "triage" persona) could hold it.

> **Persona-agnostic by design.** PR routing isn't only Maya's. This spec describes the **task contract** — the two modes, the mode-decision logic, the routing-comment and verdict-comment shapes. The **rules for who-to-nominate-when** live in the invoking agent's binding `config` in `agent.json`.

## Composition contract

When an agent invokes this skill, the runtime composes:

```
1. Generic skill spec    ← THIS FILE (modes, output protocol, success criteria)
2. Persona voice         ← workforce/agents/{agent_slug}/system.md
3. Skill-specific config ← workforce/agents/{agent_slug}/agent.json:bindings[pr-route].config
                            (nomination_rules, skip_list, sign_off_persona, cycle_cap)
```

Maya's binding's `config.nomination_rules` is the canonical reference today. Other agents holding the binding can override.

## Two modes

The same skill handles both legs of the cycle:

1. **Routing mode** — fired on a new PR or a revise push. Reads the PR + linked Story, decides reviewers per the invoker's `config.nomination_rules`, posts a router comment.
2. **Verdict mode** — fired after reviewers have posted. Reads each reviewer's review against the cycle-1 findings, posts a 🟢 / 🟡 / 🔴 verdict comment.

Mode is determined by inspecting the PR's existing comments (see Mode decision below).

## Skill contract

### Context to load

1. PR via `mcp__github__pull_request_read` (method=get, get_files, get_diff).
2. PR comments (method=get_comments) and reviews (method=get_reviews). Count invoking-agent-authored router / verdict comments to compute the cycle number.
3. Linked Story issue (`closes #N` in PR body).
4. Linked Epic doc (from the Story body's parent link, if present).
5. `workforce/docs/runbooks/dev-process.md` for the seven-phase contract.
6. Your own persona voice + skill config (`workforce/agents/{your_slug}/system.md` + the binding's `config` block).
7. For each persona you might nominate: confirm a `pr-review` binding exists for that persona at `workforce/agents/{persona}/agent.json`. Persona without a binding can't be nominated.

### Mode decision

Evaluate in order; first match wins. **Initial cycle counter = 1** when this routine first runs against a PR.

- If the PR has no invoking-agent-authored comments yet → ROUTING (cycle 1).
- If the last invoking-agent comment was a router AND no reviewer review has posted after it yet → **exit; nothing to do** (Phase D still in flight). Do NOT increment the cycle counter. Log "waiting on reviewers" (W-4 loud-no-op).
- If the last invoking-agent comment was a router AND **every reviewer nominated in that router has posted a review** AND no verdict on that cycle → VERDICT. ("Every nominated reviewer" — not "at least one": partial-quorum verdicts produce drift.)
- If the last invoking-agent comment was a verdict 🟡 → ROUTING (next cycle, cycle counter += 1).
- If the last invoking-agent comment was a verdict 🟢 → exit; nothing to do.
- If cycle count > the `config.cycle_cap` (default 7) → ESCALATE (post 🔴 verdict and stop). Mechanical enforcement is FU-004; until then the cap is honour-system.

### Routing mode

1. Read the PR diff + body + linked Story.
2. Apply `config.nomination_rules` to identify which personas should review. A typical rule shape:
   ```
   nomination_rules:
     - lens: architecture
       persona: dario
       trigger: PR touches workforce/lambdas/ OR workforce/infra/ OR governance.md
     - lens: engineering
       persona: ren
       trigger: PR touches workforce/lambdas/ (always nominate Ren on lambdas/ — Ren is the only reviewer whose config has run_locally=true)
     - lens: design
       persona: aoi
       trigger: PR touches src/ OR DESIGN.md OR design-tokens
     ...
   skip_list:
     - sora, yuki, kai, mira, noor, priya, theo: skip unless the PR has explicit surface in their lens
   ```
3. Nominate 1-3 reviewers per the rules. State the rationale + skip-list in the comment.
4. Post via `mcp__github__add_issue_comment` with body:

```
**{Persona} — cycle N of ≤ {cycle_cap}.**

<one-paragraph PR summary>

Reviewers nominated:

- **@{persona1}** — <one-line lens rationale citing the PR surface>
- **@{persona2}** — <ditto>

Skipping <list with one-word reasons>.

**Cycle N of ≤ {cycle_cap}.** Reviewers post inline + summary via `pull_request_review_write event=COMMENT` (never approve / never request-changes per W-5). Author revises in a single commit per cycle; verdict comment synthesises.

— {persona_full_name} (LLM persona via {invocation_mode}; see workforce/docs/routines/pr-route.md)
```

5. Stop. Wait for reviewer comments.

### Verdict mode

1. Read each nominated reviewer's most recent COMMENT-event review for THIS cycle (filter: authored AFTER the most recent router comment).
2. Cross-reference findings against the diff in the revise commit:
   - For each cycle-1 finding from each reviewer: locate the address-location.
   - Build a table: `finding-ID → status`:
     - ✅ **fixed** at file:line (you MUST be able to point at the exact location; if you can't, default 🟡 not ✅)
     - 🟡 **still open**
     - 📥 **deferred** to `<link to FU- entry or follow-up issue>`
     - 💬 **non-blocking nit / acknowledged** (reviewer flagged as nit; author chose not to address; not a blocker for 🟢)
3. Decide verdict:
   - 🟢: all cycle-1 findings ✅, 📥, or 💬; CI green; tests pass; no L0 amendments without operator sign-off.
   - 🟡: one or more findings 🟡 open. Request another revise cycle.
   - 🔴: cycle count > `config.cycle_cap` OR L0 amendment without operator sign-off OR scope question you can't decide (new managed service, R-N\* loosening). Escalate to operator.
4. Post via `mcp__github__add_issue_comment` with body matching the verdict template (see `config.verdict_template` in the binding, or the canonical Maya version below):

```
**{Persona} — cycle N verdict: 🟢 sign-off** (or 🟡 / 🔴)

<one-paragraph summary of reviewer signals>

## Cycle-{N-1} → cycle-N audit summary

| # | Cycle-{N-1} finding (reviewer) | Status |
|---|---|---|
| 1 | <finding> | ✅ <fix location> |
| 2 | <finding> | 📥 deferred to <link> |

## Deferred to follow-ups (all named)

- <follow-up A> → <link>

## Pre-merge state

- Tests: ✅ <count> passed (<file count>)
- AC coverage: <which AC items now landed>
- Validators: ✅ all green
- Cycle count: N of ≤ {cycle_cap}

## Hand-off

**Closes #<story> on merge.** <unblocks-list>. Operator decides per W-5.

— {persona_full_name} (LLM persona via {invocation_mode}; see workforce/docs/routines/pr-route.md)
```

For 🟡: replace the green sign-off body with a list of "still open" findings + which reviewer flagged each, plus an "author: please address in cycle N+1" line.

For 🔴: state the reason for escalation explicitly; tag the operator. Do NOT auto-merge or auto-label.

## What success looks like

- A routing comment that names 1-3 reviewers with concrete rationale + skip-list, OR a verdict comment with the cycle's mapping table + clear color (🟢/🟡/🔴).
- No double-routing in the same cycle.
- No 🟢 verdict without confirming each cycle-1 finding's address-location.
- Sign-off includes the invoking persona's name + invocation_mode + a pointer to this spec.

## Why persona-agnostic

Maya holds this binding today and is the canonical router. But "PR routing" is a function, not a person. If Maya is unavailable / overloaded / on leave, Dario (or any agent with the binding) can route. The skill spec doesn't care which persona holds it — only that the holder applies their `config.nomination_rules`.

## Cross-project mode (Epic-010)

The skill is **target-repo aware** when invoked with an explicit `(project_id, pr_url)` pair. The invoking persona's binding declares `requires: ["github.token"]`; the runner resolves the credential per [Epic-010 §5](../epics/epic-010-project-trust-boundary.md#5-type-keyed-credential-resolution) — `wf/projects/{project_id}/github.token`, not the global `wf/github`. The same skill spec covers both `refluster/ai-native-article` (the workforce's own repo, `PROJECT#kohuehara-blog` once seeded) and any external project registered under [`workforce/projects/`](../../projects/README.md).

What changes per project:

- **`(owner, repo)`** — parsed from `pr_url` AND cross-checked against the resolved `PROJECT#{project_id}/META.github` row. Mismatch is a runtime throw — the operator named the wrong project for this PR.
- **Governance references** — `config.nomination_rules[].trigger` clauses that today reference `workforce/lambdas/` or `workforce/docs/governance.md` apply *literally* against the workforce's self project. For an external project, the router translates these to the target repo's analogues per `PROJECT#{id}/META.governance_docs` (e.g. `AGENTS.md`, `CONTRIBUTING.md`). If `governance_docs` is empty, the router falls back to the lens's structural triggers only (file-path patterns), not the doc-cited triggers.
- **Reviewer membership** — nominated personas SHOULD be in the project's `members[]` so they appear in the project roster. (Update 2026-06-08: this is no longer *enforced* — the cross-project membership write-gate on the EXEC append was removed per CLAUDE.md C-3, so a nomination naming a non-member persona no longer throws. Membership is now advisory/informational; keep the seed file complete for roster accuracy.)
- **Comment posting** — `mcp__github__add_issue_comment` (today's tool) is replaced at handler time by a REST POST using the project-scoped PAT. The comment body shape is unchanged.

What stays the same:

- The two modes (Routing / Verdict) and the mode-decision logic.
- The router comment + verdict comment shapes (the templates above).
- The cycle counter semantics; cycle cap.
- W-5 (agents never gate merges).
- The persona's voice and `config.nomination_rules`.

Operator invocation:

> {Router persona}, project `{project_id}` の PR `{pr_url}` を route。

The runner resolves `(project_id, pr_url)` at the top of dispatch, validates the operator's project membership, injects the `github.token` credential into the sealed bag, and invokes the persona's routine with the project_id in scope. `appendExecution` records `PROJECT#{project_id}/EXEC#{ulid}` for audit.

When `project_id` is omitted, the runner defaults to the workforce's own self project — preserving today's invocation shape against `refluster/ai-native-article`.

## Related

- [pr-review.md](pr-review.md) — the reviewer skill this routine dispatches.
- [pr-implement.md](pr-implement.md) — implementer skill, same persona-agnostic shape.
- [dev-process.md](../runbooks/dev-process.md) — the seven-phase loop.
- [bindings.md](../runbooks/bindings.md) — binding `config` field shape.
