# Finance & Capital group — one-shot registration inputs

Three-agent group (2026-06 hire round) that owns the workforce's finance,
fundraising, and investor-relations craft — framing money decisions, building
the round on paper, and drafting investor communications — all as drafts the
**operator alone** acts on:

| Slug | Role | Reports to | Residence | Model | USD/mo |
|---|---|---|---|---|---|
| `silas` | VP, Finance & Capital Strategy (lead) | `maya` | New York, NY, US | Sonnet 4.6 | 7 |
| `delphine` | Head of Fundraising & Capital Formation | `silas` | London, UK | Sonnet 4.6 | 6 |
| `corinne` | Investor Relations Manager | `silas` | Boston, MA, US | Sonnet 4.6 | 5 |

Design: **one lead who sets the financial model × one fundraising strategist who
turns it into investor-ready narrative × one IR steward who turns it into the
recurring update.** Silas owns the single model; Delphine inherits it for the
pitch; Corinne inherits both for the update — so the three lanes never cite
divergent figures. The lead reports to Maya (`tier: lead`), mirroring `tessa`'s
policy-group shape.

### The load-bearing guardrail: draft, never act

These are the three roles in the org most tempted to act externally — to send
the term sheet, make the warm intro, ship the monthly update. **All three
hard-refuse outreach.** This is the only form fundraising/IR can take at **C-3
single-operator scale**, and it is the direct analogue of how `vikram` is a
liaison-not-sales and `noor` drafts the framing-not-the-opinion:

- No persona contacts any investor, fund, angel, lender, or bank.
- No persona claims the platform has investors, revenue, a cap table, or a raise
  in progress — **it has none**. Public output is *craft thought-leadership*
  ("how to write an investor update"), never a report on this platform's
  (non-existent) investor relations.
- No persona fabricates financials. Every figure is the operator's real cost
  data or **explicitly labelled illustrative**. (W-1 / C-1 editorial integrity.)
- Structuring/term/disclosure questions route to `levi` (product counsel) and
  the operator's outside advisors — never adjudicated in-lane.

The bias-disclosure blocks in all three `*-system.md` files are unusually
load-bearing for exactly this reason and are parallel-structured so the lane
boundaries read at a glance.

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
node workforce/seed/finance-group/register.mjs --dry-run        # inspect, no creds
aws-vault exec <profile> -- node workforce/seed/finance-group/register.mjs
```

Prereq: the `POST /agents` route deployed, **and** the Zone A W-3 raise to
`USD 190/mo` merged. The API re-checks the roster aggregate at write time, so if
the cap edit hasn't landed the registration fails loudly at `156 → 174` against
the old `160` ceiling instead of silently breaching it. Full procedure +
after-registration steps:
[workforce/docs/runbooks/agent-registration.md](../../docs/runbooks/agent-registration.md).

Budget context at authoring time: roster total was USD 156/mo effective (after
the policy-group); this group adds 18 → 174, inside the **raised** W-3 cap (190).
The cap raise from 160 → 190 is the Zone A change flagged for operator sign-off
in this PR and in the hiring memo
([docs/hires/finance-capital-hire-round.md](../../docs/hires/finance-capital-hire-round.md)).

`bindings` are intentionally `[]` at registration: cadences (the running finance
frame, fundraising-narrative refresh, the recurring IR update draft) are wired
afterwards via `cadence-forge` + PATCH, which first requires adding the new slugs
to the relevant skills' `owners[]` (R8 cross-check). The personas register,
render on the directory, and sit idle until those follow-ups land — same posture
as the policy-group at registration.
