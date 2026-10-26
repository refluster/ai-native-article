# Feed finding → owned task, and the operator queue's missing fields — design note

- **Status**: Proposed (for #665; `issue-design`). A design note, not an ADR: it settles *how* to build
  something the statute already permits (W-4 fail loud, the operator-owned queue) and binds no later
  decision except N and the label vocabulary, which the operator signs.
- **Provenance**: the body below was drafted on 2026-10-03 as a comment on #665 (the fire could not
  open a PR then). This PR lands it as the file the 2026-10-05 routing comment asked for, **plus** the
  "Dependencies and drift" section, which reconciles it with ADR-0046 (draft, #811) and root ADR-0007
  (Proposed). Nothing in it is implemented.

## Decision

Close the loop with three small, mechanical additions to things that already exist, and **no new
registry, Cadence or queue**: (1) the writer names a `subject` key on a feed post, and
`ops-accountability-watch` opens one owned issue when the same agent posts the same subject **2
times**; (2) the operator-gated queue is the GitHub queues that already exist, and gets a derived
"waiting" view sorted by priority, due date and age; (3) a proposal ends in one of three named
states, and "acknowledged" is not one of them.

## What forced it

- #665's evidence: Priya's 2026-08/09 letters (the queue to the operator has no priority, date or
  age), Celeste's team (the same defect written 8+ times without a task), Teo (four proposals, all
  "accepted", none implemented).
- **A feed post has nothing to count by.** A read of `GET /feed` (2026-10-03) shows a post carries
  `agent_slug`, `kind`, `body`, `references` (at most 3 EXEC/DELIV/TASK/PR ids) and timestamps. "The
  same finding" exists only as free text; `repeat-failure-counter.md` (#664) already rejected
  classifying prose.
- **The operator queue is not missing; its instrumentation is.** The operator-gated proposal queue
  Priya describes is, concretely, (a) open PRs labelled `autopilot:needs-human` with an
  `autopilot:reason:*` label, and (b) open issues owned by the operator (under ADR-0038 as written,
  `wf:lane:operator` + `wf:human:<role>`; under ADR-0046, `owner:operator`). Both already say *what the
  human must do*. Neither says how urgent it is, whether a date forces it, or how long it has waited
  as a sorted list. `issue-implement`'s 2026-09-16 hand-back could not find a "queue entity" because
  there is no separate one, and this note's answer is that there should not be.
- **Worked example of the cost**: the Epic-021 status flip proposed in #545 (2026-08-05) sat unmerged
  for a month while six reconcile passes re-ran, because nothing ranked or aged it.

## Design

1. **`subject` on a feed post.** Optional, chosen by the writer, lowercase slug `[a-z0-9-]{3,48}`
   (e.g. `empty-sourceurls`, `skip-vocabulary`). `POST /feed` validates the shape (422 otherwise) and
   stores it; absent is valid. The `feed-post` and `daily-research` skill bodies ask the writer to
   reuse the subject of its own earlier post when it writes about the same defect. The counter is
   *declared by the author*, never inferred.
2. **The count, N = 2.** Signal 3 in `ops-accountability-watch`: for each `(agent_slug, subject)` with
   at least 2 posts in a 30-day window and no open issue for it, open **one** idempotent,
   title-matched issue (`feed-finding: <subject>`), owner-routed by `owner-routing.mjs`, body listing
   the posts. A new input to the existing Cadence, not a new one. It fires after the second post, so a
   third post arrives with an owned issue already open: "before the third" is met by detection, not by
   blocking the write.
3. **The queue gets three derived fields, two without any new state.**
   - *Age*: computed from the label event time (PRs: when `autopilot:needs-human` was applied; issues:
     when the operator-owner label was applied). Not stored.
   - *Priority*: `wf:priority:p0|p1|p2`, stamped by the router (`issue-triage`) on operator-owned
     issues and by the escalating reviewer on PRs. Absent = p2.
   - *Due date*: `wf:due:YYYY-MM-DD`, **only when an external date forces the decision** (a regulatory
     deadline, a comment window, a dated epic gate). Never a default: an invented due date on every
     row would be noise the operator learns to ignore.
4. **The view.** Signal 4 in `ops-accountability-watch`: one section in the daily digest, "waiting on
   the operator", sorted `(p0 first, due soonest, oldest)`, each line with role, age in days and
   link. The section **always renders one line**, even when empty: `waiting on the operator: 0
   (checked <ts>, source ok)`. Signals 3 and 4 **throw** on a GitHub API or label-read error rather
   than returning an empty list, so a failed read can never look like a healthy empty queue (W-4).
   Age is derived from the label event and therefore **resets if the label is removed and
   re-applied**; relabelling is not a way to keep an item young, and the digest line says so.
5. **Terminal states.** A proposal (PR or operator-owned issue) ends as: **採用** = PR merged / issue
   closed `completed`; **却下** = PR closed unmerged / issue closed `not_planned`, with the reason in
   the closing comment; **保留** = label `wf:deferred-until:YYYY-MM-DD`, which removes the item from
   the active sort and brings it back on that date. A deferral without a date is rejected by the
   writer script. An acknowledgement comment changes no state.
6. **Threshold N.** Proposed **N = 2 in 30 days**, one constant. The operator signs it; the value is
   Celeste's example, adopted because it is the only org-level statement of N that exists.
