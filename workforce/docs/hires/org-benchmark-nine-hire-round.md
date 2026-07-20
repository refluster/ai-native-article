# 2026-07 — Org-Benchmark Nine-Hire Round (Priya's hiring memo)

- **Operator request**: 2026-07-17 — following the unicorn-benchmark org review (Midjourney / Cursor / Perplexity / ElevenLabs / Ramp vs. our 44-agent roster) and the roundtable synthesis published as the L3 analysis *実行が溶けると組織図は判断の地図になる*, hire the top-ranked missing positions **#1–#9** from the benchmark gap analysis (the #10 English-edition editor is explicitly deferred), develop one weekly Cadence per hire for the position's core action, and re-bind existing skills where a new hire is the better-qualified holder.
- **Lead**: Priya Halvorsen (VP People & Legal), with the gap analysis itself as the sourcing document.
- **Panel basis**: the three-axis rubric the operator set — (A) improvement to current project progress, (B) opportunity loss / new projects unlocked, (C) advancement of the science & anatomy of AI–human collaborative organizations.
- **Status**: Proposal. Registration bundle staged (`workforce/seed/org-benchmark-group/`), draft PR. W-3 impact in §6. Rebind proposals (B-authority) in §7.

## §1. What the benchmark exposed

The full analysis lives in the published L3 and the session record; the hiring-relevant summary:

1. **Closed-design loops left unstaffed.** The multi-candidate/multi-judge quality layer stamps `systemPromptVersion` + judge scores into published frontmatter *so that* GA4 can close an outer loop — and no seat reads that data. The editorial quality layer itself has no operational owner.
2. **The org's own deferred gaps.** SDET (deferred twice, epic-009 Q2 → Q2-round §4/§8), red-team (India-desk memo §5 row 18 "round-2 candidate"), "does Sora need a VP" (deferred three rounds running).
3. **Research fragmented across five sites** (Sora; policy group; India desk; Amara; Bruno) with no craft owner.
4. **The scarce resource moved.** Execution cost collapse moved the binding constraint from payroll to **operator attention** — and no seat manages that budget.
5. **Zero inbound listening.** Publishing is thick (articles, podcast, feed, self-marketing); listening is nil (no newsletter, no reader dialogue).

## §2. The nine hires

| # | Slug | Name | Role | Reports to | Weekly Cadence |
|---|---|---|---|---|---|
| 1 | `ingrid` | Ingrid Solberg | Managing Editor | elena | `editorial-desk` |
| 2 | `tomas` | Tomas Lindqvist | Organizational Performance Scientist | mateo | `org-metrics-pulse` |
| 3 | `camille` | Camille Fontaine | Chief of Staff | maya | `attention-ledger` (Monday) |
| 4 | `dmitri` | Dmitri Volkov | Growth & Reader Analyst | ingrid | `reader-signal` |
| 5 | `rafael` | Rafael Ortiz | Red Team & Adversarial Reviewer | maya (independent) | `red-team-audit` |
| 6 | `beatriz` | Beatriz Salazar | VP, Research | maya | `research-sync` |
| 7 | `owen` | Owen Nakamura | SDET / Verification Engineer | dario | `verification-sweep` |
| 8 | `zoe` | Zoe Anagnos | Memory Curator / Organizational Ontologist | mateo | `memory-hygiene` |
| 9 | `imogen` | Imogen Wells | Audience Development & Community Editor | celeste | `audience-loop` (experiment engine) |

All Cadences are **weekly** (operator default for this round: no position argued for a different frequency). All land via the standard cadence path (executor `claude-code-routine`, deterministic bundled `post.mjs`, `workforce.feed_write_token`), staggered across weekdays — Monday opens with Camille's attention ledger so the operator's week starts from the ranked decision surface. Bindings are declared in `wire-cadences.mjs` and land **paused**; enabling the weekly schedule is the standard B-authority flip (§5 of governance).

## §3. Org-design notes (the management-layer review each round owes)

- **Two new seats report to Maya** (camille, rafael) **plus one new VP** (beatriz): Maya's span goes 9 → 12. This is deliberate for rafael (independence from every delivery VP is the point of a red team) and camille (the CoS *is* the span-management instrument — her job is to make the widened span cheaper than the narrower one was). If the span proves noisy, the §8 open question names the fold-back options.
- **Elena's span 4 → 5** (ingrid), **Mateo's 4 → 6** (tomas, zoe), **Dario's 2 → 3** (owen), **Celeste's 4 → 5** (imogen). All within precedent (Tessa carries 6 today).
- **ingrid carries a direct report (dmitri) from day one** — the first non-VP hire with a report since Corinne. Precedent: the IR pod's "single lead absorbs ICs" pattern (ir-reporting round §3).
- **beatriz is a horizontal VP** — she owns research *craft* across desks, not the desks themselves. Tessa and Anjali keep their lines. The three-rounds-deferred "does Sora need a VP" question is answered here: **proposed re-parent of `sora` → `beatriz`** (B-authority persona mutation; operator approves — see §7).

## §4. Rubric scoring (the operator's three axes)

Recorded for the round's audit trail; the full argument is in the session analysis. A = current-project progress, B = opportunity loss / unlocks, C = collaboration-science advancement.

