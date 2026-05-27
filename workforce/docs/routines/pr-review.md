# `pr-review` — Generic PR review skill (persona-agnostic)

**Skill type**: review (post-only).
**Trigger**: invoked by an agent that holds the `pr-route` skill as part of Phase D of [dev-process.md](../runbooks/dev-process.md).
**Purpose**: read a PR + linked Story, post inline + summary comments under the invoking agent's persona lens, then return. **Never** approves, requests-changes, or merges (W-5).

> **Persona-agnostic by design.** This spec describes the **task contract** — the protocol, the success criteria, the structural sections of inline + summary comments. The **lens** (what to actually look for) comes from the invoking agent: their voice in `workforce/agents/{slug}/system.md` + their skill-specific config in the binding's `config` field of `workforce/agents/{slug}/agent.json`. Any agent with a `pr-review` binding can invoke this skill — task assignment is fluid, not persona-locked.

## Composition contract

When an agent invokes this skill, the runtime (operator-conversational today; future CCR with `{agent_slug}` template var) composes the working prompt as:

```
1. Generic skill spec    ← THIS FILE (protocol, success criteria, output format)
2. Persona voice         ← workforce/agents/{agent_slug}/system.md (who you are, how you write)
3. Skill-specific lens   ← workforce/agents/{agent_slug}/agent.json:bindings[pr-review].config
                            (what YOU specifically look for: lens_name, values, checklist_sections,
                             escalation_triggers, sign_off_suffix)
```

The invoker MUST be told its own `{agent_slug}` so it can load the right system.md + config block. Maya's `pr-route` skill passes this at invocation.

## Skill contract (applies to every invocation regardless of persona)

### Context to load

1. PR diff via `mcp__github__pull_request_read` (method=get_diff).
2. PR body — Acceptance criteria, Architecture self-check, Scope (in/out — deferred), Test plan. Template documented in [dev-process.md](../runbooks/dev-process.md).
3. Linked Story issue (`closes #N` in PR body).
4. Repo-level governance: `workforce/docs/governance.md` (§2 W-1..W-5, §4 R-N1..R-N8, §5 action authority); `AGENTS.md` + `docs/governance.md` at the repo root.
5. Bindings doc: `workforce/docs/runbooks/bindings.md` if the PR touches anything binding-related.
6. **Your own** persona voice (`workforce/agents/{your_slug}/system.md`) and skill config (the `config` block in your binding).

### Apply the lens

For each checklist section in your binding's `config.checklist_sections`, scan the diff for violations. Silence on an item means "looks good"; only post when there's a real finding.

Cycle-2+ invocations: scope to cycle-1 findings only. Do NOT raise new findings unless genuinely critical (and if you do, flag `[NEW]` in the finding-ID).

### Output protocol (uniform across all personas)

Use `mcp__github__pull_request_review_write`:
- `method: "create"`
- `event: "COMMENT"` (NOT approve, NOT request-changes — agents never gate merges per W-5)
- Inline comments via `add_comment_to_pending_review` BEFORE submitting.

**Inline format**:
- **Lead with a finding-ID**: section letter + integer, monotonically increasing within the cycle (e.g. "A1", "B2", "C1"). Cycle-2+ comments cite the cycle-1 finding-ID they map to (or flag `[NEW]`). FU-005 codifies the mechanical check.
- Then the checklist letter ("**A. ...**", "**B. ...**") naming the lens section the finding maps to.
- Cite `file:line` (or `file` + section heading for prose).
- 1-3 sentences max. Suggest the fix concretely; when the suggestion is a test, paste the test code directly (5-15 lines) rather than "consider adding a test for X."

**Summary body** structure:
1. Opening line: verdict signal — "🟢 cleared — no blockers from my lens" / "🟡 one or more findings open" / a short paragraph of context (e.g. "Engineering review. Typecheck green, N/N tests pass locally.")
2. Section-by-section verdict: for each lens section in your config, summarise (or omit if no findings).
3. For cycle-2+: a `Cycle-1 → cycle-2` mapping table — `finding-ID → ✅ fixed at file:line / 🟡 still open / 📥 deferred to <link> / 💬 acknowledged nit`.
4. **Sign-off line**: `— {persona_full_name} ({invocation_mode}; lens: {lens_name}; see workforce/docs/routines/pr-review.md)`. The persona-name + lens-name come from your binding's config; `{invocation_mode}` is supplied by the caller ("manual route" / "CCR").
5. **Bias disclosure paragraph**. Mandatory. Tailored to your persona's bias (`{your_slug}` is an LLM persona; what you DID and what you DID NOT do). The `config.bias_disclosure_template` field is the canonical wording for your persona.

