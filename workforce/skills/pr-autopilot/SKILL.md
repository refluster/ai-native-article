---
name: pr-autopilot
description: Workforce skill that drives an open PR through its **full** review cycle in a bound project's repo — route to 1-3 reviewer personas, obtain their reviews, synthesise the unanimous-green / 🟡 / 🔴 verdict, and complete. **Every open PR is in scope — draft and non-draft, human- and bot-authored (Dependabot).** On a unanimous-green verdict for a PR that touches **no L0/L1 governance path** of the target repo, it approves + merges via the shared fail-closed pr-merge.mjs engine; a PR touching the target repo's **governance L0/L1 escalates to a human** for the final call (R-N9 / W-5), as does any non-consensus PR. The merge predicate (adr-0010, 2026-06-17) widened from the old Dependabot safe class to "not-L0/L1 + unanimous reviewer consensus"; the engine re-verifies it server-side and fails closed. Runs as a CCR task (ADR-0005); github.token via the binding's project linkage (Epic-010 §5).
---

# pr-autopilot (CCR routing leg — fired on cron OR a pull_request event)

You are routing pull requests in your bound project's repo to reviewer personas under your lens. This runs as a **CCR task** fired either by `wf-orchestrator-tick` on the binding's cron, OR — when the binding declares a `github_event` trigger ([adr-0013](../../docs/adr/adr-0013-event-driven-pr-autopilot.md)) — on a `pull_request` event seconds after the PR opens. The cadence is **trigger-agnostic**: there is no `pr_url` argument either way — you **discover** which PRs need routing (the scan skips already-routed ones, so an event-fired and a cron-fired run do the identical, idempotent thing), then route each one.

Your task context supplies:

