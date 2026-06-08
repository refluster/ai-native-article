# Risk Acceptance Ledger

**Layer:** L2 registry (this file is data; `scripts/check-governance-registries.mjs` keeps its table well-formed — R-12).
**Decision record:** [ADR-0001](adr/adr-0001-self-driving-governance-mechanisms.md) (the converging audit loop).
**Audience:** the operator (who signs), and any agent triaging a known-but-unfixed gap.

---

## 0. What this is

Not every known gap should be fixed now. Some are deliberately tolerated — the
fix costs more than the risk, or it depends on something not yet built, or it
only matters at a scale we have ruled out (C-3). This ledger is where those
decisions are **written down and signed**, so:

1. The same gap is not re-litigated every retrospective.
2. A reader can see *why* a known weakness is still present, and when to revisit it.
3. The memory→lint backlog has a place to send a finding that is real but **not**
   worth a machine check.

**The signature is the merge.** An entry is "accepted" when a PR adding the row is
merged by the operator (the only one with merge authority — governance §8.1 B).
An agent may *draft* a ledger row; it may not self-accept one.

## 1. Operating rules

- **One root cause per entry.** Don't bundle unrelated gaps under one ID.
- **A signed entry suppresses re-filing.** A governance retrospective (§6) that
  rediscovers an accepted gap does not open a new finding — it checks the
  `Re-eval` date instead.
- **`Re-eval` in the past triggers a re-review, not auto-expiry.** A stale date
  means "look at this again", not "this is now unaccepted".
- **C-3 is a valid acceptance reason.** "Only matters at multi-operator / paid /
  user-data scale" is sufficient grounds, per the constitution.

## 2. Ledger

<!-- registry:risk-acceptance columns: ID | Finding | Category | Why accepted | Re-eval | Signed -->

| ID | Finding | Category | Why accepted | Re-eval | Signed |
|---|---|---|---|---|---|
| RAL-001 | Prompts remain inline in `Code.gs` rather than extracted to versioned files. | software-2.0 | Extraction touches `Code.gs` substantively and needs a `gas-deploy-verify` cycle; the diff-visibility cost is real but low while prompt churn is slow. Tracked as ML-003. | when prompt churn picks up, or the next `Code.gs` content-generation refactor | unsigned (draft) |
| RAL-002 | The weekly content-insights loop has no GA4 service-account credential, so it reports "credentials not configured" and creates no issues. | analytics | Wiring the GA4 Data API service account is an operator B action (a secret + a GCP service account). The loop is built and inert until then — fail-soft, not fail-loud, because it is advisory. | when the operator provisions `GA4_PROPERTY_ID` + `GA4_SA_KEY` | unsigned (draft) |
| RAL-003 | No staged/canary environment: a promoted prompt hits 100% of the next batch. Canary discipline is documented (design-policy §4) but not wired into `Code.gs`. | rollout | The `L2_BACKFILL` small-slug-list convention covers the common case; a first-class canary mode is a `Code.gs` change deferred until a prompt change actually burns a batch. | first incident where a prompt change degrades a full batch | unsigned (draft) |
