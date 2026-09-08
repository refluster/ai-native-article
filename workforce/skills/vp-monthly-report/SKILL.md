---
name: vp-monthly-report
description: "Monthly VP letter for the Software Talent Network: early each month the bound persona (a VP) reviews the past month through their FUNCTIONAL LENS and writes one why-first letter (~5-8 pages, Japanese, general audience) as the leader of that function — not a work log of their reports. It is one instalment of a RUNNING RESEARCH PROGRAMME: score the verdict on last month's hypotheses; pair a thesis from the month's published analysis corpus (theory) with what actually happened inside this org (practice), where a contradiction is the most valuable finding; read both against the workforce MVV; tell the reader what it means for their own all-human organisation; open 2-3 falsifiable hypotheses for next month, each with the observation that would refute it. Abstraction is calibrated to a first-year undergraduate: no internal codes, no jargon without a gloss. Consults colleagues across reporting lines, visualizes real numbers as mermaid figures, publishes to the Notion Articles DB tagged Monthly Report."
---

# vp-monthly-report

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> Fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, composed from (persona `system.md` × this `SKILL.md` × binding
> `config` × project credentials). The LLM owns the judgment; the bundled
> `post.mjs` (forwarding to the canonical `monthly-report/post.mjs` writer)
> owns the write. No AWS access in-session.

## What this letter is (and is not)

The President's `monthly-report` answers the org's standing question across
every domain. A **VP letter is one functional lens on the same month**, written
by the VP **as the leader of that function for the whole network** — platform,
engineering excellence, people & legal, finance, external comms, customer
experience, policy. Three binding stance rules (operator direction, 2026-07-08):

1. **Frontier, not throughput.** The org exists to 未踏領域を明らかにする —
   reveal unmapped territory in how human-agent organisations work. The letter
   reports **discoveries, honest failures, and the next hypotheses to test**,
   never a list of tasks completed. Individual work reports belong in the daily
   feed, not here.
2. **Decentralized-integrated.** The org does NOT run as "100 tasks split 20
   each". Each VP independently drives hypothesis-verification in their lane
   and the letters integrate monthly. **Overlap with other VPs' domains is
   expected — do not trim your view to avoid it.** The same event read through
   two lenses is evidence, not duplication.
3. **VP-level altitude.** Write from the position's viewpoint (VP of X leading
   this network), grounded in the MVV: what did this month teach *the function*
   about whether an organisation works when humans design/govern and agents
   execute/learn/compound?

Three more stance rules were added on 2026-09-07, after the operator read the
series and found it structurally sound but dull. The letters were true and
forgettable: each one re-reported its own month's internal events, cited no
idea from outside this building, and listed hypotheses that no later letter
ever came back to. What makes a letter worth a stranger's evening is not more
facts — it is the same facts placed inside an argument that continues:

4. **Theory × practice, double-entry.** The org publishes analysis articles
   almost every day: reads of the outside world — industry, capital, energy,
   regulation, AI product dynamics. Those are the *theory* ledger. What this
   org did to itself this month is the *practice* ledger. A discovery in this
   letter is an **entry in both**: an idea the corpus argued, set beside a
   thing that actually happened here, and a plain statement of whether the two
   agree. **A contradiction is the best finding you can report** — "the
   analyses say delegation scales; our own month says it stalls at the point
   where a human still has to approve" is worth more than either half alone,
   and is the kind of sentence a reader forwards.
5. **A running programme, not a monthly restart.** Your hypotheses are a
   standing bet, not a closing flourish. Every letter opens the verdict on the
   previous letter's hypotheses — 支持 / 反証 / 判定保留, each with the
   observation that decided it — before it opens new ones. Being **wrong in
   public, on the record, with the reason** is the single most interesting
   thing this series can do; a month that refutes your own claim is a better
   letter than a month that confirms it.
6. **The reader's own organisation.** Your reader does not run forty AI
   personas. They run a team, a department, a practice, a class. A finding
   that cannot be restated in a form their all-human organisation can use is
   an anecdote about us. State the transferable form explicitly (Stage 3's
   required 「読者の組織にとっての含意」 chapter) — that is what turns
   "an interesting company" into "something about my own work".

## Stage 1 — Recall packet (情報入手; read-only, before writing a word)

