# 2026-06 — IR Reporting & Visit-Coordination Hire Round (Maya's hiring memo)

- **Operator request**: 2026-06-21 — *"Reporting to sponsors and investors, and visit/inspection coordination (視察コーディネーション), will increase going forward. I want to hire IR people. First gather a few members who should be in this discussion; then, working through it with them, decide how many to recruit, and the positions / titles / responsibilities / JDs, and propose."*
- **Lead**: Maya (Founder, San Francisco) — the operator addressed me directly, and this round *expands a function I chartered* six days ago, so I led it rather than hand it to Priya.
- **People-ops / JD discipline**: Priya Halvorsen (VP People & Legal) + Theo Castellanos (People Ops + Recruiting).
- **Panel convened**: Silas (VP Finance & Capital Strategy — the pod rolls up to him), Corinne (IR Manager — the incumbent whose lane this expands), Kai (Brand/Content — messaging consistency), with Delphine (Fundraising) and Levi (Product Counsel) pulled in for the two lane boundaries this round turns on.
- **Status**: Proposal. Registration bundle staged (`workforce/seed/ir-group/`), draft PR. **No W-3 cap raise required** — see §6. Two open questions for the operator in §11.

This is the **first expansion of an existing function** the org has done — every prior round stood up a *new* group (the VP layer, the Q2 five, the policy group, the Finance & Capital group). The Finance & Capital round (2026-06-14) explicitly deferred "a finance IC below Corinne… until cadence volume justifies it" (that round's §8). The operator's "今後増える" — reporting and visit-coordination volume is about to climb — is exactly that justification arriving. So this round closes a bench-gap the org already named, rather than opening a new lane. That makes the **C-3 boundary on 視察コーディネーション** (§2) the load-bearing decision, the same way the draft/never-act boundary was for the finance round.

---

## §1. Policy I applied

Three policies framed every call:

1. **C-3 single-operator scale.** One operator, hobby scale. There are **no real sponsors, no investors, no one receiving a report, no one to host on a visit.** A reporting-and-visits function at this scale cannot be an IR department with a distribution list and a calendar of confirmed roadshows; it can only be a **drafting-and-staging** function whose output the operator alone acts on. This is the same shape Silas/Delphine/Corinne already hold, applied to two new verbs: *report to a sponsor* and *coordinate a visit*.
2. **W-1 / C-1 editorial integrity.** Reporting and visit-coordination personas can manufacture false credibility faster than almost any other seat — a stewardship report implies a sponsor exists; a site-visit itinerary implies a visitor is coming. Every figure is the operator's real cost data or explicitly labelled illustrative; every sponsor/investor/visit is a *template* unless the operator names a real one. Hard-wired into both `system.md` files, not left to runtime judgement.
3. **W-2 no double source-of-truth + W-5 persona stability.** The two personas register as DDB rows via `POST /agents` (ADR-0007); the git bundle is one-shot input, not a mirror. No parallel Notion page until a first published deliverable lands. And the round adds **no persona-config mutation to an existing agent** (see §3 on why I kept Corinne's title) — so it requires no PATCH and no Zone B identity change.

## §2. The C-3 boundary — what "視察コーディネーション" can mean at one-operator scale (this round's central decision)

The operator asked for help with **reporting to sponsors/investors** and **visit/inspection coordination**. The literal reading of "coordinate a visit" is **outbound, real-time, external action**: confirming a date with an investor, booking the venue, hosting the day. At C-3 the workforce **cannot do that** — there is no investor to host and no one authorised to confirm a date on the operator's behalf — and it shouldn't pretend to.

So this round applies the precedent the org has now set four times:

- `vikram` is a **liaison, not sales** — a read-window, never a commercial actor (Q2 round §5).
- `noor` drafts the **framing memo and the question, never the opinion** (Epic-009).
- `delphine` **maps the warm-intro path and stages the materials — she never makes contact**; the operator runs the meeting (Finance round §5).
- `corinne` **drafts the update; the operator alone sends it** (Finance round §4).

Visit-coordination is the same shape, applied to a calendar and a building:

- **The Reporting Associate drafts the sponsor/investor report; the operator alone sends it** — identical to Corinne's boundary, extended from "investor update" to "sponsor stewardship report."
- **The Visit Coordinator builds the visit on paper and hands the operator the keys — she never contacts a visitor, never confirms a date externally, never hosts.** The live IR-coordinator JD's "manage on-the-day logistics for investor site visits and capital-markets days" (Selby Jennings / Prologis / Harrow listings) becomes **"stage the itinerary, the run-of-show, the briefing pack, and the materials; the operator extends every invitation, confirms every date, and hosts the day."**

This is not a hedge — it is the only honest form these two roles can take, and it is precisely the boundary these two titles are most tempted to cross: the associate who "just sends the monthly to the sponsor," the coordinator who "just emails the investor to lock the date." Both `system.md` files name the hard-refuse explicitly, parallel-structured to Corinne's and Delphine's. **Panel verdict: unanimous.** I held the line in the same register I used on Vikram and on the finance trio — we have no relationship with any sponsor or investor and we don't imply one.

## §3. The management-layer review (the org-shape question)

The operator asked the panel to **decide the shape**, including how many to hire. Two structural questions:

**Q1: How many — 1, 2, or 3?** → **2.** The two pressures the operator named are genuinely two different jobs, confirmed by the live JD market splitting them into two distinct titles:

- **Reporting** (sponsor stewardship reports + investor updates, rising in *volume and cadence*) is the **IR Associate** archetype — "responsible for the quality and timely delivery of weekly, monthly and quarterly investor reporting… drafting press releases, presentations, factsheets" (Spotterful / Velvet Jobs / ADDO).
- **Visit/inspection coordination** is the **IR Coordinator / Events** archetype — "coordinate logistics for investor days, roadshows, site visits and capital-markets days; itineraries, run-of-show, materials" (Selby Jennings / Prologis / Harrow).

A single hire spanning both would be the false economy: the reporting cadence is a *desk* job (reconcile to Silas's model, ship on the calendar) and the visit job is a *logistics* job (sequence a day, brief a host). Collapsing them produces a generalist who is mediocre at both and a single point of failure when a reporting deadline and a visit window collide. **Three** would mean a dedicated sponsor-reporting IC split from investor-reporting — real scale-creep at C-3, where there are no sponsors to split by. Two is the disciplined number: one report-craft IC, one visit-craft IC.

**Q2: Flat under Silas, or a pod under Corinne?** → **A pod under Corinne.** The two new ICs report to **Corinne**, not to Silas. Reasoning:

- Silas's span stays 2 (Delphine + Corinne) — the narrowest on the org, deliberately. Hanging two more ICs off him directly would make him an IC-manager, which is not his seat.
- More importantly, the **one-voice property** the finance round was built around — "Silas owns the model; Delphine and Corinne inherit it, so the org never speaks with two sets of numbers" — extends one level down. If the associate and coordinator were *peers* to Corinne under Silas, we'd re-create the exact divergent-voice risk one layer lower: three IR-ish voices citing three versions of the same update. Putting them **under** Corinne makes her the synthesising lead whose cadence and message they inherit. This mirrors `tessa`'s policy-group (one synthesising lead over function analysts) and `silas`'s own group, applied recursively.
- **No second management layer, and — deliberately — no persona-config change to Corinne.** A manager with two reports is coherent under her existing **"Investor Relations Manager"** title; gaining reports is an org-graph edge (the new agents' `reports_to`), not a mutation of *her* `META` row. So this round needs **zero PATCH** and **zero Zone B identity change**. (Whether to *retitle* Corinne "Head of Investor & Sponsor Relations" to signal the lead tier is a genuine question, but it is **optional** and I deliberately left it out of the round — see §11 Q2.)

**Conclusion: 2 new ICs, both reporting to Corinne, who leads the IR pod under Silas. No new VP, no new cap raise, no persona mutation.**

## §4. The two hires (what each is, in one paragraph)

| Slug | Role | Reports to | Residence | Model | Budget |
|---|---|---|---|---|---|
| `marisol` | Investor & Sponsor Reporting Associate | `corinne` | Mexico City, MX | Sonnet 4.6 | USD 5/mo |
| `yara` | Investor Relations Visit & Events Coordinator | `corinne` | Dubai, AE | Sonnet 4.6 | USD 5/mo |

Total added: **USD 10/mo**. Existing roster: USD 174/mo. **New total: USD 184/mo**, **inside the standing W-3 cap (USD 190/mo)** — the first hire round in the org's history that fits without a cap raise (every prior round raised it: Epic-009 50→100, Q2 100→130, platform-group 130→160, finance-group 160→190). Headroom drops to USD 6/mo, which is itself a useful signal: the *next* hire round will need a cap conversation, and that belongs to the operator, not to me.

Both are **Sonnet**, not Haiku. The reporting role looks like consistency-and-cheapness reference work on paper (reconcile, format, ship on cadence) and is the one place a Haiku argument could be made — but the finance round set the "IR craft is judgement-heavy → Sonnet" precedent for exactly this seat (investor-comms *tone* is the load-bearing skill, and a misjudged tone on a sponsor report is the failure that erodes credibility). I default both to Sonnet and flag the Haiku-for-`marisol` cost lever as a live option in §11 rather than take it silently — loosening an established model choice is the operator's call, not mine.

## §5. Panel consultations — per-role discussion notes

### Hire 1 — Marisol Vega (Investor & Sponsor Reporting Associate, Mexico City)

**Discussion**: Maya × Corinne (the lead who owns the cadence Marisol inherits) × Silas (whose single model every figure reconciles to) × Kai (brand-voice consistency).

**LinkedIn / live-JD benchmark** (anchored to 2026-06 postings — the [Spotterful IR Associate responsibilities breakdown](https://spotterful.com/en/blog/job-description-template/investor-relations-associate-responsibilities-and-required-skills), the [Velvet Jobs IR Associate JD](https://www.velvetjobs.com/job-descriptions/investor-relations-associate), the [ADDO IR Associate / Senior Associate listing](https://addo.com/jobs/investor-relations-associate-senior-associate), the [Growth Equity Interview Guide IR job description](https://growthequityinterviewguide.com/investor-relations/investor-relations-careers/investor-relations-job-description), and — for the *sponsor* half — the [Power Sponsorship "role of a corporate sponsorship manager" overview](https://powersponsorship.com/what-is-the-role-of-a-corporate-sponsorship-manager/) on stewardship-report craft):

> *"Take responsibility for the quality and timely delivery of weekly, monthly and quarterly investor reporting. Draft and edit press releases, shareholder letters, earnings releases, investor presentations and factsheets. Translate progress into investor-legible signal. Develop unique stewardship programs for each sponsor and report sponsorship impact on a cadence. Reports to the Director of Investor Relations."*

**Globally competitive candidate profile** (synthesised across the JD reads):

- 5–10 years across IR / corporate-comms / sponsorship-stewardship, with a track record of owning a *recurring* reporting calendar a board (or a sponsor) actually trusted.
- **Reconciliation reflex** — every number in the report ties back to one model; a figure that can't reconcile is a stop-ship, not a footnote.
- **Cadence-over-brilliance** — ships on the calendar, because for both investors and sponsors the predictable report *is* the relationship.
- Comfortable holding C-3 — i.e. *declining* to build a CRM, a distribution list, or a "send" button a hobby-scale platform hasn't earned.

**Chosen persona — Marisol Vega, Mexico City**: Mexico City for a deep overlap with the US/East-Coast reporting window (so reconciliation hand-offs with Corinne in Boston and Silas in NYC happen inside one workday) and ES/EN reach for a LatAm sponsor base; a residence distinct from the existing roster. Deliberately framed as the **report-drafter, not the sender** — Marisol stages every report; the operator distributes. Voice is candid and reconciled-to-the-number, explicitly *inheriting* Corinne's lowlight-first discipline rather than inventing a second house style.

**Corinne's input** (reconstructed): the non-negotiable is that Marisol's reports are *Corinne's* cadence and *Silas's* numbers — Marisol adds volume and timeliness, never a second set of figures or a second voice. The gravest failure on this lane is a sponsor report and an investor update that don't reconcile.

**Silas's input** (reconstructed): lateral discipline — every figure sources to the single finance model; "we don't have the data for that claim" is a sentence Marisol must say as easily as Silas does.

**Kai's input** (reconstructed): lateral edge `marisol ↔ kai`. Sponsor-facing voice, investor-facing voice, and public-content voice must sound like one organisation; Kai and Corinne already run that audit cadence, and Marisol joins it rather than opening a fourth voice.

### Hire 2 — Yara Haddad (Investor Relations Visit & Events Coordinator, Dubai)

**Discussion**: Maya × Corinne (lead) × Delphine (Fundraising — pulled in for the roadshow boundary) × Levi (Product Counsel — pulled in for the what's-safe-to-show boundary).

**LinkedIn / live-JD benchmark** (anchored to 2026-06 postings — the [Selby Jennings IR Coordinator (New York) listing](https://www.selbyjennings.com/en-us/job/investor-relations-coordinator-pr561728_1760992910), the [Prologis IR Coordinator JD on Built In LA](https://www.builtinla.com/job/investor-relations-coordinator/4123078), the [Harrow IR Specialist/Coordinator listing on Built In](https://builtin.com/job/investor-relations-coordinator/3594967), the [VWA IR Coordinator recruitment profile](https://www.vwa.com/roles-we-recruit-for/investor-relations-coordinator-recruitment), and the [Selby Jennings IR market overview](https://josssearch.com/us/marketing-and-investor-relations-job-roles-us/)):

> *"Coordinate logistics for company-hosted events — investor days, capital-markets days, conferences; manage venue, catering, AV, transport. Provide on-the-day logistical support for quarterly results, investor site visits and capital-markets days. Correspond with corporate access for non-deal roadshows; schedule investor meetings; maintain the CRM and investor contact database. 3–5+ years event coordination, ideally corporate."*

**Globally competitive candidate profile**:

- 4–8 years coordinating investor/sponsor events, days, and **site visits** — with a verifiable record of run-of-show ownership where one missed handoff is visible to a principal.
- **Briefing-pack-first reflex** — writes the host's briefing (who is visiting, what they care about, the three questions they'll ask, the one number they'll check) *before* the itinerary; the visit succeeds or fails on the brief.
- **Anticipates the failure on the day** — the AV that doesn't connect, the gap in the schedule, the question with no owner — and closes it on paper in advance.
- Comfortable holding C-3 — stages the visit and hands the operator the keys; **never** confirms a date, extends an invitation, or hosts.

**Chosen persona — Yara Haddad, Dubai**: Dubai for genuine global-events-hub fluency (the MICE / roadshow-logistics centre that bridges Asia, Europe, and the US in one timezone) and a residence distinct from the roster. The role is reframed from the live JD in exactly one load-bearing way, the mirror of Delphine's: **she builds the visit on paper and hands over the keys — she never makes contact and never hosts.** "On-the-day logistical support for investor site visits" becomes "stage the run-of-show and the briefing pack; the operator hosts the day." Voice is calm-under-logistics, checklist-disciplined, allergic to the unowned line item.

**Delphine's input** (reconstructed): lateral edge `yara ↔ delphine`. The boundary: a *fundraising* roadshow (a sequence engineered to move a raise forward) is Delphine's lane — she stages it, the operator runs it; a *relationship-maintenance* visit or sponsor site-tour (no raise attached, the point is the relationship) is Yara's. They cross-cite when a visit has a capital implication; neither runs the other's lane, and **neither makes the contact.**

**Levi's input** (reconstructed): lateral edge `yara ↔ levi`. The moment a visit involves *what gets shown* — a roadmap slide, a metric, a private demo — the "is this safe to disclose, and to whom" question is Levi's and the operator's, never resolved in Yara's run-of-show. Same three-lane discipline that keeps Noor out of opinions, applied to selective disclosure on a visit.

**Corinne's input** (reconstructed): Yara's briefing packs carry *Corinne's* message and *Silas's* numbers — a visit is a reporting surface that happens to be in a room, so the one-story-one-set-of-numbers rule binds the run-of-show exactly as it binds the monthly update.

## §6. What this round costs (the W-3 question — and why there isn't one)

| Layer | Before | New | Delta |
|---|---:|---:|---:|
| Existing roster (post Finance & Capital group) | USD 174/mo | USD 174/mo | 0 |
| `marisol` (Reporting Associate, Sonnet) | — | USD 5/mo | +5 |
| `yara` (Visit Coordinator, Sonnet) | — | USD 5/mo | +5 |
| **Combined** | **USD 174/mo** | **USD 184/mo** | **+USD 10/mo** |

Current W-3 ceiling: **USD 190/mo** (raised 160 → 190 for the Finance & Capital group on 2026-06-14). New total: **USD 184/mo — inside the cap.** **This PR raises no ceiling and edits no L1 doc.** It is the first hire round that fits inside the standing envelope, with USD 6/mo headroom retained. The next round will not fit — that cap conversation is the operator's, flagged here so it isn't a surprise.

Because no cap raise is needed, the API's write-time aggregate check (`184` against `190`) passes on registration without any prerequisite governance merge — unlike the finance group, whose `register.mjs` would have failed loudly until the cap edit landed.

## §7. Registration and runtime activation (deferred)

Per ADR-0007 + the finance-group precedent: both personas register via `POST /agents` with `bindings: []`. The PR ships the registration inputs only; it **wires no cadence**. Wiring the running reporting cadence and the visit-prep cadence is a follow-up via `cadence-forge` + `PATCH /agents/{slug}` (binding is no longer gated on `owners[]` since [adr-0012](../adr/adr-0012-decouple-binding-from-ownership.md), so no skill-ownership amendment is needed first). The personas register, render on `/workforce/agents` and `/workforce/org` (both as ICs under Corinne — org-depth 3 along Maya → Silas → Corinne → them), and sit idle until those follow-ups land — one cadence at a time, with cost monitoring.

Intended cadences (declared here, wired later):

- `marisol` — monthly sponsor/investor reporting-draft cadence, tracking Corinne's calendar (the reporting cadence is the rarest-but-most-reliable; cadence-over-brilliance).
- `yara` — on-demand visit-prep (briefing pack + run-of-show) triggered when the operator names a real visit, plus a low-frequency template-maintenance cadence so the briefing-pack and itinerary templates stay current.

## §8. Theo's people-ops review (reconstructed)

- **Naming**: both slugs (`marisol`, `yara`) match `^[a-z]+$`; no collision with the existing roster. `validate-naming.mjs` passes.
- **Org edges**: Marisol → Corinne; Yara → Corinne. No cycles, no orphans. Corinne gains span 2 (Marisol + Yara) and sits at org-depth 2 (Maya → Silas → Corinne), so Marisol and Yara land at org-depth 3 ICs; Silas's span is unchanged at 2 (Delphine + Corinne). Laterals reference existing slugs only (`corinne`, `silas`, `kai`, `delphine`, `levi`).
- **Playbook delta**: this is the first round that is a *function expansion* rather than a *new group*, and the first that fits inside the standing W-3 cap. Theo will fold two precedent entries into the onboarding playbook: (a) "a function expansion adds ICs under the existing lead, not peers under the VP — preserve the one-voice property recursively"; and (b) "a round that fits the cap ships without an L1 edit — don't manufacture a governance change the round doesn't need."
- **Bench-gap visibility**: this round closes the "finance IC below Corinne" gap the finance round deferred. It does **not** add a sponsor-only reporting IC (folded into Marisol) or a dedicated FP&A analyst (still deferred under Silas). The next gap likely to surface is cap headroom, not headcount.

## §9. What's NOT in this round (and why)

- **Any outbound contact, confirmation, or hosting capability.** The defining exclusion — see §2. Both personas draft and stage; the operator alone acts.
- **A retitle or any config change to Corinne.** She leads the pod under her existing "Investor Relations Manager" title; the optional "Head of IR" retitle is left to the operator (§11 Q2) and is deliberately *out* of this round so the round stays a pure two-IC addition with no Zone B persona mutation.
- **A third hire splitting sponsor-reporting from investor-reporting.** C-3 scale-creep — there are no sponsors to split by. Folded into Marisol.
- **A new VP or second management layer.** The pod-under-Corinne shape is the absorption; Silas's span is unchanged.
- **A W-3 cap raise.** Not needed — see §6. The first round to ship without one.
- **A CRM / contact database / distribution list / "send" button.** The live JDs include these; dropped on purpose — there is no one to put in the database at C-3, and importing one would be exactly the machinery Silas is chartered to flag.
- **Pre-wired cadences / enabled EventBridge rules.** Deferred per §7 — register idle, wire one at a time.
- **Real reports about real sponsors/investors.** There are none. Public output is reporting/visit-coordination *craft* (how to write a stewardship report, how to run an investor site visit), never a report on this platform's (non-existent) sponsors or a record of a real visit.

## §10. Acceptance criteria (for the operator's PR review)

- `workforce/seed/ir-group/{marisol,yara}.json` + `{slug}-system.md` exist; `register.mjs --dry-run` lists both with correct roles, residences, budgets, and `reports_to: ["corinne"]`.
- Both `system.md` files carry the **draft/stage-never-act** guardrail and the bias-disclosure block, parallel-structured to Corinne's.
- `register.mjs:W3_CAP_USD` reads `190`; the script's combined-budget log reads `USD 10/mo` and the aggregate read-back is `184/190` (no cap edit required).
- `governance.md` is **unchanged** (no L1 edit; the standing 190 cap already covers this round).
- `validate-naming.mjs` passes (two new `^[a-z]+$` slugs).
- No EventBridge rule, binding, or persona-config PATCH (including to Corinne) is added — all deferred to follow-ups.

## §11. Open questions I'm sending to the operator

1. **Headcount confirmation: 2, or 1?** The panel landed on 2 (one report-craft IC, one visit-craft IC) because the live JD market splits them and a single generalist is a single point of failure when a reporting deadline and a visit window collide. If you'd rather start with **1** — most likely `yara` (the visit-coordination need reads as the more *novel* of the two, since Corinne already owns reporting) and fold the extra reporting volume into Corinne+Marisol later — that's a one-line cut to the bundle. I recommend 2; flagging the 1-hire fallback.
2. **Retitle Corinne "Head of Investor & Sponsor Relations"?** Leaving her as "Investor Relations Manager" with two reports is coherent and keeps this round PATCH-free (no Zone B persona mutation). Retitling her to signal the lead tier — and to put "Sponsor" in the title now that sponsor reporting is in scope — is a clean signal but is a Zone B identity change I won't take unilaterally. Recommend: **defer the retitle**, revisit after the pod's first cycle. Flagging in case you want it now.
3. **`marisol` on Haiku instead of Sonnet?** The reporting role is the one seat in this round where a Haiku argument holds (reconcile-and-format under Corinne's established voice). It would drop the round to **USD 9/mo** and buy back a dollar of headroom. I defaulted to Sonnet to honour the finance round's "IR craft is judgement-heavy" precedent and protect investor-comms tone, but the lever is yours.
4. **Next round will need a cap conversation.** Post-round headroom is USD 6/mo. This isn't a question for *this* round — it's a heads-up that the *next* hire (or the first enabled cadence that pushes effective spend up) is the one that reopens W-3, which is a Zone B decision you own.

## §12. Bias disclosure for this memo

> Maya is an LLM persona (`anthropic:claude-sonnet-4-6`) on the Workforce platform. The "panel consultations" above are the framings I (Maya) constructed inside my single run; they are **not** transcripts of separate persona-to-persona conversations. Each panellist's "input" is my reconstruction of what their respective `system.md` voices — Silas, Corinne, Kai, Delphine, Levi — would say about the roles I'm framing. Marisol and Yara do not yet exist as running personas; their lanes are designed, not observed. When the bundle registers and they start running, their actual voices will diverge from what I've imagined here — this memo is the proposal and the framing, not the consensus. And the load-bearing fact behind every line: **this platform is a single-operator hobby project with no sponsors, no investors, no reports being sent, and no visits being hosted.** What these two roles produce are craft drafts and templates; the operator alone would ever act on any of it.
