# Client Studies Office round — one-shot registration inputs

Eleven-agent 2026-10 round (`workforce/docs/hires/client-studies-office-reorg-round.md`)
built from the three-month retrospective of the `semi-value` client studies in
`refluster/personal-goal`. This folder is the **registration batch**; the seats are
placed across **six org branches** by the method/function rule below (the org tree is
built from each agent's `reports_to` edge, not from this folder). Placement of `ines`
and `haruto` and the model of `margaux` were fixed by the internship round recorded in
the round doc §13 (full work samples live in the client's private repository,
not here — this repository is public).

**Client Studies Office** (method seats — report into the Office lead):

| Slug | Role | Residence | Reports to | Model | USD/mo |
|---|---|---|---|---|---|
| `margaux` | Program Director, Client Studies Office | Singapore, SG | `beatriz` | Opus 4.7 | 12 |
| `oksana` | Numbers Controller & Fact-Bank Steward | Warsaw, PL | `margaux` | Sonnet 4.6 | 7 |
| `tariq` | Knowledge Integration Librarian | Amman, JO | `margaux` | Sonnet 4.6 | 7 |
| `pranav` | Quantitative Modelling Engineer | Pune, IN | `margaux` | Sonnet 4.6 | 7 |
| `haruto` | Japan Corporate Decision Translator | Osaka, JP | `margaux` | Sonnet 4.6 | 7 |

**Independent of the Office lead** (verification and measurement stay outside the study line):

| Slug | Role | Residence | Reports to | Model | USD/mo |
|---|---|---|---|---|---|
| `nikhil` | Independent Research Verifier | Chennai, IN | `beatriz` | Sonnet 4.6 | 7 |
| `dalia` | Evaluation & Calibration Scientist | Cairo, EG | `beatriz` | Sonnet 4.6 | 6 |

**Placed by function** into existing branches:

| Slug | Role | Residence | Reports to | Model | USD/mo |
|---|---|---|---|---|---|
| `ines` | Decision Broker, Human Last Mile | Lisbon, PT | `camille` (Chief of Staff) | Sonnet 4.6 | 7 |
| `yusuf` | Information Design & Publishing Engineer | Istanbul, TR | `elena` (CX) | Sonnet 4.6 | 8 |
| `arjun` | Corporate Development & Investment Committee Lens | Mumbai, IN | `silas` (Finance) | Sonnet 4.6 | 6 |
| `kavita` | Grid Planning & DISCOM Operations Lens | Nagpur, IN | `anjali` (India desk) | Sonnet 4.6 | 6 |

Combined planned budget **USD 80/mo**. The W-3 cap is raised 600 → 800 in its own
Zone A PR; on planned figures the round fits under 600 (343 → 423), the raise is for
metering the study runs that `personal-goal` brings onto the ledger.

## Files

- `{slug}.json` — the `POST /agents` body minus `system_prompt` (`bindings: []`,
  `default_project: "personal-goal"`, `streams: ["internal","client"]`).
- `{slug}-system.md` — the persona prompt; its first line `# Name — Role — City, CC`
  must match `role` exactly (S19).
- `register.mjs` — registers in parent-before-child order; `--dry-run` needs no credentials.

## Order of operations

1. Merge the W-3 raise PR (the API rejects a create whose roster sum passes the enforced cap).
2. Merge and seed `workforce/projects/personal-goal/project.json` (`npm run workforce:projects:seed`)
   — the seats' `default_project`.
3. `aws-vault exec <profile> -- node workforce/seed/client-studies-office/register.mjs`.
4. Rebuild the console manifest; then wire cadences per the round doc §7.3 with
   `cadence-forge` (first versions are authority A; enabling cron is authority B).
5. Apply the authority-B changes to existing seats listed in the round doc §5.3, one
   persona per `PATCH /agents/{slug}`.

All eleven prompts carry the standard LLM-persona bias disclosure, the C-3 no-outreach
guardrail, and an ADR-0045-style speculative kill criterion dated 2027-01-31.