| Hire | A | B | C | The one-line case |
|---|---|---|---|---|
| ingrid | ◎ | ◎ | ○ | The product's quality layer finally has an operator-side owner. |
| tomas | ○ | ○ | ◎ | Epics 016/019/020 get their scientist; the org becomes its own dataset. |
| camille | ◎ | ○ | ◎ | The scarce resource (operator attention) gets a budget manager. |
| dmitri | ◎ | ◎ | ○ | The already-built outer loop (promptVersion × GA4) gets read. |
| rafael | ○ | ○ | ◎ | Institutionalized disagreement; the deferred red-team gap made a seat. |
| beatriz | ○ | ◎ | ○ | Research craft unified across five sites; the Sora question answered. |
| owen | ◎ | ○ | ○ | Test depth bounds the autopilot envelope; the twice-deferred SDET. |
| zoe | ○ | ◎ | ◎ | Memory decays faster than human orgs'; curation speed must exceed decay. |
| imogen | △ | ◎ | ○ | The listening side exists at last — as an experiment engine, not a program. |

## §5. Why #9 ships as an experiment engine

The operator flagged that the right audience initiative is **not yet known**. Rather than guess a program, `audience-loop` is built as a weekly propose → smallest-version → measure → keep/kill loop. The first iteration is documented inline as an **example, explicitly revisable**: a weekly Japanese reader digest staged as a draft for the operator to send (imogen drafts, never sends — the standard informs/never-acts boundary). If three consecutive experiments die, that is a finding about the audience, not a failure of the seat.

## §6. W-3 cost impact

Nine seats at the standard IC default USD 5/mo (beatriz at 8 as a VP) ≈ **+48/mo requested**. The 2026-07-14 raise to **500** explicitly banked "standing expansion headroom (operator direction)"; this round spends part of that headroom and **requests no cap raise**. `register.mjs` carries `W3_CAP_USD = 500` and the write-time validator enforces the envelope per ADR-0007 — an over-cap registration fails loud at the API, not silently.

## §7. Rebind proposals (B-authority — operator approval required, one persona per mutation)

Per adr-0012, binding is decoupled from ownership; per W-5/§5, mutating an **existing** persona's bindings escalates. The round proposes, the operator disposes:

| Skill | Binding today | Proposed | Rationale |
|---|---|---|---|
| `article-level2` | elena | **ingrid** | The Managing Editor is the article pipeline's operational owner; Elena keeps brand/CX. |
| `article-level3` | elena | **ingrid** | Same. |
| `vp-monthly-report` | ~~maya~~ → **WITHDRAWN** | — | Execution finding (2026-07-20): the binding was never maya's — it is a **per-VP fan-out** (elena, dario, priya, mateo, silas, celeste, tessa each write their own report; the skill's `owners:[maya]` records authorship, not binding — adr-0012). Moving it to camille would replace "each VP reports in their own voice" with "the CoS compiles", a design change this round doesn't own. Camille's aggregation need is already served by `attention-ledger`. |
| (re-parent) `sora.reports_to` | maya | **beatriz** | The three-rounds-deferred question, answered per §3. |

**Execution record (operator-approved, 2026-07-20).** register.mjs ran clean — all nine created + verified (+48/mo). wire-cadences.mjs wired all nine weekly bindings (Mon–Fri stagger as declared; live from the next orchestrator tick). `--include-rebinds` moved article-level2/3 elena → ingrid; the vp-monthly-report move was withdrawn per the finding above. `reparent-sora.mjs` (added post-merge) moved sora → beatriz, GET-verified. Roster: 44 → 53.

Mechanics: `wire-cadences.mjs --include-rebinds` performs the three binding PATCHes behind a loud B-authority banner (default OFF); the `sora` re-parent is a single agents-api PATCH the operator runs (or approves in chat for an agent to run). `owners[]` amendments (authorship/improvement credit: ingrid onto article-level2/3, the nine onto `feed-post`) follow as the standard owners-amendment PR after the operator rules on the rebinds, mirroring the grid-watch precedent.

## §8. Open questions for the operator

1. **Maya's span (12).** Accepted as the price of red-team independence + the CoS instrument, or should rafael report to beatriz (research-adjacent independence) once she's established?
2. **dmitri under ingrid vs. nadia.** Placed under the Managing Editor to pair the outer loop with the desk that acts on it; the PM-side placement remains arguable if reader analytics starts driving product shape beyond articles.
3. **Enabling the nine weekly crons.** Staged paused; one B-authority flip when the operator is ready. Suggested order: attention-ledger first (it makes the other eight cheaper to supervise).

## §9. Files in this round

- `workforce/seed/org-benchmark-group/{slug}.json` + `{slug}-system.md` × 9 — registration inputs (ADR-0007: DDB becomes authoritative on registration; these files are one-shot inputs, not a mirror).
- `workforce/seed/org-benchmark-group/register.mjs` — one-shot POST /agents, parent-before-children, W-3-capped.
- `workforce/seed/org-benchmark-group/wire-cadences.mjs` — weekly bindings (paused) + `--include-rebinds` (B-authority, default OFF).
- `workforce/skills/{editorial-desk,org-metrics-pulse,attention-ledger,reader-signal,red-team-audit,research-sync,verification-sweep,memory-hygiene,audience-loop}/` — nine first-version Cadences (Rule 11 documented exception).
- This memo.
