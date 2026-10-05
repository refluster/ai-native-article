# Podcast rights gate — design note

- **Status**: Proposed (draft PR for #673, items 2–5; `wf:lane:design`). A design note, not an ADR:
  it settles *how* the gate states and extends what ADR-0016 already established (a mechanical
  citation guard, Idris owning the rights checklist). It binds no later decision except the two
  operator confirmations named at the end (items 3 and 5).
- **Implements nothing.** Implementation is the slice list at the end. Item 1 of #673 (cited URLs
  must resolve) already shipped in #726 and is not re-opened here.
- **Not legal advice.** The seven-front bucket assignment below is a drafting proposal for Idris
  and Priya to correct. Where it names a legal question as "settled" or "machine-checkable" it is
  their call, not this note's.

## Decision

The green verdict on a podcast episode must **state its own scope** from one fixed list of the
seven rights fronts, saying for each whether it was machine-checked, judged by the LLM, or not
examined. Three further changes follow: a weekly **platform-terms watch** Cadence for the
post-contract axis, a **three-bucket re-sort** of the gate items, and a written **confirmation
that the empty-`SourceURLs` skip is intentional**, with its count made visible instead of silent.

## What forced it

- **The assurance was wider than the gate.** Per #673, the published claim ("every episode has
  full, accurate sources") was a policy, while the code checked non-emptiness. #726 fixed that
  specific check, but the one-line verdict it added
  (`publish-notion.mjs`: "Not verified: citation-supports-claim … platform-terms drift") names two
  gaps out of what #673 counts as seven fronts. The remaining five are not mentioned anywhere a
  reader of the verdict would see.
- **Even the "checked" front is partly self-attested.** In `podcast-script/SKILL.md` step 5, "no
  verbatim reproduction" is the generating LLM auditing its own script and writing `PASS` or
  `FLAG`. Nothing compares the script to the fetched sources. The gate verifies URLs resolve
  (`scripts/lib/citation-urls.mjs`), which says nothing about overlap.
- **Every failure #673 cites happened after signing.** Platform ad-skip rights, a redefined "view"
  metric, an ad vendor overriding category choices: none broke a promise at contract time. A
  once-at-write check cannot see them by construction.
- **Item 5 is a decision nobody wrote down.** `pick-article.mjs` filters out any article with empty
  `SourceURLs` (lines ~80–95), logs the count to stderr only, and returns
  `{skip:true, reason}` with no count. The stderr line is invisible in the engagement record, which
  is where #673 says the operator and Rhys looked and found nothing for 8+ reports.

## Design

### 1. The scoped verdict (#673 item 2)

`complianceVerdict` gains a fixed trailer rendered by `publish-notion.mjs`, not written by the LLM,
so it cannot drift from what the script actually ran:

```
PASS (scope: 3 of 7 fronts examined)
  1 reproduction ........ LLM-judged; n-gram overlap vs fetched sources: <n>% (slice 2)
  2 market substitution . NOT examined
  3 voice/likeness ...... NOT examined (stock TTS voice only, see bucket table)
  4 CMI removal ......... machine: show-notes credits non-empty, every URL resolved (n/n)
  5 officer liability ... NOT examined (human)
  6 acquisition method .. NOT examined
  7 agent-access permission NOT examined
```

Rules: a verdict line must never read bare `PASS`; the first line carries "N of 7"; a front
moves from `NOT examined` to a checked state only when a script, not a sentence in `SKILL.md`,
checks it. The public wording about podcast safety is updated by the operator to say what the
trailer says (out of scope here).

### 2. Three buckets (#673 item 4, using Idris's split)