- `agent_slug` — you (the routing persona; today Nadia's PdM lens).
- `project_id` — the bound project. Its `workforce/projects/{project_id}/project.json` declares the GitHub repo (`github.owner` / `github.repo`).
- `credentials['github.token'].token` — the project-scoped PAT, resolved via the project linkage. Export it as `GITHUB_TOKEN` for the scripts below.
- `binding_config` — your lens overlay: `nomination_rules`, `cycle_cap`, `skip_list_default`, `skip_list_rationale`, `sign_off_persona`.

## Step 1 — discover candidate PRs (deterministic, read-only)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-autopilot/pr-autopilot-scan.mjs \
    --project "<project_id>" --persona "<agent_slug>" \
    --max 5 --since-days 7 --out /tmp/pr-autopilot-candidates.json
```

The scan lists **every** open PR updated within the window — **draft and non-draft, human- and bot-authored (Dependabot)** — **skips only any PR you have already posted a cycle-1 routing comment on**, caps at `--max` (default 5), and writes each remaining candidate (title, body, diff, existing comments, plus `draft` / `is_bot` flags) to the `--out` file. If it reports **0 candidates**, there is nothing to route this tick — **stop here, post nothing.**

> **Drafts and bots are in scope (adr-0010).** Drafts get an early review pass so issues surface before "Ready for review"; Dependabot/bot PRs route through the **same** review→consensus→merge path as human PRs (the old no-review `dependabot-triage` lane is retired). Note the candidate's `draft` / `is_bot` flags when you write the routing comment, but route them like any other PR.

## Step 2 — route each candidate (your judgment)

Read `/tmp/pr-autopilot-candidates.json`. For **each** candidate PR, apply your `binding_config.nomination_rules` to the PR's diff + body:

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

— <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)
```

Omit the "Skipping …" line if you skipped no one. `<PersonaName>` is your `agent_slug` capitalised (e.g. `nadia` → `Nadia`).

## Step 3 — post each routing comment (deterministic, comment-only)

For each candidate you wrote a body for:

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
    --project "<project_id>" --pr <number> --body-file /tmp/route-body-<number>.md
```

`pr-autopilot-post.mjs` posts **only** an issue comment — there is no code path in *that* script to approve, request changes, merge, push, or open a PR (R-N9 / W-5). Exit 0 means the comment landed. (The bounded R-N10 merge in Step 5 goes through a separate, fail-closed script — never through `pr-autopilot-post.mjs`.)

## Step 4 — obtain each nominated review (drive the cycle; do not stall)

**This is the step whose absence left #530/#514 stuck at a lone routing comment.** Routing alone is not the job — you must ensure each nominated reviewer's review actually lands, then proceed. For **each** persona you nominated in Step 2, **apply that persona's review lens inline and post it as that persona** — a COMMENT review (`event=COMMENT`, never approve/request-changes per W-5). The cycle must **not** stall waiting on a dispatch that does not exist. There is no separate `pr-review` skill — this skill owns the whole cadence end-to-end; the reviewer-lens contract below is the contract (it was folded in when `pr-review` was retired).

**Reviewer-lens contract (inline — apply per nominated persona):**
- **The lens** = that persona's voice + their skill-judgment config (`lens_name`, `values`, `checklist_sections`, `escalation_triggers`, `bias_disclosure_template` on their `AGENT#{slug}` record). Scan the diff for violations *in that lens only*; silence on an item means "looks good" — post only real findings.
- **Inline findings** lead with a finding-ID (section letter + integer, e.g. `A1`), name the checklist section, cite `file:line`, 1-3 sentences, suggest the fix concretely. Cycle-2+ comments cite the cycle-1 finding-ID they map to (or flag `[NEW]`).
- **Summary body**: opening verdict signal (🟢/🟡/🔴 from this lens) → section-by-section notes → **sign-off** `— {persona} (LLM persona; lens: {lens_name}; manual route via pr-autopilot)` → a **bias-disclosure** paragraph (mandatory: it is an LLM persona; what it DID / did NOT do).
- **Escalation instead of review**: if the PR matches the persona's `escalation_triggers` (e.g. a governance §2 / L0 amendment, an R-rule loosening without amendment, a destructive force-push), post a single comment naming the trigger + "requires explicit operator approval", and do not run the checklist. This is a hand-off to a human, so it follows the escalation-labelling rule (Step 5.2): the comment embeds `<!-- autopilot:needs-human -->` and is posted with `--needs-human`.

Each posted review is a real lens review — concrete findings citing the PR surface, or an explicit "no findings from this lens". When every nominated review is posted, go to Step 5.

> **Green sign-off marker (machine-checkable consensus — adr-0010 / Sana B1).** When a reviewer's lens is **non-blocking** (their findings are all ✅/📥/💬, no 🔴), their posted review **must embed the exact hidden marker** `<!-- autopilot:review:{slug}:green -->` (e.g. `<!-- autopilot:review:dario:green -->`), where `{slug}` is that reviewer's agent slug. This is the **only** signal the merge engine accepts as that reviewer's green vote — it does not parse bylines or prose. A reviewer who is blocking (🔴) or has an open finding **omits** the marker (or writes `:red`). No marker ⇒ that reviewer is "not green" ⇒ the merge fails closed.

## Step 5 — verdict by reviewer consensus + completion (+ bounded merge)

Now that the nominated reviews exist (you produced/dispatched them in Step 4, or they arrived on a prior tick), **synthesise the reviewers' collective verdict** — you do not re-review, and the verdict is **not** your solo call. It is the **consensus of all nominated reviewers**:

1. **Aggregate the reviewers (unanimous-green rule).** Read every nominated reviewer's findings + the author's response commits. The colour is:
   - **🟢 unanimous-green** — *every* nominated reviewer is non-blocking (their findings are all ✅ fixed / 📥 deferred / 💬 nit; none left a 🔴 or `CHANGES_REQUESTED`). One reviewer short of green ⇒ not green.
   - **🟡** — one or more reviewers have an open blocking finding. Next tick re-routes (cycle += 1) once the author revises.
   - **🔴** — any reviewer's 🔴 is a **veto**, or cycle > `cycle_cap`, or a scope question you can't decide. Escalate to the operator.

   Write a verdict comment that names each reviewer's load-bearing finding and how it resolved, states the aggregated colour, and post it **with `pr-autopilot-post.mjs`** — that script is the **only** path that applies the escalation label, so the verdict/hand-off comment must go through it, **never** a raw issue-comment API call, `gh`, or an MCP comment tool (any of those drops the label — this is exactly how #353's L0/L1 hand-off reached the operator un-labelled). Flags by outcome: **comment-only** for a 🟡 re-route, or **`--needs-human`** for any hand-off (🔴 / 🟢-but-L0/L1 / no-delegation — see 5.2), composed into the hand-off template in 5.2 so the marker is present by construction.
