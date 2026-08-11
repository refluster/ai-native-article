---
name: pr-autopilot
description: Drive every open PR in the bound project's repo to one of exactly two terminal states — MERGED (unanimous-green ≥3-reviewer consensus, no L0/L1 surface, via the fail-closed pr-merge.mjs engine) or ESCALATED to a human with the `autopilot:needs-human` label. Routes each PR to a ≥3-persona reviewer panel, posts every review + the synthesised verdict as PR comments, merges when the R-N10 predicate holds (drafts included), and otherwise hands off — to the operator, or to the bounded, agent-owned author lane `autopilot:needs-author` (pr-remediate) on a base conflict, a behind branch, or open findings (adr-0022). A 🔴 no longer ends at a human by default (adr-0023): when the veto names a diff-local defect the router organises the blocking findings into a machine-checked remediation brief and hands the PR back for a re-reviewed cycle, escalating once the cycle budget is spent. A deterministic sweep escalates anything that stalls. Runs as a CCR task (ADR-0005), fired on cron or a pull_request event (adr-0013).
---

# pr-autopilot

**The two-outcome contract.** Every PR this cadence touches ends in exactly one
of two terminal states:

1. **MERGED** — the R-N10 predicate held and `pr-merge.mjs` merged it.
2. **ESCALATED** — a hand-off comment carrying the hidden marker
   `<!-- autopilot:needs-human -->` was posted via `pr-autopilot-post.mjs
   --needs-human`, which stamps the `autopilot:needs-human` label.

A run that leaves a PR in neither state is a bug, not a finished run. The
deterministic sweep (Step 6) enforces the contract mechanically even when a
run stalls.

The legitimate *interim* states are two, and both are bounded by that sweep:
🟡 (an open review cycle awaiting a revision), and — since adr-0022 — the
**author lane** (`autopilot:needs-author`), where a PR whose blocking cause is
agent-fixable waits for the `pr-remediate` cadence rather than for a human. The
author lane is a 🟡 with an owner; it is not a third terminal state, and a PR
that sits in it without its head moving is escalated like any other stall.

Since **adr-0023** the lane also owns the **🔴 whose veto names a defect in the
diff**: you organise the panel's blocking findings into a remediation brief and
hand the PR back for a re-reviewed cycle, rather than spending an operator
decision on a fix nobody needed a human for. What still ends at a human is the
veto no agent may resolve (premise, scope, L0/L1, delegation) — and the review
loop that has spent its cycle budget.

