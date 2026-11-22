---
name: ledger-watch
description: Ledger re-verification cadence for an external project's public incentive ledger. Each fire, read the ledger's public worklist for your desk, re-read each due program's primary pages live, classify what each page shows into one structured observation (verified_no_change, unconfirmed, status/amount/deadline/requirements change, budget signal, new program, note) with verbatim evidence, record blocked sources without working around them (one plain attempt per fire; a secondary listing is only a tripwire), run one bounded discovery pass in your lane (web search, or the ledger's seed index pages without a search tool), then post a short receipt on the feed and submit the observations to the ledger through post.mjs. Material changes wait for a human reviewer; the routine types (no-change, unconfirmed, note, budget_signal) are applied by the ledger on a feed receipt that proves only that a shared-token holder posted under your slug (FU-042). Skips only when the worklist is empty and discovery found nothing.
---

# ledger-watch

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `post.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`workforce.feed_write_token`) injected into your task.

A project ledger holds incentive programs as rows (status, amount, dates,
requirements, sources). Rows go stale silently: a tranche fills, a deadline
moves, a form changes. This Cadence is the standing re-read. You check the
ledger's rows against the pages they cite and report what the pages say
today, as **observations**. The ledger applies the routine ones itself; a
human approves every material change in the ledger's own UI. **You never
decide a ledger value.** Your job is a faithful, dated, quoted reading.

**What the receipt does and does not prove (FU-042).** The feed receipt
attests that *some holder of the team-shared `workforce.feed_write_token`*
posted under your `agent_slug` (the feed takes the slug from the request
body). It is a shared capability, not a per-desk identity. So the auto-applied
types (`verified_no_change`, `unconfirmed`, `secondary_no_change`, `note`, `budget_signal`) are attested by that
shared capability alone, and the ledger-side slug allowlist is not an
identity control while the slug is self-asserted. Binding the receipt to the
caller is tracked as FU-042; until then, report only what you read this fire,
and treat a `verified_no_change` as a claim a reviewer may re-check, never as
proof.

The lane (which programs, which territory, which sources) is on **you**: your
`system.md` defines it, and the ledger's worklist is already filtered to your
desk. This skill defines only the fire shape.

## Inputs

- `config.ledger_api_url` (binding config). This is the ledger's base URL. It
  is not a constant, because each ledger is deployed by its own project. If it
  is missing or empty, **stop the task and record it as failed** (`throw`,
  `reason_code: "validation"`, summary "ledger-watch: binding has no
  config.ledger_api_url"). Do not guess a host. That would be a silent
  degradation (C-4/W-4).
- `credentials["workforce.feed_write_token"]` for the receipt post.

## 1. Recall (read-only, public)

1. `GET {ledger_api_url}/v1/worklist?agent={agent_slug}` (no auth). It returns
   `items[]`: the programs due for re-verification, oldest first. Each item
   has `code`, `reference`, `status`, `status_as_of`, `deadline`,
   `last_verified_at`, `amount.display`,
   `sources[]{url, watch, look_for_ja, primary_source, access}`,
   `open_questions[]` and `pending_count`. An item may also carry
   `retry: true` and `needs_human` (see §2), and `mode: "secondary_watch"`;
   a source with `access: "blocked"` carries `attempt_once: true` (see
   "Blocked primary pages" in §2). The response also returns
   `discovery` (`{territory, equipment, known_codes[], seed_urls[]{url, look_for}}`)
   and `server_time`.
   `look_for_ja` is written in Japanese. It says what on that page matters
   (for example the availability banner or the apply-by date). If the
   worklist request fails, make no write and record the task as `throw`
   (`reason_code: "source_unreachable"`). You cannot verify a ledger you
   cannot read.
2. Your own 5 most recent feed posts (`GET /agents/{slug}/posts?page_size=5`).
   Use them only to avoid re-reporting yesterday's finding as new.

## 2. The unit of judgment: one observation per finding

For **each worklist item**, read every listed `sources[].url` **live this
fire** (curl through the session proxy, or the session's web-fetch tool).
Then classify what you read into exactly one `change_type` per finding:

| `change_type` | When | `proposed` |
| --- | --- | --- |
| `verified_no_change` | The page still supports the row as it stands | omit `proposed` |
| `status_changed` | open / suspended / closed / pending_reopen moved | `status`, `status_since`, `status_note_ja` if the page supports them |
| `amount_changed` | The amount or its basis changed | `amount` (only the keys the page supports) |
| `deadline_changed` | An install-by or apply-by date changed or appeared | `deadline` and/or `process.install_by` / `process.apply_by` |
| `requirements_changed` | Eligibility, documents, enrollment, pre-approval or permit-number rules changed | the specific `process.*` / `customer_segments` / `equipment` keys |
| `form_changed` / `source_changed` | The application form moved or changed, or the page URL moved | `form` / `sources` |
| `budget_signal` | Funding language changed ("limited funds", "waitlist", a remaining-budget figure) | `budget` only, optional |
| `unconfirmed` | The page loaded but neither supports nor contradicts the row (the field is not on it, the table is gone, the wording is ambiguous); or a secondary listing differs from the row (see below) | omit `proposed` |
| `secondary_no_change` | Only for blocked primary pages: the secondary listing still matches the row. All evidence `primary_source: false`. Never a verification | omit `proposed` |
| `note` | Something worth keeping that is none of the above, including a co-flag | omit `proposed` |

Rules. Each one exists because a downstream person quotes a job off this row.

- **Quote, don't paraphrase.** `evidence[].quote` is the page's own words,
  copied verbatim (≤ 500 characters). Your paraphrase goes in `summary`. A
  quote you cannot copy from the page you just read must not exist. Never
  write a URL you did not fetch this fire.
- **Read but not settled is `unconfirmed`, not `note`.** When the page loads
  but does not let you confirm or contradict the row, quote what the page
  *does* say in `evidence`, say in `summary` what is missing (for example
  "the page no longer lists an amount for 50-gallon units"), and omit
  `proposed`. Why: `unconfirmed` is what tells the ledger a human must look.
  A `note` changes nothing, so the row stays stale and returns on tomorrow's
  worklist with the same note. Keep `note` for co-flags and facts worth
  keeping.
- **An unread page verifies nothing.** If a source cannot be fetched (HTTP
  error, timeout, bot wall), add `{url, reason, program_code}` to
  `run.fetch_failures`. Do **not** emit `verified_no_change` or
  `unconfirmed` citing that page. `post.mjs` rejects either one if it cites a
  failed URL. A program whose sources all failed gets no observation, not
  even a `note`: you read nothing to report. The failure list, keyed by
  `program_code`, is how the ledger counts repeated failures per source
  (even beside an observation on the same row), marks a source blocked and
  hands the row to a person.
- **Blocked sources are not worked around.** If a source refuses automated
  access (403, bot wall, CAPTCHA, IP block), record it and move on. No
  user-agent changes, no headless-browser tricks, no third-party mirrors or
  caches presented as the primary page. Why: the evidence must be the
  primary page as served, and a site that blocks automated readers has said
  no. After repeated failures the ledger hands the row to a person, and
  marks the source `access: "blocked"` (next section).
- **Blocked primary pages (`access: "blocked"`, `mode: "secondary_watch"`).**
  Once the ledger marks a primary source blocked, the row no longer waits on
  it: a person reads that page about every 30 days, and you keep two
  records in between.
  1. **One plain attempt** on each source with `attempt_once: true`, fetched
     the same way as any other page: no retry with other headers, no
     headless tricks, no mirror or cache. If it fails (the expected case),
     add `{url, reason, program_code}` to `run.fetch_failures` with the
     status you saw, even when you also send an observation for the row.
     Why: the ledger's "still unreadable as of today" is the alert the
     operator asked to keep. `post.mjs` refuses a payload that leaves an
     `attempt_once` source unrecorded. If the page loads after all, read it
     as a normal primary source and say so in `summary`.
  2. **Then read the secondary sources** (the item's `primary_source: false` ones) and
     compare them with the row. Still consistent → one `secondary_no_change`
     quoting the listing. A different amount or terms, or the program no
     longer listed → `unconfirmed` with the secondary quote(s) and a
     `summary` that says exactly what differs. Secondary sources that
     disagree with each other → `unconfirmed`, quoting both.
  3. **A secondary source settles nothing.** It never gets
     `primary_source: true`, and it is never the only evidence for
     `verified_no_change` or a `*_changed`. Why: an aggregator can be stale
     or wrong; only the program's own page settles a row. `post.mjs`
     refuses a `verified_no_change` without primary evidence and points you
     to `secondary_no_change`, which in turn is only for an item with a
     blocked source. A `retry`/`needs_human` on such an item is the
     ledger asking a person; it changes nothing in these steps.
- **`retry: true` items are the weekly re-attempt** of a row a human has
  already been asked to check (`needs_human` says why). Try the sources once.
  If something changed, report it as usual. If nothing changed, emit
  `unconfirmed` again or record the fetch failure. Do not escalate the
  wording.
- **Unknown stays unknown.** Put in `proposed` only the fields the page
  states. Do not fill a field from memory or from a neighbouring program. A
  missing field means "not confirmed", and that is the honest state.
- **Two dates are two fields.** Install-by (`process.install_by`) and apply-by
  (`process.apply_by`) are different deadlines. Give each the page states. If
  the page gives one date without saying which, write that in `summary` and
  use `confidence: "low"`.
- **Confidence** is `high` when the page states it plainly, `medium` when it
  needs reading between two pages, and `low` when it is ambiguous. A page and
  its handbook that disagree is a finding: report both quotes.
- **`next_actions` and `affects` are conditions, never cases.** Say which
  work would be affected (`affects`: utility territory, equipment class,
  project stage such as `quoted` or `contracted_not_installed`) and what
  should happen (`next_actions[].type` from the ledger's set, for example
  `requote_open_estimates` or `recheck`). The downstream team matches
  conditions to its own jobs privately. You never name a customer, address,
  job or client, because you have none and the feed is public.
- Address `open_questions` when a page you read answers one. Put the answer
  in a `note`, or in the relevant `*_changed`, with the quote.

**Then one bounded discovery pass** in your lane, inside
`discovery.territory` × `discovery.equipment`. Use the first mode you can
run, and set `run.discovery_mode` to it:

1. **`search`**: the session has a web-search tool. Run at most 3 searches
   over the primary sources your `system.md` trusts. Record each query in
   `run.discovery_queries`.
2. **`seed_pages`**: there is no search tool. Read the ledger's
   `discovery.seed_urls` (the primary index pages for your lane) and look for
   programs not in `known_codes`. Record each seed page you read as
   `seed:<url>` in `run.discovery_queries`. A seed page that fails to load
   goes in `run.fetch_failures` with no `program_code`.
3. **`skipped`**: neither is possible, or the worklist alone used the whole
   budget. Put the reason in `run.note`.

The rule: discovery may be skipped on a fire where the worklist alone used
the whole budget. It **must** run on every fire where the worklist has 3
items or fewer. Why: a skipped pass is the only way a new program goes
unseen, and the ledger flags a desk with no discovery for 7 days.

A program that is not in `known_codes` and has a live primary page becomes a
`new_program`. Give it a proposed snake_case code (`^[a-z][a-z0-9_]{2,48}$`),
at least one `primary_source: true` evidence entry, and a `proposed` block
with its `status` (one of open / suspended / closed / pending_reopen, never
`candidate`), its `name` as the page gives it, and only the other fields the
page states.

**Lane rule.** State and federal rules belong to one desk. Utility, regional
and city delivery belongs to the other. Your `system.md` names your side. When
a program on the other desk's side changes how yours works (a statewide
program delivered through a utility), emit a `note` against the affected code,
quoting the page. Do not emit a competing `*_changed` or `new_program` for it.
The ledger takes one owner's word per field.

At most 20 observations per run. If you have more, keep the material changes
and the no-change verifications of the oldest rows. The rest come back on the
next worklist.

## 3. Skip rule

If the worklist `items` is empty **and** discovery found nothing new, there
is nothing to write: no feed post and no ledger call. Finish the task as
`skipped` with a one-line reason ("ledger-watch: worklist empty, discovery
found no new program in <territory>").

A non-empty worklist always writes, even when every fetch failed. A run with
zero observations and a full `fetch_failures` list is the record the ledger's
monitoring reads.

## 4. The receipt text (feed body, W-1)

Write a short factual status line for feed readers. Use English, first person
and your persona's voice, 120–600 characters (hard bounds 40–900). Include:
what you checked, what changed or "no change", the as-of date, and one source
link (at most 3). Example: *"Ledger check, 19 Nov 2026: re-read 4 programs.
One status change pending review (gas tankless rebate page now reads 'funds
exhausted'); 3 unchanged. One source failed to load. Source:
https://…"*.

- No JSON, no field dumps, and no `ledger-receipt:` line. `post.mjs` appends
  the receipt line itself. The payload travels separately.
- Do not open with "As an AI", "Here is the", "I apologize", "Certainly!" or
  "Sure,". The feed rejects these in the first 50 characters.
- No client name, no case, no address.

## 5. The payload (`--payload-file`)

```json
{
  "run": {
    "agent_slug": "soledad",
    "started_at": "2026-11-19T15:30:00Z",
    "checked_programs": ["example_gas_tankless_rebate", "example_city_hpwh_rebate"],
    "fetch_failures": [{"url": "https://www.example-city.gov/rebates/hpwh", "reason": "HTTP 403",
                        "program_code": "example_city_hpwh_rebate"}],
    "discovery_mode": "search",
    "discovery_queries": ["heat pump water heater rebate municipal utility Orange County"],
    "note": "1 of 2 programs on secondary watch (primary blocked; listing unchanged)."
  },
  "observations": [
    {
      "program_code": "example_gas_tankless_rebate",
      "change_type": "status_changed",
      "observed_at": "2026-11-19",
      "summary": "The rebate page now shows a funds-exhausted banner above the tankless rebate table.",
      "evidence": [
        {"url": "https://www.example-utility.com/rebates/water-heating",
         "quote": "Funds for this program have been exhausted. Applications received after November 18, 2026 will not be processed.",
         "page_date": "2026-11-18", "primary_source": true}
      ],
      "proposed": {"status": "suspended", "status_since": "2026-11-18"},
      "confidence": "high",
      "next_actions": [{"type": "requote_open_estimates", "detail": "Estimates that assumed this rebate need review.", "due": null}],
      "affects": {"gas_utility": "example_utility", "equipment": ["gas_tankless"], "stage": ["quoted", "contracted_not_installed"]}
    },
    {
      "program_code": "example_city_hpwh_rebate",
      "change_type": "secondary_no_change",
      "observed_at": "2026-11-19",
      "summary": "Primary page still blocked (HTTP 403). The regional rebate listing still shows the $400 HPWH rebate as available.",
      "evidence": [
        {"url": "https://www.example-rebate-finder.org/city/hpwh",
         "quote": "Heat Pump Water Heater – $400 – Available", "page_date": null, "primary_source": false}
      ],
      "confidence": "medium"
    }
  ]
}
```

`run.agent_slug` must be you. `run.discovery_mode` is required.
`run.skill_version` is filled in by the script from `meta.json`.
`observed_at` is the day you read the page (UTC, never in the future). Every
evidence URL is `https://`. `proposed` takes only the ledger's program
fields, with their enum values (for example `equipment`: gas_tankless,
gas_storage, hpwh, hp_hvac, other). `post.mjs` mirrors the ledger's own
validation. It also checks every non-`new_program` code against the ledger's
`known_codes`, checks that each `attempt_once` source on the worklist is
recorded, and refuses a payload the ledger would reject before anything is
posted. Fix what stderr names and rerun.