2. **Complete the cycle** — never leave it open. **Escalation ALWAYS carries the `autopilot:needs-human` label — no exceptions.** Every comment that hands a PR to a human MUST (a) embed the hidden marker `<!-- autopilot:needs-human -->` in the verdict body **and** (b) be posted with the `--needs-human` flag. `pr-autopilot-post.mjs` stamps the canonical label from *either* signal (belt-and-suspenders, so a forgotten flag still labels from the marker), so the operator finds the whole queue with `is:open label:autopilot:needs-human`:
   - **🟢 unanimous-green + touches NO L0/L1 path** → approve + merge via the engine below. (No marker, no `--needs-human` — it merges.)
   - **🟢 unanimous-green + touches the target repo's governance L0/L1** → **escalate to a human** for the final call. Post the verdict **with the `<!-- autopilot:needs-human -->` marker and `--needs-human`**, and tag the operator (`L0/L1 change — operator's final call per W-5`). Do **not** merge.
   - **🟡** → the verdict lists the required fixes; re-route next tick. (No marker / no `--needs-human` — it stays in the cycle, not the human queue.)
   - **🔴** → escalate: post the verdict **with the marker and `--needs-human`**, state the blocking reason, tag the operator. Do not merge.
   - **Any other hand-off** (no R-N10 delegation, unreadable governance, a scope question you can't decide) → same rule: marker + `--needs-human`.

   **Hand-off verdict template — compose the verdict *into* this block, never freehand** (the trailing marker is the mechanical half of the guarantee: it forces the label even if `--needs-human` is ever dropped, and it is only reliably present if you start from this template — Step 2 has the analogous routing template):
   ```md
   **<PersonaName> — verdict, cycle <n> of ≤ <cycle_cap>. <🟢 escalate / 🔴 / hand-off>.**

   <one-paragraph synthesis: each nominated reviewer's load-bearing finding and how it resolved, then the aggregated colour>

   **Handing to the operator — <reason>.** <e.g. "🟢 consensus, but touches L0/L1 path `<file>` — operator's final call per W-5"; or "🔴 <reviewer>'s blocking finding"; or "no R-N10 delegation".> Not merging.

   — <PersonaName> (CCR persona; see workforce/skills/pr-autopilot/SKILL.md)

   <!-- autopilot:needs-human -->
   ```
   So every hand-off comment is posted as:
   ```sh
   GITHUB_TOKEN="<…>" node workforce/skills/pr-autopilot/pr-autopilot-post.mjs \
     --project "<project_id>" --pr <number> --body-file /tmp/verdict-<number>.md --needs-human
   ```
   and the verdict body ends with the marker line `<!-- autopilot:needs-human -->` (the template above already carries it). The `pr-merge.mjs` engine independently stamps the same label on any tracking **issue** it files (`action:"escalate"`), and the label name is single-sourced (`ESCALATION_LABEL`) across both scripts — so PR hand-offs and issue escalations share one searchable queue. **A hand-off comment with no `autopilot:needs-human` label is a cadence bug, not a finished run.**

### The merge leg — unanimous-green, non-L0/L1 only (R-N10 / adr-0010)

Autonomous merge widened (adr-0010) from the old Dependabot safe class to **"the reviewers reached unanimous green AND the PR touches no L0/L1 governance path of the target repo."** L0/L1 changes always go to a human. Emit a merge **only** when *all* hold (otherwise: verdict comment only, hand off / escalate):

- The aggregated verdict is **🟢 unanimous-green** (no reviewer blocking), and
- the bound `project_id` has an **R-N10 delegation** (the target repo's own statute grants the workforce autonomous-merge authority — e.g. `PSVL/asp-cloud` → `docs/adr_autopilot_pr_merge.md`; if none, never merge), and
- the PR touches **no L0/L1 path** declared in the target repo's own `docs/governance.md` (between the `<!-- autopilot:l0l1-paths -->` markers), all required checks are green, the PR is mergeable/clean, and no reviewer left `CHANGES_REQUESTED`.

When those hold, build the decisions payload (schema in the script header) — one `{ pr, action:"merge", comment, squash_subject, squash_body, reviewers:[...] }` where `reviewers` is the nominated set whose unanimous sign-off you are attesting (each must have posted their `<!-- autopilot:review:{slug}:green -->` marker per Step 4) — and run the **shared** merge engine:

```sh
TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-autopilot/pr-merge.mjs \
    --repo "<owner>/<repo>" --decisions /tmp/pr-merge-decisions.json