You are the routing persona (today Nadia's PdM lens). This runs as a **CCR
task** fired by `wf-orchestrator-tick` on the binding's cron, or — when the
binding declares a `github_event` trigger (adr-0013) — on a `pull_request`
event. The cadence is trigger-agnostic and idempotent: you **discover** which
PRs need work; already-routed PRs are skipped.

Your task context supplies:

- `agent_slug` — you (the routing persona).
- `project_id` — the bound project; its `workforce/projects/{project_id}/project.json`
  declares the GitHub repo.
- `credentials['github.token'].token` — the project-scoped PAT. Export as
  `GITHUB_TOKEN` for every script below.
- `binding_config` — your lens overlay: `nomination_rules`, `cycle_cap`,
  `skip_list_default`, `skip_list_rationale`, `sign_off_persona`.

**Scope: every open PR** — draft and non-draft, human- and bot-authored
(Dependabot) — routes through the same review → consensus → merge path
(adr-0010; drafts are merge-eligible per adr-0014). The reviewer-lens contract
in Step 4 is part of this skill (the former standalone `pr-review` skill was
retired and folded in; `dependabot-triage`'s no-review lane likewise).

## Step 1 — discover candidates (deterministic, read-only)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-autopilot/pr-autopilot-scan.mjs \
    --project "<project_id>" --persona "<agent_slug>" \
    --max 5 --since-days 7 --out /tmp/pr-autopilot-candidates.json
```

The scan lists every open PR updated within the window, caps at `--max`, and
writes each candidate (title, body, diff, comments, `draft`/`is_bot` flags) to
`--out`. **0 candidates → skip Steps 2–5, but still run the Step 6 sweep.**

A PR you already routed comes back **only when its head commit is newer than
your last routing comment** — i.e. the author pushed the revision a 🟡 verdict
asked for (Step 5). Each candidate carries the `cycle` to route it at: `1` for
a first pass, `N+1` for a re-route. Open your Step-2 comment with that number,
and apply your `binding_config.cycle_cap` to it — the scan only enforces the
W-4 hard cap (`--cycle-cap`, default 7), which is a process-breakdown line, not
a retry budget.

## Step 2 — route each candidate (your judgment)

For each candidate, apply your `binding_config.nomination_rules` to the diff +
body:

- Nominate **at least 3** reviewer personas (never 1 or 2 — the merge engine
  fails closed below `MIN_REVIEWERS=3`). Seat the lenses with the most real
  surface first, then fill to 3 with your standing broad lenses (product,
  engineering-excellence, platform). If you honestly cannot seat 3 distinct
  lenses, the PR is not autopilot-eligible: hand it off per Step 5 with
  `--needs-human --reason cannot-seat-panel`, stating why.
- **Nomination load cap (Epic-019 Story 2b — fairness + W-3).** A persona may
  hold at most **`NOMINATION_SEAT_CAP` (5)** concurrent open lens-review
  seats. The scan output carries `open_seat_counts` (one seat per open,
  non-terminal PR whose routing comment nominates that `wf:<slug>`) and
  `capped_personas`; run your candidate list through
  `applyNominationCap(candidates, open_seat_counts)` (exported from
  `pr-autopilot-scan.mjs`) and nominate only from its `eligible` remainder —
  a capped persona is replaced by another eligible lens, never squeezed in.
  If the cap leaves fewer than 3 seatable lenses, the PR is not routable this
  tick: hand it off per Step 5 with `--needs-human --reason
  cannot-seat-panel`, naming the capped personas.
- Each nomination's `rationale` cites the PR surface (file paths / topics).
- List in `skipped` only personas you considered and rejected.
- **Epic PRs carry a VP-class reviewer.** When the diff touches the Epic /
  design-record path (for `agent-workforce`: `workforce/docs/epics/**`),
  nominate the product lens **plus** at least one VP-class persona, still
  seating the full ≥3 panel.

Write the routing comment for PR `<number>` to `/tmp/route-body-<number>.md`
using **exactly** this template (the opening line is the marker the scanner
and the cycle-cap counter read):

```md
**<PersonaName> — cycle 1 of ≤ <cycle_cap>.**

<one-paragraph PR summary>

Reviewers nominated (≥ 3):

- **`wf:<persona>`** — <rationale citing the PR surface>
- **`wf:<persona>`** — <rationale citing the PR surface>
- **`wf:<persona>`** — <rationale citing the PR surface>

Skipping `wf:<persona>` — <one short clause>.

**Cycle 1 of ≤ <cycle_cap>.** Reviewers post via `event=COMMENT` (never
approve / never request-changes per W-5). Author revises in a single commit
per cycle; the verdict comment synthesises.

— <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)
```

`<PersonaName>` is your `agent_slug` capitalised. Omit "Skipping …" if empty.

**Never `@`-mention a persona (ML-012).** Workforce persona slugs are **not**
GitHub accounts — a raw `@<slug>` in any posted body notifies whichever real
GitHub user owns that name (a routing comment's `@yuki` pinged the unrelated
github.com/yuki, operator report 2026-07-04). The canonical agent-reference
format everywhere you post — nominations, skip lines, review bodies, verdict
comments — is `wf:<slug>` wrapped in backticks (e.g. `wf:yuki`). This is
enforced mechanically: `pr-autopilot-post.mjs` refuses (exit 1) any body
containing a raw `@`-mention outside backticks/code fences, so wrap literal
`@…` tokens you must quote (scoped npm packages, decorators, emails in prose)
in backticks too.

## Step 3 — post each routing comment (deterministic)

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/route-body-<number>.md
```

`pr-autopilot-post.mjs` is comment+label-only — it has no code path that
approves, merges, or pushes (R-N9 / W-5). It also refuses a body carrying a
raw GitHub `@`-mention (ML-012): agents are `wf:<slug>`, never `@<slug>`.

## Step 4 — obtain each nominated review (drive the cycle; do not stall)

**Run each nominated lens as its own read-only subagent, in parallel** — one
subagent per persona — then post each returned review as that persona: a
COMMENT review (`event=COMMENT`, never approve / request-changes per W-5). Do
not wait on any external dispatch. (`backlog-reconcile` fans out audit
subagents on this same CCR path, so this is a proven capability, not a
hypothesis.)

**Why subagents and not inline (#512).** Producing every lens inline, in your
own context, means each reviewer sees the diff's justification, your routing
comment's framing, and every earlier reviewer's findings. Lenses that share a
context do not converge independently — N of them agreeing is **one conclusion
stated N times** — yet the verdict comment presents convergence as the
strongest signal it has, and the operator merges on it. Observed on #510: four
inline lenses found a real blocking defect but *all four accepted the author's
framing of the change*, and none questioned its premise. Shared context catches
implementation defects and suppresses premise questions.

**Context isolation is the whole point — give each subagent exactly:**

- the **unified diff** and the PR title/body;
- that persona's **lens config** (fetched fresh from `GET /agents/{slug}`);
- the **cycle number**, and on a re-route, that persona's *own* prior findings
  (so `[NEW]` vs "cites the cycle-1 finding-ID" still works).

**Withhold:** your routing comment, your summary of the PR, any other lens's
output, and any opinion of yours about the change. If a lens needs repo context
it reads the repo itself. **Never seed a subagent with another lens's finding
to "check"** — that manufactures the agreement the verdict then reports as
evidence.

**The session's working tree is NOT the PR (#518, cycle 1).** A CCR fire checks
out the **base** branch. A lens that "verifies a claim against the branch" by
reading files, or by `grep`ping the repo it is sitting in, is reading `main` —
and will report every file and symbol the PR *adds* as missing. This is not
hypothetical: on #518 all four lenses independently reported that three new skill
directories, a `REASON_CODES` change and five named guards were "absent from the
branch". Every one of them was in the diff; every claim matched `main` exactly,
down to the pre-change function signature and its line number. The panel returned
🔴 on a PR whose code it had not read, and each lens's bias disclosure stated it
had verified against the branch — because from inside the session, it had.

So, mechanically, before any lens reads repo state:

```sh
git fetch origin "<head.ref>" && git checkout "<head.ref>"   # or: git worktree add
git rev-parse HEAD    # MUST equal the candidate's head.sha
```

and tell each lens, in its prompt, **which ref it is on**. A lens that cannot
check out the head must say so and confine itself to the diff it was given —
"file X is absent" is a claim about a ref, and a claim about the wrong ref reads
exactly like a finding. When a lens reports something as *missing*, the verdict
should treat it as unverified until the ref is confirmed: absence is the one
class of finding this failure mode manufactures.

**Honest limit, and do not oversell it in the verdict.** Separate contexts
remove *anchoring*, not *correlated priors*: the same base model across N
subagents shares blind spots, so a defect class the model systematically misses
is missed N times. Isolation raises convergence from "no evidence" to "real but
correlated evidence" — never to independence in the sense a human panel means.

**Fallback.** If subagents are unavailable in this runtime, run the lenses
inline as before, but say so in the verdict (Step 5) so the operator discounts
convergence correctly. Silent inline production is the failure this step exists
to prevent.

**Reviewer-lens contract (per nominated persona):**

- **The lens** = that persona's voice + skill-judgment config (`lens_name`,
  `values`, `checklist_sections`, `escalation_triggers`,
  `bias_disclosure_template` on their `AGENT#{slug}` record). Scan the diff in
  that lens only; post only real findings (or an explicit "no findings from
  this lens").
- **Inline findings** lead with a finding-ID (`A1`), name the checklist
  section, cite `file:line`, suggest the fix concretely. Cycle-2+ comments
  cite the cycle-1 finding-ID or flag `[NEW]`.
- **Summary body**: verdict signal (🟢/🟡/🔴 from this lens) →
  section-by-section notes → sign-off
  `— {persona} (LLM persona; lens: {lens_name}; manual route via pr-autopilot)`
  → a mandatory bias-disclosure paragraph (it is an LLM persona; what it DID /
  did NOT do).
- **Green sign-off marker (machine-checkable).** A non-blocking lens (no 🔴)
  **must embed the exact hidden marker** `<!-- autopilot:review:{slug}:green -->`.
  This is the only signal the merge engine accepts as that reviewer's green
  vote. A blocking reviewer omits it. No marker ⇒ not green ⇒ no merge.
- **Escalation instead of review**: if the PR matches the persona's
  `escalation_triggers`, post a single comment naming the trigger — as a
  hand-off per Step 5 (`--needs-human --reason persona-escalation-trigger` +
  the hidden markers), not a checklist run.
- **The lenses are not independent, and the verdict must say so.** Every lens
  in this step is produced by one session, in one context window, in
  sequence — each able to see the diff's own justification, your routing
  comment, and every earlier lens's findings. That is a known property of the
  inline contract, not a defect of a given run, and it has an observed
  asymmetry: a shared-context panel reliably catches implementation defects
  and does **not** reliably challenge the author's premises (#512, evidenced
  on #510). Nothing here changes what you post per lens; it changes what
  Step 5 may claim about agreement between them.

## Step 5 — verdict by reviewer consensus → terminal action

Synthesise the reviewers' **collective** verdict (never your solo call):

- **🟢 unanimous-green** — every nominated reviewer non-blocking.
- **🟡** — one or more reviewers left an open blocking finding; the author is
  expected to revise; next tick re-routes (cycle += 1).
- **🔴** — any reviewer's veto, cycle > `cycle_cap`, or a scope question you
  cannot decide. **A 🔴 is not automatically a human's problem (adr-0023).**
  Split it by *what the veto is about*:
  - the veto names a **defect in the diff** — a wrong implementation, a missing
    guard, an unhandled case, a test that should exist: this is the **author
    loop**. Write the remediation brief (below) and hand off with
    `--needs-author --reason review-findings-blocking`. `pr-remediate` implements
    or rebuts each item, and your next tick re-reviews at cycle N+1.
  - the veto is about something **no agent may resolve** — the change's premise
    or scope, an L0/L1 surface, a missing delegation, a human's
    `CHANGES_REQUESTED`, a persona escalation trigger, or a panel you could not
    seat: **human**, as before.
  - the **cycle budget is spent** (this verdict closes cycle `n` and `n+1 >
    cycle_cap`): **human**, `--reason cycle-cap-exceeded`. This is where the
    human gate went — it is no longer "a lens said no", it is "the loop had its
    chances". `pr-autopilot-post.mjs` refuses a `review-findings-blocking`
    hand-off past the cap rather than trusting you to remember.

**Declare the panel's provenance — and know what the declaration is worth.**
Every verdict body must carry exactly one of these markers, appended by
`pr-autopilot-post.mjs --panel isolated|inline` (which refuses a verdict post
carrying neither, the same treatment the escalation-reason code gets):

```
<!-- autopilot:panel:isolated -->   lenses ran as isolated subagents
<!-- autopilot:panel:inline -->     lenses ran inline, in the router's context
```

**The marker is self-attested and is NOT proof of independence.** The router
chooses the mode and writes the marker; nothing downstream can contradict it.
The check is that the claim is *present, explicit and machine-readable* — never
that it is true. Enforcing presence stops the mode from going unstated; it does
not stop it from being stated falsely, and no reader should treat it as if it
did (`wf:rafael` R1 on #513, which is the honest reading of what this buys).
Real enforcement — a provenance artefact emitted by whatever spawns the
lenses, not by the router's prose — is tracked separately and is not in force.

Given that, weigh convergence like this in the synthesis:

- **isolated** → two lenses landing on the same line is real evidence, but
  correlated: one base model, shared priors. Say "converged independently" only
  alongside that limit, never bare.
- **inline** → say plainly that they shared a context, so agreement is one
  conclusion stated N times, not N readings. Do not report it as convergence.

**Disclose an author↔router collapse.** If the session running this panel also
authored the PR, say so in the verdict's first paragraph and discount the whole
panel accordingly — it is the strongest discount available, and the reviews
should be read as one session's self-critique wearing N lenses.

**This disclosure does not change what may be merged.** The merge leg's rule is
unchanged and stands as written: *authorship is not a hold* — a green,
non-L0/L1 PR merges regardless of who opened it (adr-0011 / FU-028). Whether a
collapsed panel should *also* suspend the merge leg was once an open question;
**[adr-0024](../../docs/adr/adr-0024-panel-mode-not-a-merge-condition.md)
answers it: no.** Panel provenance mode is never a merge-eligibility condition.
An `inline` panel — including one where you also authored the PR — is a
disclosure and a discount on this verdict's *wording*, never a terminal action.
Disclose, discount the prose, and proceed under the predicate.

Write a verdict comment that names each reviewer's load-bearing finding and
the aggregated colour, then take the terminal action:

| Verdict | Condition | Action |
|---|---|---|
| 🟢 | no L0/L1 path + R-N10 delegation + predicate holds | **merge** via `pr-merge.mjs` (below) |
| 🟢 | touches the target's L0/L1 paths | hand off `--needs-human --reviewed` |
| 🟢 | no R-N10 delegation for this repo | hand off `--needs-human --reviewed` |
| 🟢 / 🟡 | **conflicts with the base** (`mergeable_state=dirty`) or **behind** it | hand off `--needs-author --reason merge-conflict\|branch-behind` (below) |
| 🟡 | open blocking lens findings | hand off `--needs-author --reason review-findings-open` |
| 🔴 | a lens **vetoed a defect in the diff**, and cycle + 1 ≤ `cycle_cap` | hand off `--needs-author --reason review-findings-blocking` **+ remediation brief** (adr-0023) |
| 🔴 | cycle + 1 > `cycle_cap` | hand off `--needs-human --reason cycle-cap-exceeded` |
| 🔴 (premise/scope), **unanimous** | any | hand off `--needs-human --reason other --reason-text "…"` (no `--reviewed`) |
| 🔴 / 🟡 with an **irreconcilable panel** | any | hand off `--needs-human --reason no-reviewer-consensus` (no `--reviewed`) |
| can't seat 3 | any | hand off `--needs-human --reason cannot-seat-panel` (no `--reviewed`) |
| unreadable governance | any | hand off `--needs-human --reason no-r-n10-delegation` (no `--reviewed`) |

> **"Irreconcilable panel" is NOT "the panel wasn't unanimous green."** Read
> literally, *every* 🔴 and *every* 🟡 is non-unanimous, so a row keyed on that
> swallows the two rows above it and adr-0022/0023's author lane never fires —
> the failure this note exists to prevent. It means the narrow case where the
> lenses **contradict each other** on a point you cannot adjudicate (one says the
> approach is right, another says it is wrong at the premise) and no synthesis is
> honest. A single veto naming a concrete diff-local defect, with the other
> lenses merely non-blocking, is **not** this — it is the `--needs-author` row,
> however emphatic the veto. Ask: *is there a fix an agent could make that all
> lenses would accept?* If yes, the author lane owns it.
>
> **Where a *unanimous* premise/scope 🔴 goes.** A panel that agrees the change
> should not exist contradicts nothing, so it is not an irreconcilable panel
> either — and there is no diff-local fix, so it is not the author lane. It has
> no dedicated code: escalate it as `--reason other --reason-text "…"`, naming
> what the panel agreed was wrong about the premise. (Raised by `wf:dario` A3 on
> #543: the narrowing above would otherwise leave that case with no home, and a
> router finding nothing that fits reaches for `no-reviewer-consensus` again —
> which is the failure this whole note exists to stop. If that class turns out
> to be common, mint a code; one occurrence does not justify one.)
>
> *(Recorded 2026-08-04 after PR #524: judged 2026-07-31 07:51Z, ~15h before
> adr-0022 shipped the author lane, so the router had only merge-or-human and
> stamped `no-reviewer-consensus` on a 🔴 whose findings were entirely
> diff-local — and its own verdict prescribed the cycle-2 fixes. The label then
> made `isTerminal()` skip the PR forever, so the revision it asked for could not
> be produced by the workforce.)*

### The author lane — a 🟡 with an owner (adr-0022)

A 🟡 used to mean "the author is expected to revise, and the next tick re-routes".
The author is a fire-and-forget session that ended when the PR opened, so what
actually happened was: nothing, for 48h, then the sweep escalated it to the
operator. Same for a PR that went `dirty` because another PR merged first — a
failure caused by the system *working*, and getting commoner as throughput rises.

So route the agent-fixable causes to an agent instead of to a human. Hand off with
`--needs-author` and the PR joins **`pr-remediate`**'s queue
(`autopilot:needs-author`): that cadence resolves the conflict / updates the
branch / addresses the findings, pushes to the **head** branch, and clears the
label — and your next tick sees a newer head commit and re-routes at cycle N+1.

Three things to know before you use it:

- **It is not a third terminal state.** MERGED and ESCALATED still are. The lane is
  bounded by a 3-attempt cap and by the Step-6 sweep (`--author-stale-hours`, 36),
  which escalates a PR the remediation cadence did not pick up — so a PR cannot
  quietly live here.
- **It is fail-closed on L0/L1, tighter than the merge leg.** A PR touching the
  target's declared L0/L1 set is *refused* the lane by `pr-autopilot-post.mjs`
  (exit 1) — resolving a conflict inside a governance file is an edit to it.
  Re-post such a PR as `--needs-human --reason l0l1-path`.
- **Only agent-fixable reasons may enter it.** The script refuses `l0l1-path`,
  `no-r-n10-delegation`, `human-changes-requested`, `kill-switch-off`,
  `cycle-cap-exceeded` and the remediation exits. `review-findings-blocking`
  (adr-0023) is allowed but carries two extra conditions of its own — a parsable
  remediation brief and the cycle budget (see below). `checks-failing` is *allowed but
  never automatic*: route a red PR to the author only when your lenses located the
  defect in the diff — the flaky-rerun latch owns the retry case, and bending a
  genuine product failure into a patch attempt is worse than escalating.

### The 🔴 loop — you organise the fix, then hand it back (adr-0023)

adr-0022 gave the 🟡 an owner. adr-0023 gives the **🔴** one, for the class where
the veto is a diff-local defect: instead of spending an operator decision on
"a lens said no", you do the PdM work — turn the panel's blocking findings into
an ordered work-list with acceptance criteria — and hand *that* to the author
lane. Route this way only when you can write such a list; a veto you cannot
reduce to concrete changes is a premise question, and premise questions are the
human's (they always were).

The hand-off body must carry a **remediation brief**, and
`pr-autopilot-post.mjs` refuses the post (exit 1) unless it parses:

```md
**Remediation brief — <n> blocking finding(s), cycle <n> of ≤ <cycle_cap>.**

1. `A1` (`workforce/skills/pr-autopilot/pr-merge.mjs:88`) — rethrow the swallowed refusal instead of logging it. Done when: a server-side refusal exits non-zero and the verdict re-posts.
2. `B2` (`workforce/skills/pr-autopilot/pr-merge-tests.ts`) — add the case `B2` describes. Done when: the suite covers the refused-decision path.
```

Each item: the reviewer's **finding-ID**, the **location** in backticks, the
**change to make**, and a `Done when:` clause the next cycle's panel can check
off. Order them: what blocks the others first. Two rules on content —

- **Do not re-litigate the finding in the brief.** It is a work-list, not a
  second review. If you think a lens is wrong, say so in the synthesis above and
  leave the item out; `pr-remediate` may also rebut an item by ID, which is a
  legitimate outcome that the next panel then judges.
- **Never widen the PR.** Items address the findings; "while you're in there"
  work is a separate PR and a separate issue.

The loop is bounded three ways, none of them your promise: the brief must parse,
the post is refused when cycle + 1 exceeds the cap, and the lane's own 3-attempt
remediation cap plus the Step-6 sweep still apply. A 🔴 PR therefore reaches a
human after a bounded number of *organised* attempts — never after none, never
after unbounded ones.

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/verdict-<number>.md \
  --panel isolated|inline --needs-author --reason review-findings-blocking \
  --cycle <n> --cycle-cap <cycle_cap>
```

The verdict body is the same template with the lane's marker in place of the
human one, and the hand-off sentence naming the fix expected:

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/verdict-<number>.md \
  --panel isolated|inline \
  --needs-author --reason merge-conflict|branch-behind|review-findings-open|review-findings-blocking \
  [--cycle <n> --cycle-cap <cycle_cap>]   # REQUIRED with review-findings-blocking
```

```
<!-- autopilot:needs-author -->   ⟵ the lane marker (the script appends it from --needs-author)
```

A body may never carry both lane markers — `resolveLabels` throws, because a PR
in two queues is a PR whose owner one reader gets wrong.

**Every hand-off goes through `pr-autopilot-post.mjs`** — never a raw API
call, `gh`, or an MCP comment tool (those drop the label; ML-009). Compose the
verdict **into** this template so the markers are present by construction:

```md
**<PersonaName> — verdict, cycle <n> of ≤ <cycle_cap>. <🟢 escalate / 🔴 / hand-off>.**

<one-paragraph synthesis: each reviewer's load-bearing finding, the aggregated colour>

**Panel provenance.** All <n> lenses were produced by one session in a shared context, in sequence — each saw the diff's justification, the routing comment, and the earlier lenses' findings. Agreement between them is one reading stated <n> times, not <n> independent readings; discount convergence accordingly. <ONLY when the same session also authored the diff: "This session also authored this PR — author and router have collapsed, which is the strongest discount of all.">

**Handing to the operator — <reason>.** Not merging. <If a DRAFT: "Still a draft — mark ready, then merge.">

— <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)

<!-- autopilot:needs-human -->
<!-- autopilot:reason:<code> -->   ⟵ REQUIRED on every hand-off: the escalation-reason code (see "Reason codes" below); `other` carries its mandatory free text inside the marker.
<!-- autopilot:reviewed -->   ⟵ keep this THIRD marker line ONLY on a 🟢 merge-ready hand-off; delete it on any hand-off that is not 🟢 merge-ready.
<!-- autopilot:panel:isolated -->   ⟵ REQUIRED on every VERDICT post (isolated | inline). Self-attested — presence is enforced, truth is not. Pass `--panel isolated|inline` and the script appends it.
```

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
  --project "<project_id>" --pr <number> --body-file /tmp/verdict-<number>.md \
  --panel isolated|inline \
  --needs-human [--reviewed] [--reason <code> [--reason-text "…"]]
```

`autopilot:reviewed` marks "reviewed to 🟢, merge-ready, held only by the
human gate" — the operator's merge-click queue
(`is:open label:autopilot:reviewed`). Never stamp it on a non-green hand-off.

### Panel provenance — the line is mandatory, and its wording is bounded

The **Panel provenance** line is required on every verdict comment, green or
otherwise. The verdict is the artefact the operator reads to decide a merge,
so an overstated independence claim is a truthfulness defect in the record,
not merely a review-quality one (#512).

Two rules on how it may be worded:

- **Never present convergence as independent corroboration.** Phrasings like
  "three lenses converged without coordinating" are false under the Step 4
  contract — they shared a context by construction. State agreement as what it
  is: the same session reaching the same reading N times.
- **Disclose author↔router collapse whenever it holds.** If the session
  running the panel also authored the diff, the sentence is mandatory, not
  optional. It is the strongest discount available and the operator cannot
  infer it from the comment's format.

This constrains the verdict's *evidentiary wording only*. It does not change
the merge predicate, `MIN_REVIEWERS`, or R-N10, none of which depend on the
lenses being independent. (This clause used to read "R-N10 / FU-028's
author≠merger separation". **FU-028 states no such rule** — its subject is that
the workforce authors and merges under the *same* GitHub identity, which is why
self-approve returns 422 and why the approve step was made advisory. It was
cited as the source of a separation it in fact contradicts; adr-0024 §Context
records the correction.) Per
[adr-0024](../../docs/adr/adr-0024-panel-mode-not-a-merge-condition.md), a
`panel:inline` marker or an author↔router collapse **must not** produce a
hand-off: if the only unmet item is panel independence, the PR merges. Raising the
lenses to genuinely separate contexts (one subagent per lens) is the proposal
this does **not** implement: it gates on whether a CCR `agent-runner` session
can spawn subagents mid-skill, which is unresolved from the repo alone and
needs an empirical answer from a real tick (#512, "Open question"). Even if it
ships, separate contexts remove anchoring, not correlated priors — N lenses on
one base model share blind spots — so the ceiling on that wording is "real but
correlated," never "independent."

### Reason codes (Epic-019 escalation telemetry)

Every hand-off carries **why**, as an `autopilot:reason:<code>` label plus the
hidden `<!-- autopilot:reason:<code> -->` marker. The versioned taxonomy —
each code mapped 1:1 to its emission site — is
[workforce/docs/pr-escalation-reasons.md](../../docs/pr-escalation-reasons.md)
(v3.1). `pr-autopilot-post.mjs` refuses (exit 1) a `--needs-human` post with no
reason and throws on any code outside the taxonomy; `other` requires free text
(`--reason other --reason-text "…"`). Pick the code naming the failed clause.

**Author lane** (`--needs-author`; `pr-remediate` clears these — reach here
first, and only fall through to the human lane when none fits):
`merge-conflict` / `branch-behind` (Step 5 base rows),
`review-findings-open` (🟡 with open blocking findings),
`review-findings-blocking` (🔴 whose veto names a **diff-local defect** —
requires the remediation brief and is refused past the cycle cap).

**Human lane** (`--needs-human`): `l0l1-path`, `no-r-n10-delegation`,
`no-reviewer-consensus` — **narrowed: irreconcilable panel only, i.e. the
lenses contradict each other; see the note under the Step-5 verdict table. A
diff-local veto is `review-findings-blocking`, author lane** —
`cycle-cap-exceeded`, `cannot-seat-panel` (Step 2),
`persona-escalation-trigger` (Step 4), `merge-engine-refusal` (Step 5 refusal
re-post — prefer the specific clause code the engine already stamped), and
`other --reason-text "…"` for a **unanimous** premise/scope 🔴 (the panel agrees
the change should not exist, so it contradicts nothing and is not
`no-reviewer-consensus`). The
post script also computes the verdict-time L0/L1 check itself and stamps
`autopilot:reason:l0l1-path` on any escalation touching the target's declared
set, fail-closed like the merge engine. These codes measure **wiring, never
reviewer performance**.

### Bounded flaky-check auto-rerun (Epic-019 Story 2c)

A `checks-failing` hand-off is not posted immediately: `pr-autopilot-post.mjs
--reason checks-failing` first attempts **one** bounded rerun via
`flaky-rerun.mjs`. The rerun fires **only** when EVERY failing check is on
the evidenced, unexpired allowlist (`flaky-checks.json` — validated by the
`workforce:skills` gate; each entry is `{check_name, evidence, expires}`, no
evergreen exemptions) **and** the PR has never been rerun before (the hidden
`<!-- autopilot:rerun:… -->` marker is the once-ever latch, posted *before*
the rerun triggers). A triggered rerun posts its audit comment (check names +
allowlist evidence) + the `autopilot:reran` label and **defers the
escalation** — the next tick re-verdicts on fresh checks; a rerun that still
fails escalates `checks-failing` normally, never retried. Editorial/deploy
gates (check names matching `/deploy|article|truncat|editorial/i` —
R-10/W-1 class) are **categorically rerun-ineligible**. A check that
repeatedly passes on rerun is racy, not flaky — `build-pr-metrics-github.mjs`
WARNs over threshold; evicting the entry + opening the issue is a
manual/sweep step. You never trigger a rerun by hand; the post script owns
the whole attempt.

### The merge leg (R-N10; one shared engine)

Emit a merge **only** when all hold: 🟢 unanimous-green; the bound project's
target repo carries an **R-N10 delegation** in its own statute; the PR touches
**no L0/L1 path** declared between the `<!-- autopilot:l0l1-paths -->` markers
of the target's `docs/governance.md`; **CI + mergeability green, read from the
PR object alone** — `mergeable == true` and `mergeable_state` `clean` (or
`draft`, which the engine flips Ready for Review then merges); no
`CHANGES_REQUESTED`. The workforce's own repo (`refluster/ai-native-article`)
is a normal delegated target (adr-0011) — **authorship is not a hold**: a
green, non-L0/L1 PR merges regardless of who opened it (FU-028).

> **Do not establish "checks green" with a `GET /commits/{sha}/status` or
> `GET /commits/{sha}/check-runs` call** — not in the engine, not by hand in the
> verdict step. GitHub folds the head commit's check state into
> `mergeable_state` (failing check → `unstable`; red or pending *required*
> check → `blocked`; neither is `clean`), so those endpoints add nothing to the
> clause while demanding `checks: read` / `statuses: read` on top of the
> `pull-requests: read` the PR object needs. A project token without them 403s
> and the engine fails closed — which is exactly how psvl/asp-cloud #694 / #696
> sat on `autopilot:reason:merge-engine-refusal` for two days while their own
> `mergeable_state` read `clean`. Barred by asp-cloud's
> [adr_autopilot_pr_merge.md §2.1 clause 3](https://github.com/psvl/asp-cloud/blob/main/docs/adr_autopilot_pr_merge.md)
> (amended 2026-08-11).
>
> **This does not depend on the base having branch protection**, and you must
> not add a condition that assumes it does. Protection decides only *which*
> non-clean state a red check produces — `blocked` when the check is required,
> `unstable` when it is not — and both fail the clause. Measured 2026-08-11:
> `refluster/ai-native-article` #547 / #545 / #542 all have a `failure`
> check-run on an unprotected `main` (`protected: false`, empty
> `required_status_checks`) and all report `unstable`, while #567 / #565 / #561
> / #551 are green and report `clean`.
>
> This was tried the other way (dario A1 → `db6d09d`), on the premise that
> asp-cloud's `main` is protected and this repo's is not. **Both are
> unprotected** — verified live the same day — so gating the skip on a
> branch-protection read sent asp-cloud straight back to the check-runs path,
> the 403, and the refusal, exactly reproducing the stall the clause-3
> amendment exists to end. If you are about to condition this clause on
> anything, read *both* targets' real protection state first.
>
> The lone exception is a **draft** whose `mergeable_state` is the literal
> `draft`, which reports nothing about CI; the engine reads check-runs on that
> branch. In practice drafts on these repos report their underlying state
> (`clean` / `unstable` / `dirty`), so that branch is a compatibility fallback,
> not the common path.

**These clauses are the complete set of *predicate* conditions** (adr-0024) —
alongside the holds already stated above, which the engine also enforces
(`autopilot:off`, the W-4 cycle cap, a persona escalation trigger, a panel you
could not seat). Do not add a hold in prose:
panel provenance mode (`isolated` / `inline`), an author↔router collapse, or
any other unenforced concern is **not** a merge condition, and a 🟢 that meets
every clause above merges even when the panel ran inline. A genuinely new hold
takes an ADR *plus* a matching server-side check in `pr-merge.mjs`, so that a
stated rule and an enforced rule cannot diverge.

Build the decisions payload (schema in the script header) with `reviewers[]` =
the ≥3 nominated personas whose green markers you verified.

**First, un-draft every PR you are about to merge — you, not the engine.**
GitHub refuses to merge a draft, so the draft→ready flip has to happen before
the merge PUT. That flip exists **only** as the GraphQL mutation
`markPullRequestReadyForReview`; the REST "Update a pull request" endpoint has
no `draft` field. `pr-merge.mjs` still carries the mutation as a fallback, but
it cannot succeed from here: a CCR session's raw HTTPS to `api.github.com`
goes through the agent proxy, which serves **no GraphQL at all** — even a
read-only `{viewer{login}}` returns `403 "This GraphQL query is not enabled
for this session"`. A deterministic script has only raw HTTPS, so the engine
can never make this call. Your session can: the GitHub MCP connector
(`agent-runner.md` §7) runs server-side, outside that proxy. So for each PR
whose decision is `merge` and which is still a draft, call the MCP tool

    update_pull_request(owner, repo, pullNumber, draft: false)

and confirm it returns before invoking the engine. Then:

```sh
TOKEN="…" node workforce/skills/pr-autopilot/pr-merge.mjs \
  --repo "<owner>/<repo>" --decisions /tmp/pr-merge-decisions.json
```

`pr-merge.mjs` re-verifies the full predicate server-side and **fails
closed** — an unreadable/markerless target governance doc, a missing green
marker, a sub-3 panel, an `autopilot:off` label, or cycle > 7 all refuse the
merge. A mis-judged 🟢 cannot cause a bad merge.

**A refusal is a hand-off, not a no-op.** If `pr-merge.mjs` exits `2` (any
decision refused server-side or a GitHub write rejected), do not retry blindly
and do not stop: post the verdict for the affected PR again via
`pr-autopilot-post.mjs --needs-human`, quoting the engine's refusal reason —
the engine has already stamped the refusal's `autopilot:reason:<code>` on the
PR; reuse that code (or `--reason merge-engine-refusal`) in the re-post.
The run still ends in one of the two terminal states.

## Step 6 — terminal-state sweep (deterministic; run every fire)

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-autopilot/pr-autopilot-sweep.mjs \
  --project "<project_id>" --apply
```

The sweep enforces the two-outcome contract mechanically. It escalates (label
+ hand-off comment) any open PR that is in **neither** terminal state:

- **unlabelled-handoff** — a hand-off marker exists but the label was dropped
  (a session-driven escalation that bypassed the stamper; ML-009).
- **stale-routed** — routed, but no terminal state after `--stale-hours`
  (default 48) without an update — a stalled run or an abandoned 🟡.
- **never-routed** — never picked up and now older than the scan's discovery
  window (default 7 days), so the cadence would never see it again.
- **author-stale** (adr-0022) — in the author lane but untouched for
  `--author-stale-hours` (default 36): `pr-remediate` is not coming.
- **remediation-cap-exceeded** (adr-0022) — in the author lane with all 3
  attempts spent. Both author-lane kinds *move* the PR: the amber label is
  cleared as the red one is stamped, so it is never in two queues.

PRs labelled `autopilot:off` (maintainer pause) or already labelled
`autopilot:needs-human` are never touched. Run it even when Step 1 found 0
candidates — the sweep is how the contract survives runs that die mid-cycle.

## Scope (this skill)

- **Drive the whole cycle**: route → review → verdict → **merge or escalate**.
  Stopping at a routing comment or a bare 🟢 verdict is an incomplete run.
- **The verdict is the panel's consensus** (≥3 distinct reviewers; the engine
  fails closed below 3) — reported with its provenance: the lenses share one
  context, so the verdict states that and never claims independent
  convergence.
- **Merge is bounded to non-L0/L1 + consensus + delegation** (R-N10). A PR on
  the target's governance L0/L1 always escalates to a human. No push or
  PR-open under any path.
- **The sweep is part of every fire.** No PR is left in neither state.
- **Agent-fixable ≠ human-gated** (adr-0022/adr-0023). A conflict, a behind
  branch, an open finding — and a 🔴 veto that names a defect in the diff — go to
  the author lane (`pr-remediate`) with the brief that says what to change,
  bounded by the cycle budget, the attempt cap and the sweep; the human lane
  keeps what only a human may decide: premise and scope, L0/L1, delegation, and
  a review loop that has spent its cycles.

**OP-009 (operator-only runtime wiring).** The event trigger this contract is
agnostic to — the CCR `agent-runner` routine's `pull_request`
(opened / ready_for_review / synchronize) trigger + the target-repo webhook —
is configured by the operator per
[follow-ups.md OP-009](../../docs/follow-ups.md) (design:
[adr-0013](../../docs/adr/adr-0013-event-driven-pr-autopilot.md)). Nothing in
this repo implements it; until it is wired, the cron fire is both the latency
floor and the backstop.

Related: [agent-runner.md](../../docs/routines/agent-runner.md) (the generic
CCR routine this runs under — this SKILL.md is the authoritative contract),
R-N10 in [workforce governance](../../docs/governance.md) + adr-0010/0011/0013/0014/0015/0022/0023
(the merge predicate's decision trail), [dev-process.md](../../docs/runbooks/dev-process.md), [issue-to-merge-flow.md](../../docs/runbooks/issue-to-merge-flow.md), [pr-remediate](../pr-remediate/SKILL.md).