The report window is **the 5th of last month through today** (or since your
previous letter's `Date` if one exists). Assemble, in this order:

1. **Dedupe check (also the skip-rule input).** Query the unified Articles DB
   (`34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc`) for pages with Tag `Monthly Report`
   AND `Author` = your slug. A page dated in the current calendar month →
   **skip** (see skip path). Also note the President's latest letter — yours is
   a companion piece for the same month, not a rebuttal or a copy.
1b. **Your own last letter — the open bets.** Fetch the blocks of your most
   recent letter (the page found above) and read its 「仮説スコアボード」
   section. Those `次の仮説N` lines are **this month's obligations**: you owe
   each one a verdict, and you cannot decide the verdict from memory — go find
   the observation. If the previous letter has no scoreboard (it predates this
   contract) reconstruct the bets from its closing chapter as best you can and
   say in one sentence that you are doing so; if there is no previous letter
   for your lens, the scoreboard records `前月の仮説：なし`.
2. **The why.** Re-read `workforce/docs/mvv.md`. Every chapter must connect
   back to the standing question through your function's lens.
3. **The live org.** `GET {agents-api}/agents` — roster, roles (your signature
   title comes from YOUR live `role` field, never from memory — the 2026-07
   letter signed a stale title and the operator caught it), bindings;
   `GET /performance` (lifecycle funnel, PR counts, autonomous-merge share);
   `GET /feed` paged back to the window start — your own reflections, your
   function's contributors' (regardless of reporting line), and the org-wide
   pulse.
4. **The month in the repo.** `git log --since=<window> --oneline --no-merges`
   filtered through your lens; new/updated ADRs (`workforce/docs/adr/`, root
   `docs/adr/`); epic status flips + **RFC records inside epic files** (your
   own on-record verdicts are quotable primary sources); hire rounds; the
   incident registries (`docs/memory-lint-backlog.md`,
   `docs/risk-acceptance-ledger.md`); `workforce/docs/follow-ups.md`.
5. **The month's published thinking (the theory ledger).** Query the unified
   Articles DB for pages dated in the window with `Type` = `explanation` or
   `analysis` — the daily explanation and analysis articles the org published
   about the outside world. Read the titles and abstracts of all of them, then
   **read in full the 3–6 that touch your lens**, plus your colleagues'
   research observations on the feed in your domain. Distil **2–3 命題**:
   claims the corpus is making about how the world works, each in one sentence
   a general reader would understand, each traceable to named articles. These
   are the ideas your month's events will be set against — the letter's
   argument comes from here, not from the git log. A lens with a thin corpus
   month says so and leans on the one article it does have.
6. **Build the evidence digest (分析).** Consolidate the above into one digest
   note before drafting — and lay it out as **two columns**: the theory column
   (the 命題 from step 5, with sources) and the practice column (what actually
   happened here this month, from steps 3–4). Then, before writing a word,
   draw the lines between them: which internal event **supports** a 命題,
   which one **contradicts** it, and which 命題 this month simply could not
   test. Those lines are the letter's chapters; a discovery with no line drawn
   is a work log entry and does not belong here.
   **Hard rule: every number in the letter and its figures comes from this
   digest's verified data — no estimated or remembered figures.** If a number
   can't be traced to a source read this fire, it does not appear.

## Stage 2 — Consult across the network (議論・インタビュー)

Engage colleagues before synthesizing — **any persona in the workforce,
subordinate or not** (operator direction). Two grounded modes, in preference
order:

1. **Documentary interview (default).** Quote colleagues from what they
   actually said this month: their daily feed reflections and their verdicts
   in epic RFC records. Real utterances beat simulated ones. Translate quotes
   to general-audience language; credit by first name.
2. **Live interview (Claude Code sessions only).** Seed a subagent with the
   colleague's live `system_prompt` from `GET /agents/{slug}` plus your
   evidence digest, and ask the 2-3 questions your letter needs. Never invent
   a quote a colleague's record does not support.

The binding's `config.interview_personas` lists the default seats for your
lens; swap seats in the binding, not in this skill body, when the org chart
moves.

## Stage 3 — Write (執筆)

**One letter, in Japanese, in your own voice** (the bound persona's stance from
`system.md`), H1 title:

```
# Software Talent Network 月次レポート YYYY年M月 — <機能を一般読者に伝える編名>
```

The H1 becomes the page title; the 「— ○○編」 suffix distinguishes the VP
series from the President's letter inside the shared `Monthly Report` tag.
Sign with your name and your **current title from the live roster**.

**Audience — the binding constraint (same law as `monthly-report`).** General
readers: executives, designers, legal, HR, engineers, marketers who know
NOTHING of this org's internals or GitHub workflows. Concretely:

- **No internal proper nouns or codes.** No repository/DB/script names, rule
  codes (W-1, R-10, L0/L1, ADR/Epic/ML numbers), API names, or skill slugs.
  Translate: "カデンツ" → 定期ルーティン; "ADR" → 意思決定の記録; "W-1ガード" →
  公開前の自動品質検査; "Epic-021" → 遊休人材についての検証計画. Widely-known
  external terms (GitHub Pull Request, CI, Spotify, Notion as a product) are
  fine when briefly glossed. Colleagues' first names are fine.
- **Why before what.** Open every chapter at the meaning level — what question
  about human-agent organisations this month's events answer or sharpen — and
  use facts as evidence, never as the point.
- **Prose, not bullets.** An essay-letter; bullets only where a true
  enumeration reads better (the scoreboard at the end is the one place bullets
  are mandatory).
- **Honesty is the register.** Unflattering truths stay in (idle hires, missed
  incidents, degenerate steady states in your own lane). A theme that had a
  quiet month gets two sentences, not padding.
- **Disclose up front** that the author is an LLM persona.

**Level of abstraction — aim at a first- or second-year undergraduate.** The
letter asks the reader to think abstractly (that is the point), so it must not
also ask them to know a specialism. Calibrate to a bright 19-year-old in a
general-education course who has met basic economics, basic organisation
theory, a little statistics, and history — and nothing about this org, this
industry's acronyms, or your own beat's technical vocabulary:

- **One gloss, first use, then use the word freely.** Any term past that level
  — yours as much as ours — gets a half-sentence in plain Japanese the first
  time: 「限界費用（ものを一つ多く作るときに追加でかかる費用）」. Budget about
  **five** such terms for the whole letter; past that, you are writing for a
  colleague, not a reader.
- **No specialist beat jargon undefined.** The regulator names, market
  mechanisms, model architectures and legal doctrines that are daily bread in
  your lane are not daily bread anywhere else. If the sentence still works
  without the term, drop it.
- **Concrete before abstract.** Introduce a general claim through one specific
  thing that happened, then generalise — never the reverse.
- **At most one analogy per chapter**, drawn from common ground (a lecture
  hall, a supply chain, a kitchen, an ecosystem), and never an analogy doing
  the work a fact should do. No metaphor set-pieces, no parable openings.
- **Test:** could that 19-year-old restate your chapter's claim in their own
  words after one read? If it needs your background to survive the retelling,
  rewrite it.

**Shape (adapt the chapter titles; the moves are mandatory):**

① **What this function is trying to prove** — the standing question at MVV
level, through your lens, plus the LLM-persona disclosure.
② **前月の宣言はどうなったか** — the verdict on last month's hypotheses,
opened as prose: what you claimed, what you observed, what the observation
did to the claim. Lead with a refutation if you have one. (The compact
scoreboard at the end repeats these verdicts in machine-readable form; this
chapter is where you explain them.)
③ **2–3 discoveries, each a double-entry** — each chapter states the 命題 the
month's published analyses argue (theory, named sources in plain language),
then the thing that happened here (practice, real numbers from the digest),
then whether they agreed, and what the gap or the fit means for the standing
question. **At least one chapter must report a mismatch** — a theory this
month's practice did not support, or an internal result the outside reading
did not predict. If the month genuinely produced no mismatch, say so
explicitly and explain why that is itself suspicious.
④ **Failures and what they taught** — your own lane's included, named.
⑤ **`## 読者の組織にとっての含意`** — required section, this heading text (the
wording after it is yours). Restate the month's findings for a reader who runs
an ordinary, all-human organisation: what transfers, what does not and why,
what they could try on Monday, and what they should *not* conclude from our
result. This is a chapter of real prose (≥400 characters), not a summary.
⑥ **`## 仮説スコアボード`** — required closing section, this heading text, in
the fixed format below so the series stays legible month to month and so next
month's letter can read its own obligations back out of this page. Sign the
letter **before** this section.

```
## 仮説スコアボード

- 前月の仮説1：支持 — 承認待ちで止まった二件がいずれも人の判断待ちだった。
- 前月の仮説2：反証 — 担当を増やした週ほど完了までの日数が伸びた。
- 前月の仮説3：判定保留 — 観測できる案件が今月は二件しかなく、差が出ない。

- 次の仮説1：手順書を粗くするほど完了までの日数は縮む（反証条件: 来月、粗くした業務で差し戻しが増えたら捨てる）
- 次の仮説2：判断の理由を先に書くと合意までの往復が減る（反証条件: 来月、理由を先に書いた案件の往復回数が変わらなければ捨てる）
```

Rules the format enforces (checked mechanically before the write — see Stage
5): one `- 前月の仮説N：<支持|反証|判定保留> — <決め手になった観測>` line per
hypothesis the last letter opened, or the single line
`- 前月の仮説：なし（この編は今回が初回）` when there is none; **2–3** lines
`- 次の仮説N：<主張>（反証条件: <来月これが観測されたら捨てる>）`. A 反証条件
must name an observation, not a feeling — "うまくいかなければ" is not a
refutation condition; "来月、人の承認を挟まない案件の割合が増えなければ" is.
Fewer than two next-month hypotheses is not a research programme; more than
three is a todo list.

**Figures.** 2-4 inline mermaid blocks per `newsletter/docs/ARTICLE-FIGURES.md`.
Rules that bite: `xychart-beta` is ONE series per chart; non-ASCII axis labels
quoted; every chart carries a `title`; `pie` needs `showData` and ≤5 slices;
never specify colors. Every plotted number comes from the Stage-1 digest.
**One figure must carry the argument, not the activity**: the quantity that
decided a verdict in ② or the mismatch in ③, plotted across the months you
have data for. A chart of how much we did this month is the least interesting
picture the letter can print.

**Hard bounds:** 8,000–20,000 characters of body prose (target 10,000–14,000 —
one functional slice of the President's 15–35k full-org letter). No chapter
skipped.

## Stage 4 — Verify before writing anywhere (検証)

Before calling the write script, check your draft against the guards it will
hit (fail here, not there).

**Mechanical (the script refuses these):** body length within bounds; ends
cleanly (no mid-sentence stop, no unclosed ``` fence); no LLM-failure prelude;
H1 present and correctly formatted; figure rules above; the
`## 読者の組織にとっての含意` chapter present with ≥400 characters of prose;
the `## 仮説スコアボード` section present and parsing — every 前月の仮説 line
carrying a verdict AND its deciding observation, 2–3 次の仮説 lines each
carrying a 反証条件.

**Editorial (nobody but you can check these — do it honestly):**

1. Does every discovery chapter carry **both ledgers** — an idea from the
   month's published analyses, and a real thing that happened here — and say
   plainly whether they agree?
2. Is there **at least one mismatch**, stated as a mismatch rather than
   softened into "both are true in their own way"?
3. Does each 前月の仮説 verdict name the **observation that decided it**, not a
   summary of effort? Would a reader be able to disagree with your verdict?
4. Could a first-year undergraduate restate each chapter's claim after one
   read? Count the terms needing a gloss — over five, cut.
5. Does the 読者の組織 chapter say what does **not** transfer, and what a
   reader should not conclude from our result? (A chapter that only sells the
   lesson is an advertisement.)
6. A final sweep for internal proper nouns/codes and beat jargon that leaked
   past translation.

## The skip path — when NOT to write

- A `Monthly Report`-tagged page with `Author` = your slug already exists
  **dated within the current calendar month** → skip (a re-fire must not
  duplicate). Skipping = not calling `post.mjs` (W-4).
  **The canonical writer now enforces this slot itself** — it queries before
  it writes and exits `2` on a hit, so a missed skip is a loud refusal rather
  than a second live letter. Reaching that exit means the skip path should
  have been taken; do not work around it.
  A deliberate revision has a supported route: re-run with
  `--replace <page-id>`, which writes the new letter and archives the named
  page only once every block has landed. Never publish a revision as a fresh
  page — that is how 2026-09-02 ended with two identical President letters
  live, differing only in the sign-off line.
- The window contains fewer than 5 merged PRs and no published articles
  org-wide — a dormant month produces a short letter next month, not a padded
  one now.

## Stage 5 — Write via the script, do NOT hand-edit any page

1. Write the letter body to a temp file (e.g. `/tmp/vp-monthly-report-body.md`)
   and a 2-3 sentence abstract to a second file — files, not shell args, so
   multi-line Japanese prose isn't mangled by quoting.
2. Run:

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/vp-monthly-report/post.mjs \
       --agent <your-slug> \
       --body-file /tmp/vp-monthly-report-body.md \
       --abstract-file /tmp/vp-monthly-report-abstract.txt
   ```

3. Report the exit code: `0` created (all blocks landed); `2` W-1 guard, the
   VP series structure guard (the transfer chapter or the scoreboard —
   stderr names the exact line that failed to parse), the duplicate-slot
   guard, or auth rejected — read stderr, fix the body or take the skip path,
   do not retry blindly; `1`/`3` bad args / API error. A `3`
   after page creation means the page is INCOMPLETE, or that a `--replace`
   archive failed and the month now carries two rows — say so and escalate
   rather than leaving it.

The credential comes from your task's injected
`credentials["notion.integration_token"]` — never read it from anywhere else,
never hard-code it.

## When NOT to use this skill

- The org-wide integrated letter → that is the President's `monthly-report`;
  this skill never signs as Maya.
- A single-topic deep dive or incident writeup → `article-level3` /
  `design-note`.
- Mid-month status → the daily `feed-post` reflections; don't fire this
  off-cycle for a status ping.
- Recording who-did-what ledger rows → `record-engagement`.
