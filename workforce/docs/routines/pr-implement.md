# `pr-implement` — Generic PR implementer skill (persona-agnostic)

**Skill type**: implementer (writes code, opens draft PR).
**Trigger**: invoked by the routing layer when a Story is `wf:ready` (today: conversational; future: CCR API trigger from `pr-route`).
**Purpose**: pick the next ready Story, implement it on a `claude/...` branch, open a draft PR with the standard body shape.

> **Persona-agnostic by design.** "Implementer" is conventionally Dario today (architecture-heavy work warrants Opus + the Dario lens), but a different Story might warrant Ren as implementer or a future persona. The skill describes the **task contract** — context to load, authorisation, self-check, PR body shape. The **persona overlay** (model choice, architecture-vs-engineering bias, branch-naming convention) comes from the invoker's binding `config`.

## Composition contract

```
1. Generic skill spec    ← THIS FILE
2. Persona voice         ← workforce/agents/{agent_slug}/system.md
3. Skill-specific config ← workforce/agents/{agent_slug}/agent.json:bindings[pr-implement].config
                            (model_override, branch_prefix, self_check_lens, allowed_zones, skip_zones)
```

## Skill contract

### Pick a task

1. List open issues in `refluster/ai-native-article` with the `wf:ready` label (or per the invoker's `config.task_filter`).
2. Sort by `config.priority_order` (default: lower `epic:N-M` numbers first).
3. Skip any issue that already has a linked draft PR.
4. Pick exactly ONE. If none ready, exit with "no work this run" and end the session.

### Authorisation (uniform)

You are authorised under [governance.md §5](../governance.md#5-action-authority--autonomous-vs-escalate) to:
- ✅ Edit `workforce/lambdas/**/*.ts` for bug fixes / new features
- ✅ Add new files under `workforce/skills/`, `workforce/docs/runbooks/`, `workforce/docs/routines/` (Rule-11 first version, Zone A allowed)
- ✅ Edit `workforce/docs/data-model.md`, `workforce/docs/architecture.md` (Zone A but agent-authored is fine — human merge)
- ✅ Open draft pull requests
- ✅ Force-push your own feature branch (with `--force-with-lease`)

NOT authorised:
- 🚫 Merge any PR (W-5 / AGENTS.md R-6)
- 🚫 Push directly to `main` (PR-only)
- 🚫 Edit `workforce/docs/governance.md` §2 (L0 invariants W-1..W-5) — requires explicit operator approval
- 🚫 Loosen or disable any R-N\* mechanical check
- 🚫 Change `package.json` deploy IDs, `gas/appsscript.json` access settings, GitHub repo settings

Additional persona-specific restrictions live in `config.skip_zones` (e.g. a UI-focused implementer might skip `workforce/lambdas/`).

### Implement

For each piece of work:

1. Read the Story body carefully. Body sections: AC bullets, parent Epic link, Reviewer-persona hints (informational; Maya routes).
2. Create a working branch named `{config.branch_prefix}/{epic-id}-{short-slug}` (default `claude/wf-{epic-id}-{slug}`).
3. Implement. Conventions:
   - One Story = one PR (unless the Story splits cleanly per [dev-process.md](../runbooks/dev-process.md) Phase B).
   - Bug fix: no surrounding cleanup. Refactor: separate PR.
   - Add tests when adding behaviour.
   - For TypeScript: `tsc -b --noEmit` from `workforce/lambdas/` before pushing. Green non-negotiable.
   - For agent.json / skill meta.json edits: run `npm run workforce:agents`, `npm run workforce:skills`, `npm run workforce:skill-registry`. CI runs these.

### Self-check (apply your binding's `config.self_check_lens`)

The default lens is the **architecture self-check** (Dario lens), encoded in [dev-process.md](../runbooks/dev-process.md) Phase B:

1. **R-N\* compliance** — new state store / scheduler / secret store / observability / executor surface? Zone A amendment must accompany.
2. **Audit surface** — every persistent action addressable by `(pk, sk)` or S3 prefix.
3. **Failure mode named** — what happens when this throws / times out / hits a rate limit.
4. **Cost shape** — monthly cost in PR body; > USD 10/mo surfaces alternatives + `coordination_required:dario` label.
5. **One layer per change** — L0 / L1 / L2 / L3 not confused.

If any item fails, do NOT open the PR — post a comment on the Story explaining why it needs operator review.

Different personas can override the lens via `config.self_check_lens` (e.g. an engineering-focused implementer might use the Ren lens: type tightness, test coverage, API ergonomics).

### Open the PR

1. Push: `git push -u origin {config.branch_prefix}/{epic-id}-{slug}`. Retry on network errors with exponential backoff.
2. Open a DRAFT PR via `mcp__github__create_pull_request`. Title format: `<L-tag>: <concise summary> (closes #<issue-number>)`.
3. PR body MUST follow the template in [dev-process.md](../runbooks/dev-process.md) ("What every Story PR description should include") — sections: scope summary, What changes, What does NOT change (deferred), AC mapping, Architecture self-check, Operator action, Validation, Sequencing.
4. Exit. The routing layer (`pr-route`) will dispatch reviewers.

## Why persona-agnostic

Today Dario holds this binding (Opus + architecture lens). Tomorrow a Story might be small-and-engineering-focused and warrant a Ren-config invocation (Sonnet + engineering lens). The skill spec doesn't care which persona — only that the holder applies their `config` overlay.

This also keeps the spec stable as new implementer personas land — adding "kai-the-content-implementer" means adding a `pr-implement` binding with Kai's config, not rewriting this file.

## Related

- [pr-review.md](pr-review.md), [pr-route.md](pr-route.md) — sibling skills, same persona-agnostic shape.
- [dev-process.md](../runbooks/dev-process.md) — seven-phase loop.
