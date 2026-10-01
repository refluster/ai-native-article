# AI-disclosure surface (reader site + podcast) — design record

- **Status**: Proposed 2026-09-14 (this PR) — decision record only, nothing in
  this diff is implemented.
- **Forced by**: [#668](https://github.com/refluster/ai-native-article/issues/668)
  (`wf:lane:design`, `layer:L1`), part of the monthly-report sweep
  [#659](https://github.com/refluster/ai-native-article/issues/659). Sibling:
  [#667](https://github.com/refluster/ai-native-article/issues/667) (the
  accountable-reviewer appointment + outside-counsel question — **out of
  scope here**, see below).
- **Design rules**: none yet in [`../../newsletter/docs/DESIGN.md`](../../newsletter/docs/DESIGN.md)
  — `grep -i disclos` returns nothing there today. §"What this proposes for
  DESIGN.md" below is the addition this record argues for.
- **Existing surface referenced**: [`feed-ui-v1.md` §10 / TODO-H](feed-ui-v1.md)
  (the workforce console's `PostCard` AI badge — hover-only tooltip, the
  anti-pattern this record deliberately does not repeat).

## Decision, in one sentence

Reader-facing AI disclosure becomes a **persistent, keyboard-reachable,
always-visible** affordance on every article (not a hover tooltip) linking to
one new `/about` page that explains who and how; podcast episodes carry the
disclosure **spoken twice** (open + close) plus a machine-readable provenance
field, and the CI synthesis step **refuses to run** on an episode missing that
verdict.

## What forced it

Three independent letters converged on the same shape of failure — "the
obligation is technically met and the reader learns nothing" — and one of them
is an outright gap, not a UX defect:

- **Elena, 2026-08 letter** (`f2b4d50d3b1b`): the visual affordances that
  happen to satisfy AI-Act detectability (image signatures, byline chips) were
  *assembled* from production tooling, never *designed* for the obligation —
  "義務の日が来たとき、たまたま条件を満たしていた". Zero of the five internal
  readings on this topic in August became one reader-facing explanation.
- **Celeste, 2026-09 discovery 3** (`d482e5e92f0d`), from Odette's vendor
  survey: cloud TTS providers watermark voice **clones** of real people; our
  stock synthetic voices (Takumi/Kazuha/Tomoko — nobody's voice) get **no**
  watermark, no proof, from the vendor, ever. The EU AI Act Article 50 final
  guidance exempts human-edited text but **not** synthetic audio, and requires
  the disclosure to **repeat** (a listener can't scroll back), not run once at
  the top.
- **Maya, 2026-09 §5** (`c67fc4b00375`): the mechanics assumption was wrong —
  the finalised rule wants **both** a machine-readable provenance signal *and*
  a separate inaudible watermark; one alone is insufficient.
- **The sequencing failure is concrete, not hypothetical.** Celeste recorded
  audio and finished show-notes on 2026-08-30; two hours later California's
  audio-specific transparency law took effect. Nothing in `podcast-script` /
  `podcast-publish` today would have stopped that recording, because nothing
  checks disclosure before synthesis.
- **The `feed-ui-v1.md` TODO-H precedent is the warning, not a fix to copy.**
  The console's own AI badge tooltip is `title=` on an inner `<span>` —
  hover-only, invisible to keyboard users (WCAG 1.4.13). "Technically present,
  practically absent" is exactly Elena's diagnosis restated in accessibility
  terms. The reader site's `AuthorChip` ([`newsletter/app/src/components/byline/AuthorChip.tsx`](../../../newsletter/app/src/components/byline/AuthorChip.tsx))
  currently carries **no badge or tooltip at all** — so there is nothing to
  retrofit; the fix is to not build the same defect twice.

Verified in-repo: no route, component, or Notion property in `newsletter/app/`
or the podcast skills currently encodes a disclosure string, a provenance
field, or a pre-synthesis check. The gap is real, not a reporting artefact.

## Scope of this record

Two surfaces, one shared principle (repeat + persistent + machine-checkable,
never hover-only-or-once):

## 1 — Reader-facing disclosure (article site, `newsletter/app/`)

**Today**: `AuthorChip` renders avatar + name + role, linking out to the
workforce console profile (Cognito-gated for most visitors) where the bias
disclosure paragraph lives. A reader who never clicks through, and every
non-operator visitor who hits the Cognito wall, sees nothing.

**Decision**:

1. **A persistent, non-hover line under the byline on every article**, not
   folded into the chip's hover state and not gated behind the console
   click-through:
   > AI-authored — [how this is written →](/about)
   (JA: 「AIが執筆 — [制作の仕組みを見る →](/about)」)
   Rendered as static text beside `AuthorChip`, not inside it — keeps
   `AuthorChip` reusable for the console's own (authenticated) surfaces where
   the fuller disclosure already lives one click away, and avoids a second
   component with two different disclosure depths racing each other.
2. **A new public route, `/about`**, alongside the existing `/system`,
   `/sources`, `/operator` set. `/system` is the company-pitch page (English,
   "≈250 specialist agents", B2B framing) — not a fit; a reader-disclosure
   page inside a sales page is exactly the "assembled, not designed" pattern
   this record exists to stop. `/about` is new, reader-addressed, and answers
   Elena's own frame: who writes this, how, and what a reader should weigh it
   against. **Content authorship is explicitly Elena's, not this record's**
   (see Out of scope) — this record fixes only the route's existence, its
   link-in points (byline line above + footer), and that it ships
   keyboard-accessible from the first commit (no `title=`-only tooltip
   anywhere in the new surface — every disclosure string is rendered text,
   never attribute-only).
3. **No hover-only affordance anywhere in this surface.** Any future badge
   added to the reader site's `AuthorChip` must put its tooltip text on the
   focusable element itself (the `<a>`), exactly the fix TODO-H already
   specifies for the console — done once, correctly, rather than shipped
   broken and patched later.

**What this proposes for `DESIGN.md`** (Zone A — not edited by this PR; the
operator would land this as a follow-up diff to `newsletter/docs/DESIGN.md`
once the `/about` page ships): a short "§Reader disclosure" section pointing
at this record, the way `research-surface.md` and `public-docs.md` are each
anchored from a `DESIGN.md` section today.

## 2 — Podcast disclosure & provenance (`podcast-script` / `podcast-publish`)

**Decision — spoken text, twice, not once:**

- **Open** (within the first ~30–45s, before any source content): a full
  sentence naming the mechanism — e.g. 「この番組は、AIエージェントが原稿を作
  成し、合成音声で読み上げています。」
- **Close** (last ~15–20s, after the final citation callout): a short
  reminder, not a repeat of the full sentence — e.g.
  「この音声はAIによる合成音声でした。」
- Rationale: Art.50's finalised guidance is explicit that a once-at-the-top
  disclosure fails for audio specifically, because a listener cannot scroll
  back to re-read it (Celeste's finding). Twice (open + close) is the minimum
  that survives someone joining mid-episode or leaving before the end without
  requiring a disclosure every N minutes, which would be worse for the
  listening experience than the problem it solves.

**Decision — dual machine-checkable provenance, not one:**

1. **Machine-readable provenance field**, attached at the RSS/feed level
   (alongside the existing mandatory-citations block `podcast-publish`
   already appends) — episode metadata stating: AI-generated, the narration
   model/voice pool, and the source article URL. This is the "detectable by a
   machine" half.
2. **An inaudible watermark in the synthesized audio itself.** This record
   decides the **requirement** (per Maya's finding, the provenance field
   alone is insufficient — a watermark surviving the MP3 must also exist) and
   that it is **engineering's call, not this record's**, which specific
   watermarking method/vendor to use — see Out of scope. The requirement is
   binding; the implementation choice is not decided here.

**Decision — the pipeline gate moves before synthesis, and is a hard gate,
not advisory:**

`podcast-script`'s step 5 already writes a `complianceVerdict` (Idris's rights
check — verbatim reproduction, citation completeness) as an **advisory**
field; a `FLAG` doesn't block anything mechanically, it's a signal the
operator reads. That's the right shape for a judgment call. Disclosure is
different: it's a **checkable fact** (does the script contain the two
required lines, in the two required positions), which is exactly the kind of
check that should be mechanical rather than advisory — advisory is how
Celeste's episode got recorded two hours before the wire tripped.

Proposed shape (naming follows the existing `complianceVerdict` /
`podcastVoice` convention in `set-params.mjs` / `publish-notion.mjs`):

- A new Notion property, **`podcastDisclosureVerdict`** (`PASS` /
  `FLAG: <reason>`), written by `podcast-script` step 5 alongside
  `complianceVerdict` — mechanically checkable (open line present in the
  first ~15% of the script, close line present in the last ~10%), not an LLM
  self-report.
- **`podcast-publish`'s CI-side `synthesize.mjs`** (the actual "recording"
  step — Polly synthesis) reads `podcastDisclosureVerdict` before kicking off
  an episode and **refuses (fails loud, C-4) any episode without `PASS`**,
  the same way the existing citation guard refuses an empty citation list.
  This is the concrete fix for the sequencing failure: the gate sits at the
  one step that cannot be outrun, because it *is* the recording step.

## Alternatives rejected

- **One-line intro only, matching the pre-guidance assumption.** Directly
  contradicted by the finalised Art.50 guidance Celeste found; would ship
  non-compliant by the time it lands.
- **Advisory-only disclosure check (mirror `complianceVerdict`'s `FLAG`
  pattern exactly).** Rejected for the disclosure gate specifically — the
  whole finding is that an advisory signal an LLM session reads but nothing
  enforces is how the CA-law sequencing gap happened. A rights judgment call
  earns advisory; "does the script contain two required strings" does not
  need a judgment call at all, so it should not depend on one.
- **Put the reader disclosure inside `AuthorChip` itself (badge + tooltip),
  matching the console's `PostCard` pattern.** Rejected: that pattern is
  exactly the TODO-H defect (hover/attribute-only). Copying an already-known
  accessibility failure into a second surface is not a fix.
- **Route the reader explainer through the workforce app's existing `/docs`
  content surface** (`workforce/app/src/content/docs/`, whitepaper /
  manifesto / founding-story) instead of a new newsletter-app route.
  Rejected: that surface is `workforce.kohuehara.xyz` — the company-facing
  site (Cognito app shell, B2B framing). The disclosure has to live where the
  reader already is, `kohuehara.xyz/ai-native-article`, or it repeats Elena's
  own diagnosis ("読者に向けた説明は、一本もありませんでした" said about
  internal-only readings; routing the fix to another internal-facing surface
  reproduces the same gap one hop over).
- **Pick the watermarking vendor/method in this record.** Rejected — that is
  a technology selection with cost/quality tradeoffs (audible-quality
  degradation, licensing, decode tooling) that deserves its own evaluation,
  not a byproduct of a disclosure-UX decision. Named as follow-up scope
  below.

## What it costs

- One new reader route + its content (Elena) + a byline-line change on every
  article (Zone B, small diff).
- `podcast-script` step 5 gains a second mechanical check; `synthesize.mjs`
  gains a refusal branch — both additive, no change to the existing rights
  check or citation guard.
- A `DESIGN.md` diff (Zone A, operator-approved) once `/about` ships, so the
  rule is discoverable the way `/research` and `/docs` already are.
- The watermark requirement (2b above) is unscoped cost until engineering
  picks a method — flagged, not hidden.

## How this would be reversed / falsifiers

- **Reversal**: revert the byline-line + `/about` route; drop
  `podcastDisclosureVerdict` from the two scripts. Nothing else in the
  pipeline depends on either — same shape as this ADR's own "delete the
  binding" reversal pattern used by ADR-0022's author lane.
- **Falsifier for the reader half** (mirrors Elena's own 2026-08 仮説一): once
  `/about` ships, if September-equivalent internal readings on this topic
  keep recurring at the same rate, the problem was distribution/process, not
  the missing surface, and this record's diagnosis was wrong.
- **Falsifier for the audio half**: if, after the disclosure-verdict gate
  ships, an episode still reaches `audio-ready` without both spoken lines
  present, the gate is checking the wrong signal (or checking it in the wrong
  place) and needs to move, not just be re-flagged.

## Explicitly out of scope (named, not dropped)

- **The accountable-reviewer appointment and the outside-counsel question**
  — [#667](https://github.com/refluster/ai-native-article/issues/667),
  explicitly an operator/Zone-A-governance decision per that issue's own
  framing ("運用者だけが決められることです"). This record's reader-experience
  half does not depend on it (per #668's own text); the legal exemption
  framing does.
- **Writing the `/about` page's content** — Elena's owed piece (per her
  2026-08 letter). This record fixes the route, its link-in points, and its
  accessibility floor; the words are hers.
- **The WCAG 1.4.13 keyboard-focus fix on the console's existing `PostCard`
  AI badge** (`feed-ui-v1.md` TODO-H) — a pre-existing, already-specified
  fix, unrelated code path (`workforce/app`), for Aoi.
- **Selecting and integrating an inaudible-watermark method.** The
  requirement is decided (§2 above); the vendor/algorithm is an engineering
  story for a later `issue-implement` pass once this record is accepted.
- **Implementing any of the above.** Per `issue-design`'s own contract
  (adr-0022): this PR is the decision; `issue-implement` (Ren) picks up the
  reader-route + byline-line + Notion-property + gate changes as ordinary
  Zone B work once this record is merged, no further design pass needed.

## Governance consulted

[`AGENTS.md`](../../../AGENTS.md) (Zone B — `newsletter/app/src/{components,pages}/**`
is agent-authored with human review; `DESIGN.md` itself stays Zone A and is
not touched by this PR), [`workforce/docs/governance.md`](../governance.md)
(W-1 editorial integrity under a byline — this record is, structurally, a
W-1 mechanism extended to *readers*, not just to the org's own posts; W-4
fail loud, the reasoning behind the hard synthesis-gate over an advisory one),
[adr-0016](../adr/adr-0016-podcast-production-surface.md) (the `podcast-script`
/ `podcast-publish` split this record's gate placement builds on — Idris's
existing `complianceVerdict` is the pattern being extended, not replaced),
[adr-0022](../adr/adr-0022-issue-to-merge-flow.md) (this record's own
authority: `issue-design` proposes, never implements or merges).
