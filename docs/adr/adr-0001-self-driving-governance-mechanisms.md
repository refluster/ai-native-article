# ADR-0001 — Self-driving governance mechanisms (R-10…R-12 gates, the two engines, the registries)

- **Status**: Accepted
- **Date**: 2026-06-07
- **Deciders**: operator

## Context

The governance layer ([governance.md](../governance.md)) pinned the invariants
(C-1…C-4) and a regulation table (R-1…R-9), but most of it was enforced by
*memory and discipline* rather than by *machinery*. Two gaps were felt
concretely:

1. **Errors did not get harder to make over time.** The truncated-article
   incident `d17e1d58ec42` (2026-05-03) was fixed by adding runtime throws
   (R-3/R-4/R-5) and editing docs — but nothing recorded the *class* of failure
   so that a second occurrence would be recognised and mechanised. Each
   incident was re-discovered from scratch.
2. **Improvement work was remembered, not generated.** GA4 was wired on the
   client, but reader-engagement data never came back to drive the editorial
   roadmap. "Which articles underperform?" was answerable only if the operator
   remembered to look.

The repository also lacked a *deploy-time* guard for editorial integrity (the
finish_reason throw guards *generation*, not *publication*), and any edit to a
framework law could ship without announcing which law it touched.

## Decision

Adopt a small set of **self-driving mechanisms**, scaled to single-operator
(C-3) — import the *mechanism*, not the *ceremony*. Record them here so the
rationale lives in-repo rather than as folklore or cross-repo references.

**Three new mechanical regulations** (governance.md §4):

- **R-10 — pre-deploy corpus truncation gate.** `check-corpus-truncation.mjs`
  runs in `deploy-article-site.yml` after `fetch-notion`, before build. The
  deploy-time twin of the generation-time finish_reason throw (R-3): R-3 stops
  bad content being *written*; R-10 stops it being *published* (C-1/C-4).
- **R-11 — L1 citation gate.** `check-l1-citation.mjs` runs on PRs: a diff that
  touches an L1 document (the framework laws in governance.md §3.1, the two
  governance-axis docs, or any ADR under `docs/adr/`) must carry a citation of
  that doc in the PR body, or an explicit `RULE-N/A: <reason>` opt-out. This is
  how we "follow the ADR when implementing" — touching a law announces itself.
- **R-12 — governance registry integrity.** `check-governance-registries.mjs`
  runs in CI and keeps the two registries (below) machine-parseable; a
  malformed row silently drops a finding from the audit trail.

**Two engines:**

- **The ratchet (Engine A).** A recurring failure mode is logged in
  [memory-lint-backlog.md](../memory-lint-backlog.md); on its second occurrence
  within 90 days it is promoted to an `R-NN` regulation. The backlog is the
  durable provenance for "why does this gate exist?".
- **The loop (Engine B).** `weekly-content-insights.yml` → `content-insights.mjs`
  joins GA4 engagement to the published manifest weekly and upserts one
  `insights`-labelled issue, so reader behaviour drives the roadmap. Inert
  until the operator provisions the GA4 credential.

**Two registries** keep the audit loop *converging* (every finding ends as
promoted, accepted, or declined — never re-discovered):

- [memory-lint-backlog.md](../memory-lint-backlog.md) — failure modes awaiting
  or having reached promotion.
- [risk-acceptance-ledger.md](../risk-acceptance-ledger.md) — real gaps
  deliberately tolerated, "signed" by the operator merging the row.

**ADRs become the decision-record vehicle.** Framework decisions are recorded
as ADRs under `docs/adr/` (this file is the first). ADRs are L1; the R-11 gate
treats them as citable framework laws.

## Alternatives considered

- **Keep enforcing by discipline / docs only.** Rejected — that is exactly what
  let `d17e1d58ec42` recur-able. A rule in prose decays; a rule in a gate fails
  loud.
- **A local `git push` hook mirror of the gates.** Considered and **rejected by
  the operator** — the extra moving part is not worth it at this scale; CI is
  the single enforcement point. (The cheap gates run in `ci.yml` only.)
- **A heavier control plane** (SLO/error-budget throttle, a single required-gate
  router, reviewer-disposition gate, a three-registry boundary, a formal
  quarterly retro). Rejected as ceremony at single-operator scale — see
  Consequences for the explicit "revisit when…" triggers.

## Consequences

- **Positive.** Editorial integrity is now guarded at deploy time, not just
  generation time. Recurring failures get mechanised automatically. Reader data
  drives the roadmap without the operator remembering to look. Every framework
  edit announces itself. The rationale is in-repo (this ADR + the registries),
  not folklore.
- **Operational.** R-10 can halt a deploy if a truncated article survives a
  fresh Notion fetch — intended (C-1/C-4); escape hatch `ALLOW_TRUNCATED=1`
  (operator-only, record in the ledger). The content-insights loop stays inert
  until `GA4_PROPERTY_ID` + `GA4_SA_KEY` exist (tracked as RAL-002).
- **Scope boundary (C-3) — what this ADR deliberately does *not* adopt, with the
  trigger to revisit:**

  | Not adopted | Why not / revisit when |
  |---|---|
  | SLO + error-budget throttle | No SLA, no users to budget against. Revisit if the site takes payments or hosts user data. |
  | Reviewer-disposition gate | Single operator merges. Revisit at multi-author. |
  | A single required-gate router over many gates | Overkill for ~3 gates; a flat list in `ci.yml` is clearer. Revisit past ~10 gates. |
  | A separate Agent/Accountability/Skill registry boundary | One operator on the article side; the workforce side already separates concerns. |
  | Formal quarterly retro with output doc | Replaced by the incident-driven §6 loop + the memory-lint backlog. |
  | A local `git push` hook mirror | Removed at review; CI is the single enforcement point. |

## Related

- [governance.md §4](../governance.md#4-l2--regulations-mechanical-enforcement) — R-10…R-12 in the regulation table.
- [governance.md §6](../governance.md#6-audit-cadence) — the ratchet (§6.1) and the ledger (§6.2).
- [governance-mechanisms.md](../governance-mechanisms.md) — the operating map for all of the above.
- [memory-lint-backlog.md](../memory-lint-backlog.md), [risk-acceptance-ledger.md](../risk-acceptance-ledger.md) — the two registries.