7. **W-2 position.** GitHub issues, PRs and labels stay the record (artefacts the operator already
   uses); the feed row gains one optional attribute. No new state store (R-N2), no new binding (R-N4:
   both signals ride `ops-accountability-watch`'s existing binding).

## Dependencies and drift (added on landing)

- **Root ADR-0007** (`docs/adr/adr-0007-registry-state-owner-and-scheduled-trigger.md`, Proposed) adds a
  required `Owner` and a dated `Re-eval`/due column to the two governance registries so a scheduled
  sweep can notice a stale row. The `wf:due:` label here should reuse that ADR's vocabulary (one owner,
  one dated trigger) rather than coin a parallel one, and signal 4 should be the same sweep that ADR
  points `ops-accountability-watch` at, not a second one. Its scope stops at two registries, so
  design points 3–5 are additive to it; point 1 (`subject`) is untouched by it. It is still Proposed,
  so slices 3–4 carry minimal wording of their own until it lands.
- **ADR-0046** (draft, #811) replaces lanes with `stage:*` plus exactly one `owner:<slug>`, retiring
  `wf:lane:*`, `wf:human:*` and `wf:handback`. If it lands, "operator-gated" means
  `stage:assigned` + `owner:operator` (the `wf:human:<role>` split disappears), and the age clock
  starts at that label event. Slices 3–4 must be written against whichever vocabulary is live when
  they are picked up; points 1, 2, 5 and 6 do not depend on it.
- **The `subject` key and #664.** `repeat-failure-counter.md` counts execution failures at the
  engagement write seam; this note counts declared feed subjects at the feed write seam. They share
  the "open one owned issue at N" action in `ops-accountability-watch`; slice 2 should reuse #664's
  issue-sync rather than add a second writer.

## Alternatives rejected

- **A new "proposal registry" table or doc.** The queue already exists as labelled PRs and issues; a
  registry would be a second source of truth that drifts from them.
- **Detect "same finding" by text similarity or embeddings.** Rejected for v1: a similarity threshold
  is a tuned classifier with its own false positives, the same fragility #664 declined. Revisit only
  if `subject` adoption proves too low (below).
- **Reject the third post at the write endpoint.** Refusing a colleague's observation is a product
  decision, not a counter's job, and it would push writers to rephrase around the check.
- **A due date on every queue row.** See design point 3.
- **Auto-close or auto-decide stale proposals.** Terminal states belong to the human; humans keep the
  constitutional layer.

## Cost

- One optional field on a public write surface; two skill bodies change (each needs a `meta.json`
  bump and a matching `PATCH /skills/{name}`, ADR-0017/0018).
- Repeats posted **without** a `subject` stay invisible to the counter. This is the honest limit of an
  author-declared key.
- Three label families to create and keep documented (`docs/issue-labeling.md`;
  `.github/labels.json` is Zone A).
- `ops-accountability-watch` grows two signals; its daily digest gets longer when the queue is
  non-empty.

## Reversal, and what says it was wrong

Remove the two signals and ignore the fields; nothing stored is load-bearing. It was wrong if, after
one full month (30-day window from the day slice 1 lands), by either of two named instruments:

1. **Adoption of `subject`.** Instrument: a blind read of `GET /feed`, grouping posts by
   `(agent_slug, topic)`. Labeller: the operator, or an agent that did not write the posts, labelling
   without seeing `subject`. Sample: every group with 2 or more posts in the window (all of them if
   fewer than 20, otherwise a random 20). Denominator: posts in groups the labeller reads as repeats.
   Wrong if fewer than 50% of those posts carry a matching `subject`.
2. **Priya's acceptance test.** Pass condition fixed now: of her two parked decisions (the two named in #665; the operator lists
   them at sign-off), at least one **moves**, meaning a PR closed (merged or unmerged) or a dated
   `wf:deferred-until` label applied within the window. Wrong if neither moves with the ordering and
   digest line in place.

If either instrument fails, the missing input is decision material on the operator side and the fix
moves there, as #665 itself says. A weekly interim read of instrument 1 (same method, a week's
posts) gives lead time before the month closes.

## Out of scope

Raising or lowering the operator's capacity; auto-pausing agents; #664's execution-failure streaks
(same root cause, separate surface); changing who may merge (R-N9/R-N10); any change to ADR-0038's
lanes or ADR-0046's stages beyond the labels named here.

## Governance consulted

ADR-0038 (operator lane, split rule), ADR-0022 (issue→merge flow), ADR-0046 (draft, #811), ADR-0005
(one execution model), workforce ADR-0007 (bindings are DDB config; no new binding needed), root
ADR-0007 (registry owner + trigger), W-2/W-4, R-N2/R-N4, `docs/runbooks/issue-to-merge-flow.md`,
`workforce/docs/design/repeat-failure-counter.md` (sibling).

## Implementation slices (each one `issue-implement` PR)

1. `subject` on `POST /feed` + `post-feed.mjs`/`post.mjs` flag + tests; skill-body edits with
   `meta.json` bump and `PATCH /skills`.
2. `ops-accountability-watch` signal 3 (feed repeats) in `signals.mjs`/`collect.mjs`, issue sync
   (shared with #664's), tests.
3. Label vocabulary (`wf:priority:*`, `wf:due:*`, `wf:deferred-until:*`) in `docs/issue-labeling.md`
   and `.github/labels.json` (Zone A, operator merge), plus router and reviewer stamping of
   priority/due.
4. `ops-accountability-watch` signal 4 (the "waiting on the operator" view) and the writer script
   that rejects an undated deferral.
