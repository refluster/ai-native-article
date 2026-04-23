<!--
PR title prefix:
  growth:     — change aimed at a KPI in GROWTH.md (must name the metric below)
  fix:        — bug fix or regression
  content:    — L1–L4 content-only (Zone C in AGENTS.md)
  chore:      — deps, tooling, non-behavioral
  governance: — AGENTS.md, CODEOWNERS, workflows

See AGENTS.md for zones and approval rules.
-->

## Summary

<!-- 1–3 bullets. What changes, in the smallest words that fit. -->

## Zone touched

<!-- Zone A / B / C / D. If multiple, split the PR. -->

## Metric (growth: PRs only)

<!-- Which GROWTH.md KPI does this move, and in which direction?
     Example: "read_complete rate on /article/:slug, expected +5% by shortening
     intro paragraph." If you cannot name a metric, relabel this as chore:. -->

## Test plan

- [ ] `npm run build` passes locally
- [ ] `npm run lint:tokens` passes
- [ ] Verified live on preview (if UI)

## Agent attribution

<!-- If this PR was opened by a skill or scheduled agent, paste the
     originSessionId / run id here. Humans: leave blank. -->
