# Podcast rights gate — design note

- **Status**: Proposed (draft PR for #673, items 2–5; `wf:lane:design`). A design note, not an ADR:
  it settles *how* the gate states and extends what ADR-0016 already established (a mechanical
  citation guard, Idris owning the rights checklist). It binds no later decision except the two
  operator decisions named at the end (items 3 and 5, answerable separately).
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
PASS (scope: 1 of 7 fronts machine-examined; 1 more LLM-judged only)
  1 reproduction ........ LLM-judged (self-attested, not counted until slice 2 adds a script)
  2 market substitution . NOT examined
  3 voice/likeness ...... NOT examined (stock TTS voice only, see bucket table)
  4 CMI removal ......... machine, partial: presence only (citations non-empty, every URL resolved n/n)
  5 officer liability ... NOT examined (human)
  6 acquisition method .. NOT examined
  7 agent-access permission NOT examined
```

Rules: a verdict line must never read bare `PASS`; the first line carries "N of 7". Each front
has exactly one state (`machine`, `machine-partial`, `llm-judged`, `not-examined`), set by the code
that ran. **N is computed at runtime as the number of fronts whose state is `machine` or
`machine-partial`**, never typed by hand, so the trailer cannot overstate the gate. An LLM-judged
front (front 1 today) is shown but not counted: the generating model auditing its own script is
self-attestation, not a check. A front moves into the count only when a script, not a sentence in
`SKILL.md`, checks it. The trailer above is the shape for today's code, which counts one front (4);
an earlier draft of this note said "3 of 7" and was wrong on its own table.
The public wording about podcast safety is updated by the operator to say what the
trailer says (out of scope here).

### 2. Three buckets (#673 item 4, using Idris's split)

| # | Front | Bucket | Why / what would move it |
|---|---|---|---|
| 1 | Reproduction | **Mechanisable** | Compare script n-grams to each fetched cited source; threshold is the operator's, as with any rights threshold. Today LLM-judged. |
| 2 | Market substitution | **Judgement remains** | Whether an episode substitutes for the source's own audience is a contested legal-and-commercial question. |
| 3 | Voice / likeness | **Settled by construction** | Stock voices only (Gemini TTS per ADR-0043, previously Polly). Mechanise as an assertion in config: no cloned or named-person voice. |
| 4 | CMI removal | **Mechanisable (partly)** | Partial today: the guard in `workforce/skills/podcast-script/publish-notion.mjs` ("Citation guard", exit 2) checks the citations text is non-empty and that every URL in it resolves (`verifyCitationsResolve`, `scripts/lib/citation-urls.mjs`). It does not check that the published show-notes actually carry that attribution; that is a presence check on the input, not on the output. Closing it means asserting on the rendered show-notes. |
| 5 | Officer personal liability | **Judgement remains** | Human, by definition. |
| 6 | Acquisition method | **Mechanisable (partly)** | A fetch log recording robots.txt and paywall state per cited URL. |
| 7 | AI-agent access permission | **Mechanisable (partly)** | Same fetch: robots.txt / machine-readable TDM reservation. |

Only rows 2 and 5 stay on the human pile. Row 3 is the one settled bucket. The rest are candidates
to move into the middle bucket, each by its own slice.

### 3. Post-contract terms watch (#673 item 3)

A new Cadence, `podcast-terms-watch`, scaffolded with `cadence-forge` and modelled on `grid-watch`
(a bundled `post.mjs` writes to the feed with `workforce.feed_write_token`). Weekly.
It reads a small registry of terms pages we depend on (`workforce/docs/podcast/platform-terms.json`:
`{platform, url, why_it_matters, last_hash, last_read}`).

**Shape: hash first, LLM only on change.** The script fetches each page, normalises it, and hashes
it. Only a page whose hash differs from `last_hash` is handed to the LLM, whose job is to say
*what changed and which promise it bends*. The script owns hashing and the registry update (as a
PR, per R-N9 on git writes). A quiet week costs a fetch loop and no model call.

**Normaliser (specified, because it decides what counts as "changed").** Extract the main text
only (drop scripts, styles, nav/footer, cookie banners), decode entities, collapse all whitespace
runs to one space, lowercase, and strip dates and "last updated" lines. Hash the result with
SHA-256. A fixture test pins this: markup-only and date-only edits must hash identically; a changed
sentence must not.

**Failure is a distinct, loud outcome, never "unchanged".** Each page ends in exactly one of
`changed`, `unchanged`, `fetch-failed` (non-2xx, timeout, redirect to a login or consent wall) or
`body-too-short` (normalised body under a minimum length, set per page in the registry, default
500 characters, so an empty shell or login wall cannot hash as a real page). `fetch-failed` and
`body-too-short` post a failure observation naming the page and leave `last_hash` untouched. The
run exits non-zero if any page ended in a failure outcome (C-4). A page that fails twice in a row
is itself an issue.

**Routing.** A `changed` page whose `why_it_matters` tag is revenue share, ad-skip rights, or the
definition of a view opens an issue. The receiving lane is Idris, who owns the rights checklist
(ADR-0016), routed by adding a `podcast-terms-change` finding kind to
`workforce/skills/ops-accountability-watch/owner-routing.mjs` (which throws on an unrouteable
kind, so the kind must be added with its owner, not defaulted). The weekly registry PR is reviewed
by Idris; Rhys is the second name if the operator wants one. Both are proposals for the operator
to confirm.

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

- A fixed verdict trailer makes every episode look "less safe" on paper (1 of 7). That is the
  point, but the operator should expect the wording change to be noticed.
- One new Cadence adds to the W-3 ledger: `cost_class: small`. **Estimate: about USD 1-3 per month**
  (assumption, not measured: four weekly fires, a model call only in weeks where a watched page
  changed; `grid-watch` is the same `small` class). The alternative of an LLM reading every page
  every week costs more for the same signal, which is why the hash-first shape in section 3 is the
  proposal. Per CLAUDE.md, no binding is wired without a budget line, so the binding is a separate
  operator-approved step, and the figure above is what that budget line would carry.
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

Each slice names the failure its test exists to catch. **Zone A** marks a slice that edits a
`SKILL.md` body or another Zone A file, and so needs the operator's merge.

1. `publish-notion.mjs`: render the scoped trailer from per-front state. Tests: a bare `PASS` is
   impossible; N equals the count of `machine`/`machine-partial` fronts for every combination of
   states (catches a hand-typed or stale N, the defect in the first draft of this note).
2. Source-overlap check for front 1 using the already-fetched cited pages. Test: a script that
   copies a fixture source passage is flagged, and a paraphrase and a short attributed quote are
   not (catches both a blind check and the false-positive class named under "What it costs").
3. `pick-article.mjs`: add `uncitable_skipped` to output. **Zone A** (also edits the `SKILL.md`
   line quoting it, with a `meta.json` version bump). Test: the count appears in both the
   `{skip:true}` and the chosen-article output (catches the count going silent again).
4. `podcast-terms-watch` Cadence scaffold, registry seed, and the `owner-routing.mjs` kind (binding
   wired separately; the `SKILL.md` body is **Zone A**). Tests: the normaliser fixtures from
   section 3; each of `fetch-failed` and `body-too-short` exits non-zero and leaves `last_hash`
   unchanged (catches a failure reading as "no change").
5. Fetch log for fronts 6-7 (robots.txt / TDM reservation). Test: a disallowed robots.txt and a
   paywalled fixture are recorded as such per URL (catches a fetch that records nothing).

## Operator decisions (two, answerable separately)

- **Decision A, terms watch (item 3):** adopt the `podcast-terms-watch` Cadence and its estimated
  W-3 line. Answering no leaves slices 1, 2, 3 and 5 unaffected.
- **Decision B, empty-`SourceURLs` skip (item 5):** confirm the skip stays intentional. Independent
  of A.