| # | Front | Bucket | Why / what would move it |
|---|---|---|---|
| 1 | Reproduction | **Mechanisable** | Compare script n-grams to each fetched cited source; threshold is the operator's, as with any rights threshold. Today LLM-judged. |
| 2 | Market substitution | **Judgement remains** | Whether an episode substitutes for the source's own audience is a contested legal-and-commercial question. |
| 3 | Voice / likeness | **Settled by construction** | Stock voices only (Gemini TTS per ADR-0043, previously Polly). Mechanise as an assertion in config: no cloned or named-person voice. |
| 4 | CMI removal | **Mechanisable** | Show-notes carry attribution and links; the existing guard already covers the credit list. |
| 5 | Officer personal liability | **Judgement remains** | Human, by definition. |
| 6 | Acquisition method | **Mechanisable (partly)** | A fetch log recording robots.txt and paywall state per cited URL. |
| 7 | AI-agent access permission | **Mechanisable (partly)** | Same fetch: robots.txt / machine-readable TDM reservation. |

Only rows 2 and 5 stay on the human pile. The rest are candidates to move into the middle bucket,
each by its own slice.

### 3. Post-contract terms watch (#673 item 3)

A new Cadence, `podcast-terms-watch`, scaffolded with `cadence-forge` and modelled on `grid-watch`
(LLM judges, a bundled `post.mjs` writes to the feed with `workforce.feed_write_token`). Weekly.
It reads a small registry of terms pages we depend on (`workforce/docs/podcast/platform-terms.json`:
`{platform, url, why_it_matters, last_hash, last_read}`), fetches each, and posts one observation
only when a page's normalised text hash changed since `last_hash`. The LLM's job is to say *what
changed and which promise it bends*; the script owns hashing and the registry update (as a PR, per
R-N9 on git writes). A change to a page that touches revenue share, ad-skip rights, or the
definition of a view opens an issue routed by `owner-routing.mjs`.

### 4. The empty-`SourceURLs` skip (#673 item 5)

The decision is **kept**: an article with no sources cannot yield a compliant episode (ADR-0016,
mandatory citations), and letting it through would be a rights regression. What was wrong was the
silence. Change: `pick-article.mjs` adds `uncitable_skipped: <n>` to both the `{skip:true}` output
and the chosen-article output, and the `podcast-script` run summary quotes it. Remedy path stays
"add `SourceURLs` in Notion".

## Alternatives rejected

- **One big gate that blocks on all seven fronts.** Rejected: five fronts have no reliable
  mechanical test today, so it would either never ship or fail open with a green mark, which is the
  exact defect.
- **An ADR.** Rejected: the question is how to build inside ADR-0016, and an ADR would put a bug
  fix in the operator's ratification queue (per the lane's own guidance).
- **Terms watch as a human checklist.** Rejected: the failures were discovered by reading, late; a
  weekly hash diff is cheap and falsifiable.
- **Drop the empty-`SourceURLs` skip.** Rejected: see item 5.

## What it costs

- A fixed verdict trailer makes every episode look "less safe" on paper (3 of 7). That is the
  point, but the operator should expect the wording change to be noticed.
- One new Cadence adds to the W-3 ledger: `cost_class: small`, one weekly fire. Per CLAUDE.md, no
  binding is wired without a budget line, so the binding is a separate operator-approved step.
- n-gram overlap will false-positive on quoted statutes and short attributed quotes; the
  threshold needs a small corpus of real scripts to tune.

## How it would be reversed, and what says it was wrong

Remove the trailer renderer; the verdict reverts to free text. It was wrong if, after four weeks,
the terms watch has produced no change that a human judged material (retire the Cadence per the
upside test) or the trailer is routinely copied into public copy without the "N of 7".

## Out of scope

- Any change to the rights thresholds, the public safety wording, or Idris's persona.
- Whether the citation *supports* the claim (semantic; stays an LLM judgment, and the trailer says so).
- Podcast RSS/Spotify work (#385, #400, #398).

## Implementation slices (follow-up `issue-implement`, one PR each)

1. `publish-notion.mjs`: render the scoped trailer; unit test that a bare `PASS` is impossible.
2. Source-overlap check for front 1 using the already-fetched cited pages.
3. `pick-article.mjs`: add `uncitable_skipped` to output; SKILL.md line quoting it (version bump).
4. `podcast-terms-watch` Cadence scaffold + registry seed (binding wired separately).
5. Fetch log for fronts 6–7 (robots.txt / TDM reservation).

**Operator confirmations needed**: item 3 (adopt the Cadence and its W-3 line) and item 5 (the skip
stays intentional).
