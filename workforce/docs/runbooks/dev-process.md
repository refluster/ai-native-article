# Runbook — Dev process (SaaS-shape, Epic-010 retrospective)

The seven-phase loop that drives every change to the workforce. Codified from the Epic-010 manual run (2026-05-24 → 2026-05-26); this is the **canonical** description — sibling docs ([epics/README.md](../epics/README.md), [ccr-bootstrap.md](ccr-bootstrap.md), [pdm-decompose.md](pdm-decompose.md), [bindings.md](bindings.md)) defer to it.

The loop is operator-driven today. Each phase has automation hooks that can be plugged in over time without changing the shape.

## At a glance

```
A. Epic authored  →  B. Story implemented  →  C. Maya routes reviewers
   (operator + Maya)      (Claude Code session)       (Maya)
                                                          ↓
G. Operator merges  ←  F. Maya verdict  ←  E. Author revises  ←  D. Reviewers comment
   (operator)            (Maya, 🟢/🟡/🔴)        (Claude Code)         (specialist agents)
                            ↑                       ↓
                            └───── cycle ≤ 7 ───────┘
```

Each cycle = (revise → re-review → verdict). Hard cap at **7 cycles** before Maya escalates to operator; in practice a healthy PR finishes in 1-2.

## Phase A — Epic authoring + decomposition

**Owner**: operator (with Maya).
**Outputs**: an Epic doc + a tracker GitHub issue + Story sub-issues.