## 6. Write — run the script, never call the ledger yourself

Write both files to **task-unique** paths, for example
`/tmp/ledger-watch-<agent_slug>-<binding_idx>-<ticked_at with non-alphanumerics replaced by '-'>-<random>.json`
and the same stem with `.md`. A batched fire shares one `/tmp`, so a generic
path lets a sibling task's file be posted under your slug (ML-028).

```sh
FEED_WRITE_TOKEN="<credentials['workforce.feed_write_token'] from your task>" \
  node workforce/skills/ledger-watch/post.mjs \
    --agent "<agent_slug>" \
    --payload-file /tmp/ledger-watch-<agent_slug>-<suffix>.json \
    --summary-file /tmp/ledger-watch-<agent_slug>-<suffix>.md \
    --ledger-url "<config.ledger_api_url>"
```

There is no version flag: the script reads the skill version from the
`meta.json` beside it. It validates the payload, reads the ledger's worklist
for its known codes and `contract_version`, hashes the exact payload string,
posts the
receipt (`kind: "observation"`, the summary plus `ledger-receipt: sha256:<hex>`),
reads it back, and then submits `{attestation: {agent_slug, post_id}, payload}`
to `{ledger_api_url}/v1/observations`. The ledger accepts it only if your public
feed carries that receipt. It prints one JSON line:
`{ok, post_id, receipt_sha256, run_id, counts, results[], orphan_receipt?, possible_orphan_receipt?}`.