### Escalation (instead of review)

If the PR matches any condition in your binding's `config.escalation_triggers` (commonly: governance.md §2 W-1..W-5 amendment, AGENTS.md root edit, R-N\* loosening without §2 amendment, destructive force-push pattern), post a single comment naming the trigger + "cannot evaluate from automated review; requires explicit operator approval per AGENTS.md R-6", then exit. Do NOT proceed with the lens checklist.

### Locally-verified claims (engineering lens specifically)

If your binding's `config.run_locally` is `true`, you MUST run the validators + tests against the checked-out branch before posting the review, and confirm the PR body's claimed counts. Open your summary with "Reviewed by reading the diff + running `npm run typecheck` ($result) and `npm test` ($N/$N passed) locally." False attestation is a worse failure mode than a missed finding.

## What success looks like

- Exactly one COMMENT-event review per cycle per persona.
- Inline comments cite finding-IDs.
- Sign-off + bias disclosure present.
- For re-verify cycles: cycle-1 → cycle-2 mapping table.
- Maya's `pr-route` skill can synthesise the verdict from this review's structured outputs.

## Why this shape (persona-agnostic)

Task assignment is fluid. Today the lens-to-persona mapping is conventional (Dario → architecture, Ren → engineering, Aoi → design), but a different Story might warrant Sora reviewing for editorial accuracy or Priya for legal. The skill (PR review) doesn't need to know which lens; the binding tells the invoker which lens to apply.

This also keeps the skill spec stable as new personas are added — adding Kai-the-brand-reviewer means adding a `pr-review` binding with Kai's config block, not rewriting this file.

## Cross-project mode (Epic-010)

The skill is **target-repo aware** when the binding declares `requires: ["github.token"]` and the invocation carries an explicit `project_id`. The runner resolves the credential per [Epic-010 §5](../epics/epic-010-project-trust-boundary.md#5-type-keyed-credential-resolution) — `wf/projects/{project_id}/github.token`, not the global `wf/github`. The same skill spec covers PRs on the workforce's own repo (`PROJECT#kohuehara-blog`) and PRs on any external project registered under [`workforce/projects/`](../../projects/README.md).

What changes per project:

- **Diff + comment posting** target the project's `(owner, repo)` from `PROJECT#{id}/META.github`, using the project's `github.token` credential — not the workforce's own PAT. The sealed-bag guarantee (per Story 2-A) means the reviewer cannot accidentally reach a credential from another project.
- **Governance grounding** — the `Context to load` step (5) above references `workforce/docs/governance.md` for the workforce's own self project. For an external project, the reviewer reads `PROJECT#{id}/META.governance_docs` (e.g. `["AGENTS.md", "CONTRIBUTING.md"]`) and fetches those paths from the target repo via the Contents API. If `governance_docs` is empty, the reviewer skips repo-specific governance grounding and falls back to the lens's structural checklist only.
- **Story / Epic references** — `closes #N` in the PR body resolves against the target repo, not `refluster/ai-native-article`. Issues are read via the project's PAT.
- **Execution audit** — every review writes `PROJECT#{project_id}/EXEC#{ulid}` via `appendExecution()`. The agent must be in the project's `members[]` or `appendExecution` throws.

What stays the same:

- The `event: COMMENT` constraint (W-5).
- The lens — `config.lens_name`, `config.values`, `config.checklist_sections`, `config.bias_disclosure_template`.
- The inline / summary comment shapes; the finding-ID protocol.
- Cycle-2+ scoping rules.

Invocation:

> {Reviewer persona}, project `{project_id}` の PR `{pr_url}` を review。

When `project_id` is omitted, the runner defaults to the workforce's own self project.

## Related

- [pr-route.md](pr-route.md) — the routing skill (invoked by Maya today; future: any agent with the binding) that dispatches `pr-review` to nominated personas.
- [pr-implement.md](pr-implement.md) — the implementer skill, same persona-agnostic shape.
- [dev-process.md](../runbooks/dev-process.md) — the seven-phase loop.
- [bindings.md](../runbooks/bindings.md) — binding shape including the new `config` field.