1. Operator drafts an Epic under `workforce/docs/epics/epic-NNN-<slug>.md`. Format + lifecycle in [epics/README.md](../epics/README.md).
2. Epic is reviewed in repo (PR comments) and matures from `Draft` → `Accepted`.
3. Maya (today: manual, future: `pdm-charter` skill) proposes a Story decomposition. Three discipline points she enforces:
   - **Scenario walkthrough**: identify 2-3 concrete operator/user scenarios the Epic must support, walk through whether each Story covers them. (The Epic-010 retrospective found a missing UI Story this way.)
   - **Cost / architectural deltas pushed back**: any line item > USD 10/mo OR new managed service surfaces an alternative in the proposal — Maya does not silently accept the most expensive shape. (Epic-010's OpenSearch → DDB-brute-force decision is the canonical example.)
   - **Defer-with-name, never silent-drop**: anything not in scope is named as a follow-up issue, not handwaved.
4. Operator 👍 the proposal → Maya creates the tracker + Story issues (or operator does manually).
5. Stories are created as GitHub issues titled `[Epic-NNN Story M] <user-value-anchored title>` with explicit AC. Sized 1-5 days of implementer work (per the EpicDefinition guidance in [epics/README.md](../epics/README.md#epic-sizing-guidance)).

**Anti-patterns observed**: skipping the scenario walkthrough (results in late-discovered Stories); accepting the first proposed cost shape (results in over-engineering); pre-deciding implementer/reviewer assignments in the Epic body (Phase C does that).

## Phase B — Story implementation

**Owner**: Claude Code (today: this manual-run pattern; future: dario-implement CCR routine).
**Outputs**: one or more draft PRs against the Story issue.

1. Pick the next ready Story.
2. Decide PR shape: 1 PR is the default; split into 1-A / 1-B etc. if the change naturally separates a pure-addition foundation from a behavioural wire-up. Story 1's split (foundation + wire-up) was correct; Stories 2-6 may not need splitting.
3. Implement on a `claude/...` branch.
4. **Architecture self-check** before pushing (the Dario lens, encoded inline in implementer prompts):
   - R-N\* compliance — any new state store / scheduler / secret store / observability stack / executor surface? If yes, Zone A governance amendment must accompany.
   - Audit surface — every persistent action addressable by `(pk, sk)` in DDB or S3 prefix?
   - Failure mode named — what happens when this throws / times out / hits a rate limit?
   - Cost shape — any new recurring API call? Monthly estimate in PR body; > USD 10/mo flags `coordination_required:dario`.
   - One layer per change — L0 invariants / L1 framework / L2 mechanical / L3 operational not confused.
5. Run validators locally: `npm run workforce:naming && npm run workforce:agents && npm run workforce:skills && (cd workforce/lambdas && npm run typecheck && npm test)`. **Green before push, non-negotiable.**
6. PR body MUST include: Summary, Closes #N, Acceptance criteria with checkboxes, Architecture self-check pass/fail, Reviewer persona suggestions (informational; Maya routes), Cost impact, Test plan, Sequencing notes.

**Anti-patterns observed**: implementing without re-reading the Story AC (results in scope drift); skipping the self-check (results in cycle-1 reviews catching what self-check would have); bundling unrelated fixes into one PR ("while I'm here…" — split them).

## Phase C — Routing

**Owner**: whichever agent holds the `pr-route` binding. Today Maya is the canonical router; in her absence (or under load) any agent with the binding can route. PR routing is a **function**, not a person.
**Outputs**: one `{Router-persona} — cycle N of ≤ 7` comment on the PR nominating 1-3 reviewer personas.

1. The routing agent reads the PR body + the diff at a glance.
2. Identifies reviewer personas by **lens needed**, not by file path, applying its binding's `config.nomination_rules`. Maya's canonical rules:
   - **dario** (architecture / R-N\* / governance / data-model / IaC / cost shape)
   - **ren** (engineering / TS idiom / test coverage / API ergonomics) — **always** nominated when `workforce/lambdas/` is touched (Ren has `config.run_locally = true`, the only reviewer who runs validators against the checked-out branch; without him the "tests pass" claim is self-attested)
   - **aoi** (design system / UI / IA / a11y / bilingual content rules)
   - **sora** (research / citations / editorial accuracy)
   - **yuki** (GTM / positioning / launch artefacts)
   - **kai / mira / noor / priya / theo** (brand / support / legal / people — invoke when the PR touches their lens)
3. Skip personas with no surface in their lens. (Epic-010 PRs skipped aoi, sora, yuki — all backend.)
4. Post the routing comment with a rationale ("Dario for X, Ren for Y, skipping Aoi because no UI"). Cycle counter increments per fresh router comment, not per individual comment.

**Anti-patterns observed**: nominating every persona "to be safe" (review fatigue + noise); nominating by file path alone ("this touches SAM, summon Dario" — true but missing the audit/cost lens reason); skipping rationale (next operator wonders why those two).

## Phase D — Reviewer pass

**Owner**: nominated agents (subagents today, CCR routines later). The "reviewer" is whichever agent the router nominated for the cycle — not a fixed persona-skill mapping.
**Outputs**: inline + summary review comments per persona, posted via `mcp__github__pull_request_review_write` with `event: "COMMENT"`.

**Skill is persona-agnostic; persona is in the binding.** The single canonical skill spec is `workforce/docs/routines/pr-review.md` — it describes the task contract (read PR + Story → post inline + summary → finding-IDs → bias disclosure → sign-off). The persona-specific lens (Dario's R-N\* / Ren's TS idiom / Aoi's design system) lives in each agent's `agent.json` binding `config` field. Any agent holding a `pr-review` binding can review — the binding's `config.lens_name`, `config.values`, `config.checklist_sections`, and `config.bias_disclosure_template` decide what they actually look for. See [bindings.md](bindings.md) for the binding+config shape.

Common contract for every reviewer:

- Read the PR diff + the linked Story body + the relevant governance docs.
- Apply the persona-specific checklist (in the routine spec).
- Post inline comments where applicable; a summary comment at the end.
- **Never approve / never request-changes** — only `event: "COMMENT"` per W-5 (agents do not gate merges).
- Sign off in persona voice with a bias disclosure.
- On a re-verify cycle: scope to the cycle-1 findings only. Do NOT raise new issues unless genuinely critical.

**Anti-patterns observed**: reviewers expanding scope on re-verify (creates rework loop); reviewers being polite ("nice work!") when concrete findings exist (review quality drops); reviewers approving informally in the summary (violates W-5 — be explicit that you're commenting, not approving).

## Phase E — Author revises

**Owner**: Claude Code session.
**Outputs**: one revise commit + a Maya re-route comment listing what was addressed and what was deferred.

1. Collect findings across all reviewers.
2. Categorise:
   - **Must fix in this PR**: blockers, multi-reviewer overlap, substantive correctness.
   - **Should fix in this PR**: small clear wins (named comments, missed tests, doc gaps).
   - **Defer to follow-up**: explicit "this is the right shape but next-PR scope" findings. Name a concrete follow-up issue or PR.
3. Address must-fix + should-fix in a **single revise commit**. One commit per cycle, not three. The commit message synthesises which finding it addresses.
4. Push (force-push with `--force-with-lease` if rebasing).
5. Post a `Maya — cycle N+1 of ≤ 7` comment summarising the addresses, with a table mapping cycle-1 findings → cycle-2 changes.

**Anti-patterns observed**: revising piecemeal (multiple commits per cycle inflates the cycle count); silent-dropping a finding without naming it as a follow-up (reviewer reads the absence and re-files in cycle 2); turning a "should-fix" into a 200-line refactor (expands scope into a new PR territory).

## Phase F — Verdict

**Owner**: whichever agent holds `pr-route` (same as Phase C). The router and the verdict-caster are the same agent for symmetry — they own the cycle's narrative end-to-end.
**Outputs**: 🟢 (cleared, hand to operator) or 🟡 (still missing X — back to Phase E) or 🔴 (operator escalation — cycle cap hit or governance/L0 ambiguity).

1. The router agent reads the revise commit + each reviewer's cycle-1 review.
2. Per cycle-1 finding: confirms address-location, confirms tests lock it.
3. Audit deferred items are named follow-ups (issue links or PR description sections).
4. Post the verdict comment:
   - **🟢 sign-off**: table of cycle-1 → cycle-2 audit, deferred items list, CI/test state, hand-off note. Operator decides on merge per W-5.
   - **🟡 still open**: which findings are NOT addressed yet; back to Phase E.
   - **🔴 escalate**: cycle cap hit OR the PR ran into something Maya can't decide (L0 amendment, R-N\* loosening, > USD 10/mo without alternative). Operator decides next.

**Anti-patterns observed**: rubber-stamping (Maya signs off without confirming each finding's address-location); going-yellow on style nits (those should be deferred to follow-ups, not block); skipping the cycle counter (operator loses sense of pace).

## Phase G — Operator merge

**Owner**: operator.
**Outputs**: merge.

Per W-5: agents never merge, even their own PRs. The operator is the final safety check. Squash-merge preferred (keeps `main` history linear; revise commits get folded into a clean record).

After merge:

- Webhook fires; this conversation's PR subscription auto-unsubscribes.
- Author session moves to the next Story (or pauses if the Epic is done).
- Operator performs any one-shot actions named in the PR body (e.g., backfill Lambda invocation, runbook steps).

## Cycle accounting

**One cycle = one `(router → reviewer reviews → revise → verdict)` bundle.** The cycle number increments when Maya posts a fresh router comment (cycle 2 router = "address cycle-1 findings and re-route"). The 7-cap is on bundles, not individual comments — generous on purpose:

| Cycles | Typical reason |
|---|---|
| 1 | Trivial PR — no findings, straight sign-off (rare) |
| 2 | Healthy steady-state: cycle-1 reviews → revise → 🟢 verdict |
| 3 | Reviewer flagged something in cycle 2 that needed a small fix |
| 4-5 | The PR was over-scoped or had architectural surprises |
| 6-7 | Approaching the cap; Maya should propose a split rather than another revise |
| > 7 | 🔴 escalate; operator decides whether to split, defer, or kill |

**Enforcement today**: honour-system. Maya counts her own router comments + states the cycle number in each. **Mechanical enforcement is FU-004** (CI lint that counts Maya-authored router comments + fails the build at 8+). Until FU-004 lands, the W-4 "loud on cap hit" guarantee is operator-visible only via Maya's 🔴 verdict comment; there is no human-pageable alert. Operators watching a PR approach cycle 6-7 should pre-emptively propose a split.

## Reviewer-nomination defaults

The same rule that drove Story 1's nominations:

- **dario** — touched whenever the PR changes governance, R-N\*, SAM/IaC, data-model, bindings, or has cost-shape implications. Almost always nominated for a Lambda code or infra PR.
- **ren** — touched whenever the PR includes TypeScript code under `workforce/lambdas/`. **Always nominate Ren when `workforce/lambdas/` is touched** — Ren is the only reviewer whose spec mandates running `npm run typecheck` + `npm test` locally; without his nomination the "tests pass" claim in the PR body is self-attested only, weakening the cycle. (If Ren is intentionally skipped on a pure-docs PR, the author MUST run the validators themselves and check them off in the PR body.)
- **aoi** — touched whenever the PR changes UI, design-doc shape, design tokens, or bilingual content.
- **sora / yuki / kai / mira / noor / priya / theo** — touched only when the PR has surface in their specific lens.

Maya states the nomination rationale + the skip-list in the routing comment. See [pr-route.md](../routines/pr-route.md) for the canonical skill spec and her binding `config.nomination_rules` in `agent.json` for the persona-specific rules.

## Defaults that should stay defaults

- **Single revise commit per cycle** (post-cycle-1). The initial implementation push can be multiple commits; each subsequent revise cycle squashes into one.
- **One PR per Story** unless the Story splits cleanly along pure-addition vs behavioural-change lines (Story 1-A/1-B was the right split).
- **Deferred = named follow-up**, never silent.
- **Validators green before every push** (`workforce:naming`, `workforce:agents`, `workforce:skills`, `tsc -b --noEmit`, `npm test`).
- **Zone A changes have operator sign-off in the PR description**, not just the commit message.
- **Tests lock semantics, not spelling**. Prefer behaviour assertions over regex-on-source.

## Open improvement points

Tracked in the live index at [follow-ups.md](../follow-ups.md). The Epic-010 retrospective items are recorded as FU-001..FU-006 + OP-001..OP-003 (operator actions). This doc deliberately does NOT duplicate the list — the index is the single sweep target, with severity / target-Epic / status columns.

## What every Story PR description should include

The template below is **descriptive of what PRs #110 / #111 actually used**, with sections in the order reviewers expect to find them. Copy + customise per Story; section headings are load-bearing (reviewer prompts key off the exact text):

```markdown
**Story N of M** for Epic-NNN ([#issue]). Closes #N on merge.

<one-paragraph scope summary>

## What changes

### <Core code / Infrastructure / Docs / Tests — pick the categories that apply>
- **file:line** — what + why
- ...

## What does NOT change (deferred to Story X / out of scope)
- Behaviour-stable areas explicitly named (helps reviewers focus)
- Items deferred to follow-up PRs, with link to the FU- entry or issue

## AC mapping
| AC | Where |
|---|---|
| <AC bullet from #N> | <file:line OR "deferred to ..."> |

## Architecture self-check (Dario lens)
1. **R-N\*** — touched / not-touched + status
2. **Audit surface** — every persistent action addressable
3. **Failure modes named** — what throws / times out / fails loud
4. **Cost shape** — annualised cost (or 0)
5. **One layer per change** — confirm

## Operator action — <forward / rollback>
**Forward**: <what happens on merge>
**Rollback**: <how to revert; what state remains>

## Validation
- [x] `npm run workforce:naming` → ...
- [x] `npm run workforce:agents` → ...
- [x] `npm run workforce:skills` → ...
- [x] `workforce/lambdas` → `tsc -b --noEmit` green
- [x] `npm test` → N passed

## Sequencing
- Depends on / unblocks
- Closes #N on merge
```

Phase D reviewer routines key off these sections — keeping the shape stable reduces the prompt's load-bearing assumptions. Maya's verdict comment also re-uses the **AC mapping** + **Validation** + **Sequencing** sections in its summary.