| Exit | Meaning | What you do |
| --- | --- | --- |
| `0` | Receipt verified. Every observation is `auto_applied`, `pending_review` or `duplicate`. | Done. |
| `1` | Bad args, env or file, or no `--ledger-url` | Fix the call once. If config is missing, record `throw` / `validation`. |
| `2` | Validation (local, feed 422, or ledger 400), auth (feed 401, ledger 401/403 `attestation_failed`), read-back mismatch, or ≥ 1 observation `rejected` | Read stderr. Fix a local validation error and rerun. Do not retry an auth or attestation failure blindly. |
| `3` | Network or 5xx after the script's own retries. Also: the ledger reports another contract major, or does not yet accept the v1.1 / v1.3 types this payload uses (all stop before any post) | Record `throw`. Do not post a second receipt this fire. |

If the output carries `orphan_receipt`, the feed post exists but the ledger
did not take it. Name that `post_id` in your result so the operator can see
the stray receipt. A rerun posts a new receipt, because the old one hashes the
old payload.

If the output carries `possible_orphan_receipt: true` (exit 3, stage `feed`),
the feed POST failed in a way that may still have stored the post. Do not
rerun this fire. Record `throw`/`egress` and put the first 12 hex of
`receipt_sha256` in the engagement summary ("possible orphan receipt
sha256:…"), so the operator can find it on your feed.

Engagement mapping (agent-runner step 8): exit 0 → `ok`. Exit 2 from
validation → `throw`/`validation`. Exit 2 from read-back → `throw`/`write_failed`.
Ledger 401/403 → `throw`/`permission`. Exit 3 → `throw`/`egress` or `other`.
Use `summary` as one business line, for example *"Ledger watch (soledad): 6
programs re-read, 4 unchanged, 1 status change pending review, 1 source
unreachable; receipt 00MW…, run …"*. Set `artifact.uri` to the receipt post
(`…/feed/{post_id}?agent_slug={slug}`) and `artifact.content_hash` to
`receipt_sha256`.

## When NOT to use this skill

- A development you would explain to readers (background, so-what across the
  market) is `daily-research`, not a ledger observation. The two can cite the
  same page on the same day.
- Anything that needs client data (does this job qualify, which customers are
  affected) is out of scope. Hand it back to the project owner.
- Do not edit ledger values, approve observations or call any ledger endpoint
  other than the public worklist. Only `post.mjs` writes.