```

`pr-merge.mjs` **re-verifies the full predicate server-side and fails closed**: it reads the target repo's `docs/governance.md` to learn the L0/L1 path set (if that doc is unreadable or declares no L0/L1 block, the set is *unknown* and the merge is **refused** — never guessed), then confirms open + mergeable + clean, **no `autopilot:off` label** (the per-PR maintainer pause; the repo-wide pause is emptying the target's `autopilot:l0l1-paths` block), no L0/L1 file in the diff, all checks green, no `CHANGES_REQUESTED`, and that each reviewer in `reviewers[]` posted their exact `<!-- autopilot:review:{slug}:green -->` marker (not a byline — an exact hidden token, so prose can't fake a vote and a format change can't drop one). A mis-judged "🟢 + eligible" therefore cannot cause a bad merge. Exit `2` = a decision was refused server-side or GitHub rejected the write; surface it, do not retry blindly. For an L0/L1 PR or a non-consensus PR, emit **no** merge decision — the verdict comment is the deliverable and a human decides.

> **The terminal state is the merge, not the verdict.** Where the merge predicate holds, *this skill finishes the job* — it approves and merges; stopping at a 🟢 verdict and handing off is **incomplete**, not a finished run. Drive every cycle to one of: **merged** (predicate held) or an **explicit hand-off/escalation** (a stated reason the predicate did not hold). Never leave a 🟢 PR sitting with no terminal action.
>
> **When a 🟢 does *not* autonomously merge (and that is correct).** The autonomous merge requires a *delegated, declared* target. A 🟢 does not self-merge when:
> 1. **No R-N10 delegation** for the bound project (the target's own statute never granted autonomous merge) → hand off, verdict names this.
> 2. **No `autopilot:l0l1-paths` block** in the target's `docs/governance.md` → the L0/L1 set is unknown → the engine fails closed → hand off.
>
> These are not bugs in the cadence; they are the guard working. **The workforce's own repo (`refluster/ai-native-article`) is *not* an exception ([adr-0011](../../docs/adr/adr-0011-own-repo-autopilot-merge.md)):** it carries the delegation + the L0/L1 block ([root `docs/governance.md` §4.4](../../../docs/governance.md)) and is merged exactly like an external delegated target — a reviewed, non-L0/L1 🟢 merges; a PR on the L0/L1 boundary (governance / ADR / identity / schedule / production paths) escalates to the operator like on any repo. (The former own-repo `SELF_REPO` escalation guard was retired by adr-0011; W-5 is unaffected — all operator-only Zone A files are inside the L0/L1 set.)

## Scope (this skill)

- **Drive the whole cycle — don't stop at routing.** route → obtain each nominated review → synthesise verdict → complete (merge or hand off). A PR left at a lone routing comment is a bug (the #530/#514 failure), not a finished run.
- **The orchestrator, keeping the `pr-review` skill.** `pr-review` is the standalone reviewer contract; pr-autopilot *drives* it — dispatching it to bound personas, or (until dispatch is wired everywhere) applying each nominee's lens inline per that contract. pr-autopilot decides *who* reviews and *what the verdict is*; `pr-review` defines *how* a single lens review is shaped.
- **Every open PR is in scope.** Draft, non-draft, human-authored, and bot-authored (Dependabot) PRs all route through the same review→consensus→merge path (adr-0010). The retired `dependabot-triage` no-review lane is no longer the bot path.
- **The verdict is the reviewers' consensus, not your solo call.** Merge needs unanimous green; one reviewer short, or any 🔴 / `CHANGES_REQUESTED`, blocks it.
- **Merge is bounded to non-L0/L1 + consensus (R-N10 / adr-0010).** A PR touching the target repo's governance L0/L1 always hands off to a human (the operator's final call). No push or PR-open under any path. The engine re-verifies and fails closed.

Related: [agent-runner.md](../../docs/routines/agent-runner.md) (the generic CCR routine this skill runs under — there is no per-skill routine spec; this SKILL.md is the authoritative contract), [R-N10 governance](../../docs/governance.md) + [adr-0010](../../docs/adr/adr-0010-autopilot-merge-consensus-widening.md) (the widened merge predicate). The former `dependabot-triage` (no-review bot lane) and `pr-review` (separate reviewer skill) have both been **retired/deleted** — this skill now owns the entire route → review → consensus → merge cadence; bot PRs and human PRs alike route here. [dev-process.md](../../docs/runbooks/dev-process.md).
