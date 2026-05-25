---
name: pdm-charter
description: |
  Stub for the future RFC → epic-tracker charter step. Reads a freshly
  committed RFC under workforce/docs/rfcs/ and drafts a proposal for the
  parent Epic tracker issue (the operator-approved breakdown that pdm-decompose
  then drives). Not implemented in v1 — declared so the binding shape +
  routine wiring is in place when the next RFC arrives.
---

# pdm-charter — RFC → Epic tracker (stub for v2)

**Owner**: maya (PM / Founder)
**Executor**: deterministic (handler currently throws — placeholder)
**Cadence**: manual (operator triggers when a new RFC lands)

## Why this skill exists today as a stub

The RFC-010 thread that built `pdm-decompose` did the **RFC → Epic tracker**
step manually (operator + assistant). To make the next RFC reproducible,
that step needs its own skill. `pdm-charter` is the placeholder.

Declaring it now (with a stub handler + a `executor: cli` binding on
Maya) means:

- The binding entry documents the intended workflow surface
- `validate-agent-json.mjs` does NOT fire orchestrator dispatch for
  `executor: cli` bindings, so the stub never auto-runs
- The next PR that implements the real handler swaps the binding to
  `executor: lambda, trigger.scheduler: external, invoked_by: api`
  (operator POSTs to the runner via API trigger when an RFC lands)

## v2 contract (sketch — not implemented)

**Inputs**: a path to an RFC file (e.g. `workforce/docs/rfcs/rfc-011-foo.md`).

**Outputs / side effects**:
1. Create a new GitHub issue with title `RFC-N — <title> (Epic tracker)`
2. Post a `<!-- pdm-charter:proposal -->` comment that drafts:
   - The Epic decomposition (3–6 epics with `## Workstreams` sections,
     in the shape `pdm-decompose` expects)
   - A scenario walkthrough (the missing-Epic-6 case from RFC-010 must
     be reproducible — the routine must actively probe for gaps)
   - Cost / architecture deltas with alternatives (the OpenSearch case
     from RFC-010 — every cost line item > USD 10/mo must surface
     alternatives in the proposal)
3. Wait for operator 👍 on the comment → on next run, materialise the
   epics as `[RFC-N Epic M] ...` issues (each with `## Workstreams`)
   and link them as sub-issues of the tracker

The state machine mirrors `pdm-decompose`'s — same proposal-comment-wait-approve
pattern. The difference is the input shape (RFC path) and the output
shape (parent epic tracker + sub-epics rather than child issues for one epic).

## Until implemented

Operator continues to author Epic trackers manually (as in the RFC-010
thread). When the next RFC is ready, this skill gets a real handler in
its own PR.
