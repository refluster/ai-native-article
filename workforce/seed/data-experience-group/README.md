# Data & Experience three-hire round — one-shot registration input

Three ICs (2026-08) serving the external projects `asp-cloud`,
`smartmeter-data-analysis` and `project-ind`. The round's JD brief —
market research, lane boundaries, the decisions behind each choice — is
[`docs/hires/data-and-experience-three-hire-jd-brainstorm.md`](../../docs/hires/data-and-experience-three-hire-jd-brainstorm.md);
the round memo is [`docs/hires/data-and-experience-three-hire-round.md`](../../docs/hires/data-and-experience-three-hire-round.md).

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `linnea` | Product Data Scientist, Experimentation & Field Inference | `nadia` | Boulder, CO, US | Sonnet 4.6 | 7 |
| `tobias` | Analytics Platform Engineer | `dario` | Amsterdam, NL | Sonnet 4.6 | 6 |
| `clara` | Behavioral Design & Trust Researcher | `nadia` | Chicago, IL, US | Sonnet 4.6 | 6 |

Design: **cross-project functional seats** (operator decision, 2026-08-06), not
per-project ones. Each is hired on a common core that holds across all three
projects — Linnea on experiment design, Tobias on decision latency, Clara on
making trust measurable — with the per-project specifics as context rather than
as hiring bars. That is why NILM / load disaggregation is a strong-plus in
Linnea's JD rather than a requirement, and why Tobias is one seat spanning what
the market splits into data engineering and analytics engineering.

Placement follows the standard market split and the existing org shape: the two
product-side seats report to `nadia` (who owns all three projects via
`workforce/projects/*/project.json`), the platform seat to `dario`. No new VP,
no new management layer — three ICs under two existing VPs, following the
`bruno` precedent.

### The load-bearing guardrails

Each seat has one failure mode that matters more than the rest, hard-wired in
both `system.md` and the `identity.guardrails` of its `*.json`:

- **`linnea` — the unqualified number.** No proportion without its denominator,
  no point estimate without an interval, no social-media claim without its
  sampling caveat, and no observational difference presented as a causal effect.
  Plus a physical screen ahead of the statistical one: a significant result that
  is physically implausible for the household or the device is a finding about
  the instrumentation, not about the household.
- **`tobias` — silent staleness (W-4 / C-4).** A broken pipeline must fail, not
  serve yesterday's number into a decision. Paired with the single-definition
  rule: the moment a metric is computed in two places, both numbers are
  untrustworthy.
- **`clara` — the nudge that bypasses understanding.** Behavioural science can
  help someone understand or move them without understanding; the second works
  in the short run and costs the relationship. She does not propose it, and she
  names it when it appears in someone else's proposal. Paired with: no trust
  claim without the behavioural indicator it is made of.

All three hold **C-3** explicitly (no experimentation platform, no multi-tenant
primitives, no research-ops apparatus) and carry the standard LLM-persona bias
disclosure.

### Lane boundaries checked before this bundle

`dmitri` (kohuehara.xyz reader analytics — different corpus), `tomas`
(organisational performance — inward vs outward), `owen` (code verification vs
Tobias's data verification — co-flag seam), `sneha` (Indian households *as a
market* vs Clara's *project-ind users' experience* — co-flag seam), `rohan`
(government-side program economics vs Linnea's product-intervention causality),
`celeste` (Clara's co-recipient on everything pre-onboarding, not a competing
lane).

### Registration

```
# no credentials needed — validates the bundle and prints what would be sent
node workforce/seed/data-experience-group/register.mjs --dry-run

# operator credentials required (route is AWS_IAM / SigV4)
aws-vault exec <profile> -- node workforce/seed/data-experience-group/register.mjs
```

Registers with `bindings: []` — **idle by design**. Cadence wiring is a separate
follow-up (`cadence-forge` + `PATCH /agents/{slug}`); since
[adr-0012](../../docs/adr/adr-0012-decouple-binding-from-ownership.md) binding is
no longer gated on skill ownership, so no `owners[]` amendment is needed first.
The three render on `/workforce/agents` and `/workforce/org` and sit idle until
that follow-up lands. The Cadence design questions are carried in §8 of the JD
brief.

After a successful run the DDB row is authoritative: **this script is not a
mirror**, and re-running it 409s by design. Subsequent edits go through
`PATCH /agents/{slug}`, one persona per write (W-5).
