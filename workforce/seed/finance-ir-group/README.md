# Finance & Investor Relations group — one-shot registration inputs

Three-agent group (2026-06 hire round) that owns the workforce's read on its
own money and the discipline of every financial message that reaches an
investor, bank, or angel. The mandate is **investor/lender communication
strengthened at single-operator scale**: the personas model, draft, reconcile,
and track — the operator alone pitches, sends, signs, and moves money.

| Slug | Role | Reports to | Residence | USD/mo |
|---|---|---|---|---|
| `rafael` | VP, Finance (lead) | `maya` | London, UK | 7 |
| `dana` | Head of Fundraising | `rafael` | San Francisco, US | 6 |
| `yara` | Investor Relations Manager | `rafael` | New York, US | 5 |

Design: **one synthesizing VP × two function leads (raise-side / steady-state),
geographically placed on the three investor surfaces — London (banks /
cross-Atlantic), San Francisco (VC density), New York (institutional / lenders).**
Rafael owns the single canonical financial model; Dana owns the episodic
raise (narrative + target pipeline + round mechanics); Yara owns the steady
state between rounds (recurring update + data-room hygiene + cross-update
consistency). Every external figure reconciles to Rafael's model before it
leaves. "Fundraising" and "IR" are implemented as the only form available at
C-3 single-operator scale: **draft + reconcile + track, routed to the
operator, who alone reaches out** (the personas hard-refuse outreach — Dana
never pitches an investor, Yara never responds to one).

## What these files are (and are not)

Per [ADR-0007](../../docs/adr/adr-0007-agent-config-single-source.md) the
`AGENT#{slug}` DDB row family is the **single authoritative store** and
agents-api the single writer. These JSON/markdown files are **one-shot
registration inputs** consumed by `register.mjs`, which POSTs them through
`POST /agents` (validated + audited). After a successful run the DDB rows are
authoritative and these files are historical: config edits go through
`PATCH /agents/{slug}`, never by editing here and re-running (the script
409-skips existing slugs by design).

## Run it

```bash
node workforce/seed/finance-ir-group/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/finance-ir-group/register.mjs
```

Prereq: the `POST /agents` route deployed (data-plane already live since the
policy-group round). Full procedure + after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).
Register parents before reports — `rafael` first (both ICs report to it).

## W-3 budget context (operator decision)

This group adds **USD 18/mo** (7 + 6 + 5). The landing total depends on whether
the policy group is already registered:

- Policy group **not yet** registered (roster ≈ 129/mo): lands at **147/160** —
  fits, no cap raise needed.
- Policy group **registered** (roster ≈ 156/mo): lands at **174/160** —
  **requires raising W-3 to 180 first** (Zone A: `governance.md` W-3 +
  `shared/agent-config.ts:W3_BUDGET_CAP_USD`), the operator's call before
  registration, not after.

The agents-api re-checks the aggregate at write time, so the round **fails loud
(422 W3-cap)** instead of silently breaching the ceiling. `register.mjs` does
not raise the cap. See the hire memo
[workforce/docs/hires/q3-finance-ir-round.md](../../docs/hires/q3-finance-ir-round.md) §6.

## Cadences (wired afterwards)

`bindings` are intentionally `[]` at registration. The recurring cadences — the
monthly finance brief (Rafael), the fundraising-readiness sweep (Dana), the
monthly/quarterly investor update (Yara) — are wired afterwards via
`cadence-forge` + PATCH, which first requires adding the new slugs to the
relevant skills' `owners[]` (R8 cross-check).
