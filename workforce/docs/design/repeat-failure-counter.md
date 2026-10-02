# Repeat-failure counter — design note

- **Status**: Proposed (draft PR for #664; `wf:lane:design`). A design note, not an ADR: it
  settles *how* to build something the statute already permits (W-4 fail loud, W-2 one state
  store) and binds no later decision except the threshold N, which the operator signs.
- **Implements nothing.** The implementation is the slice list at the end.

## Decision

Count repeats **at the one write seam** (`POST /agents/{slug}/engagements` → `appendExecution`),
as a derived `STREAK#` item keyed on `(agent_slug, skill_name, reason_code)` in the existing DDB
table. Stamp the resulting count on the EXEC row itself, and let `ops-accountability-watch` read
open streaks as its third signal. Failure reasons are classified by a small closed
`reason_code` enum the runner supplies, never by string-normalising free text.

## What forced it

- #664's evidence: the same refusal recorded correctly and identically many times (Hana, three
  misdiagnoses in a row); `weekly-project-report` failing five consecutive weeks on one unchanged
  cause; a memory-curation pass deleting the only occurrence counter.
- **The data we would normalise does not exist.** A live read of 600 recent EXEC rows across six
  agents (2026-10-02) shows `status:"throw"` rows carry **no `error` attribute**; the reason is
  only free text in `summary`. A "normalised failure reason" computed from prose would be a
  regex over LLM-written sentences, the same fragility the 2026-09-30 audit of #785 flagged in
  its error-text regex.
- **`skipped` already hides failures.** Of the same 600 rows, 23 `skipped` rows mention
  failure words (identity pre-flight failed, 401, rejected). Ren's `issue-implement` and
  `pr-remediate` skips for the ML-040 identity collapse are recorded as `skipped`, the same word
  as a disciplined quiet day. That is the lost-888-character-draft case in #664 item 4, still
  happening.
- `ExecutionRow` has no `binding_idx`, so "binding" can only mean `(agent_slug, skill_name)`
  today. Two bindings of one skill on one agent (#687, `grace`'s duplicate `daily-research`)
  share a streak, which is acceptable for escalation and wrong for diagnosis; see slice 1.

## Design

1. **Reason codes, supplied at the source.** Add optional `reason_code` to the engagement POST,
   closed enum: `auth`, `permission`, `egress`, `identity`, `validation`, `source_unreachable`,
   `write_failed`, `other`. The runner picks it from the script exit code and the HTTP status it
   already has (401 → `auth`, 403 on a repo → `permission`, 422 → `validation`, exit 2 on
   read-back mismatch → `write_failed`). `other` is allowed but is *counted separately per
   agent*, so it cannot silently become the catch-all.
2. **Skip vs. failure becomes structural.** `skipped` stays for "nothing to say / sibling
   covered it / no eligible work". A run that attempted a write or a pre-flight and was refused
   is `throw` with a `reason_code`, never `skipped`. The endpoint rejects `status:"skipped"` with a
   non-null `reason_code` other than `source_unreachable` (a 422, per W-4), so the collapse
   cannot recur by drift.
3. **The counter.** On each engagement write, one atomic `UpdateItem` on
   `pk=STREAK#{agent}#{skill}`, `sk=REASON#{reason_code}`: `ADD count 1`, set `last_exec_ulid`,
   `last_at`, and `first_at` if absent. An `ok` engagement deletes every `STREAK#{agent}#{skill}`
   item; `skipped` neither increments nor resets (a quiet day is not a repair).
   A different `reason_code` starts its own streak and does not clear the old one, so a
   permission failure masked by an intermittent egress failure still counts.
4. **Surface at diagnosis.** The EXEC row gets `repeat_count` (1 on first occurrence). The
   console and `GET /agents/{slug}/executions` show "3rd consecutive `permission`" on the row the
   second responder reads first. This is the acceptance signal from #664 (Mateo's hypothesis 2):
   track whether the misdiagnosis rate falls once counts are visible.
5. **Escalation.** New signal in `ops-accountability-watch`: `GET /streaks?min_count=N` lists
   open streaks; `sync-issues.mjs` opens one idempotent, title-matched issue per
   `(agent, skill, reason_code)`, routed by `owner-routing.mjs`. A second input to the existing
   Cadence, not a new one. The route ships with its `HttpApi` event in the same PR (ML-004).
6. **Threshold N.** Proposed **N = 3 consecutive** for any cadence, one issue per streak,
   reopened if the streak resets and rebuilds. On the #664 cases that fires on the third failure:
   week 3 (08-16) rather than the fifth (08-30) for `weekly-project-report`. The operator signs N;
   it lives in one constant so a change is a one-line PR.
7. **W-2 position.** The EXEC rows stay the single source of truth. `STREAK#` is a derived
   projection, rebuildable by replaying the ledger through GSI2 (`SKILL#`), the same
   shape as the `TRUST#` tier cache planned in #462. It is deliberately outside `memory.body`
   because a curation pass can delete memory but not a DDB item.

## Alternatives rejected

- **Derive on read from the ledger (no new item).** No write-path change, but GSI1 is
  per-agent and GSI2 per-skill, so an agent's weekly cadence is buried under that agent's other
  fires (the 2026-09-30 org-metrics pulse found two agents already hitting the 100-row read cap); a filter over a paged query
  is exactly the Limit-vs-Filter bug class `check-scan-drain` guards. Cheap to build, wrong at
  the cases that motivated the issue.
- **String-normalise `summary`.** Rejected above: no `error` field, and prose drifts.
- **A counter in `memory.body`.** Rejected: it is what failed (Freya's deleted line).
- **A new Cadence for repeats.** Rejected by #664 itself; `ops-accountability-watch` already owns
  owner-routed, idempotent issue creation.
- **Block the write at N.** Rejected: turning a failing routine off is a product decision, not a
  counter's job. This design only makes the count unmissable.

## Cost

- One extra `UpdateItem` (and on `ok`, one small `Query` + delete) per engagement. At ~1,300
  fires/week that is noise against the W-3 envelope.
- `reason_code` is a new field on a public write surface; old clients keep working (absent →
  `other`, counted but never escalated alone below N).
- Rule 2 changes what the runner may call `skipped`, which touches `agent-runner.md` and several
  `SKILL.md` bodies (each needs a `meta.json` bump and a matching `PATCH /skills/{name}`).
- Streaks keyed without `binding_idx` over-merge duplicate bindings until slice 1 lands.

## Reversal, and what says it was wrong

Drop the endpoint 422 and ignore `STREAK#`; the EXEC rows are untouched. It was wrong if, with
counts on screen, the same wrong cause is still diagnosed repeatedly (the counter is decoration),
or if more than ~30% of streaks escalate as `other` (the enum does not fit reality).

## Out of scope

Auto-pausing bindings; retiring failing cadences (#768/#769); repairing the ML-040 identity
collapse (#777); the daily-research × feed-post collision (#660/#755); a numeric `binding_idx`
backfill of old rows.

## Implementation slices (each one `issue-implement` PR)

1. `binding_idx` + `reason_code` on engagement POST and `ExecutionRow`; runner doc update; endpoint
   rule for `skipped`. Tests in `agents-api/handler-tests.ts`.
2. `STREAK#` update in `appendExecution`, `repeat_count` on the row, replay/backfill script.
3. `GET /streaks` + `HttpApi` event + `swagger`/route-check entry.
4. `ops-accountability-watch` signal 3 in `signals.mjs`/`collect.mjs` (+ `meta.json` bump, `PATCH /skills`).
5. Console: show `repeat_count` on the activity row.
