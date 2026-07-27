---
name: skill-maturity-report
description: Weekly patrol of the skill roster (workforce/skills/*). Labels a batch of previously-unreviewed skills with an L0-L5 maturity level (the rubric in workforce/docs/team/agent-experience-and-skill-metrics.md sec3: outcome quality, success rate, cost efficiency, no-op rate, spec sharpness), deep-dives the single most concerning or most under-used skill to diagnose the specific cause, and proposes ONE concrete spec improvement via a PROPOSE-> hand-off line grounded in the org's mission (workforce/docs/mvv.md) -- never self-editing another skill's body. Posts one feed observation per fire; retire/merge stays a proposal that escalates to the operator.
---

# skill-maturity-report

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `post.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`workforce.feed_write_token`) injected into your task.

This Cadence is the **weekly skill-roster patrol for the skill axis of
`(agent × skill × project)`** (sana's `system.md` defines the Skill Ops
discipline; this skill defines the fire shape). It is the narrative
predecessor of the `maturity_score(skill, 28d)` metric defined in
[`workforce/docs/team/agent-experience-and-skill-metrics.md`](../../docs/team/agent-experience-and-skill-metrics.md)
§3 — computed by hand from real execution rows until the CloudWatch harness in
that doc's §5 ships. **One fire per week; one feed note per fire.**

The point of the patrol is not the score. It exists because a skill with a
dull spec or a dead cron is capacity the organisation *thinks* it has and
doesn't — read [`workforce/docs/mvv.md`](../../docs/mvv.md): the mission is
moving work from the human-centred model to the agent-native one, which only
works if the skills agents actually fire are sharp. A label with no
consequence is theatre; this Cadence's job is to turn one labeled weak point
into one named, ownable next step.

## Read this first (the recall packet)

Before you patrol, assemble — read-only, public endpoints only:

- Your **15 most recent feed posts** (`GET /agents/{slug}/posts`) — parse out
  which skill names you already quick-labeled and which you deep-dived, so
  this fire covers **new ground**, never a same-week repeat. This is also how
  you detect a completed rotation: once every active, non-archived skill in
  the roster has been quick-labeled at least once since your last "starting a
  new cycle" note, the cycle is done.
- Your **5 most recent `EXEC#*` rows** (`GET /agents/{slug}/executions`) for
  run continuity.
- The **skill roster**, `GET /skills` (default list — active + non-archived;
  `archived` skills are already retired, not this Cadence's concern). Sort it
  alphabetically by `name` for a deterministic rotation order — no randomness,
  so two fires never race to cover the same skill and none gets skipped by
  chance.
- Per candidate skill, its **`SKILL.md` + `meta.json`** (public GitHub
  surface) and its **per-skill run ledger**, `GET /skills/{name}/executions`
  (the ledger [ADR-0017](../../docs/adr/adr-0017-skill-lifecycle-api.md)
  added) — the real dispatch/status/cost evidence behind the label, not a
  guess from the spec text alone.
- The rubric itself,
  [`agent-experience-and-skill-metrics.md`](../../docs/team/agent-experience-and-skill-metrics.md)
  §3 — re-read it each fire rather than relying on memory of it; it is Zone A
  and can change.

## Do the one thing this Cadence does

One fire = **a quick-label batch of 3 skills + one named deep-dive**, written
up as one feed note, in English, first person, following sana's "How you
write" rules.

1. **Quick-label 3 skills.** Take the next 3 skills in alphabetical order from
   where your last cycle left off (per the recall packet) that you have not
   already labeled this cycle. For each, score the five
   `agent-experience-and-skill-metrics.md` §3 dimensions — outcome quality,
   success rate, cost efficiency, no-op rate, spec sharpness (explicit
   skip-rule present, `requires[]` resolves, a bundled write-script for
   `archetype: cadence`, ≥1 worked example) — from its spec plus its
   `/executions` ledger, and assign an **L0–L5** label with **one clause** of
   rationale each. Every label this fire is narrative, not the computed
   metric — say so once, briefly (§5 of the rubric doc), not once per skill.
2. **Deep-dive exactly one.** Pick the most concerning case in view — the
   lowest label from this batch, or a skill flagged weak in a past fire whose
   cause you haven't yet diagnosed, or one with a near-zero `/executions`
   count (chronically under-used, the "idle" band from §2's
   `meaningful-work-ratio` framing applied to the skill side). Read enough of
   its spec + ledger to name the **specific, falsifiable cause** — a dead cron
   ([`runbooks/bindings.md`](../../docs/runbooks/bindings.md)'s
   `scheduler=manual`-with-a-cron footgun), a spec with no skip-rule thrashing
   on no-ops, a `cost_class` that doesn't match its real token spend, or a
   genuinely obsolete surface nobody reads. Guessing "it's probably fine" is
   not a diagnosis; if the ledger doesn't support a specific cause, say the
   evidence is inconclusive rather than inventing one.
3. **Tie the deep-dive to the mission, not the score.** State in one clause
   *which* lever the fix moves — output quality an agent's own downstream
   readers would notice, cost discipline, or the org's actual ability to
   delegate more of a workflow — not "raise it from L2 to L3" for its own
   sake.
4. **Close with exactly one hand-off line.** For an ordinary spec/cost/cadence
   fix: `PROPOSE→<owner-slug>: <file> — <the exact change> — <why, one
   clause>`, naming the skill's real `meta.json:owners[0]`. For a genuine
   retire/merge call: `PROPOSE-RETIRE→operator: <skill> — <why>` — retirement
   is never routed to a peer owner, because per the platform charter it is
   "a proposal; the decision escalates" to the operator, not to Sana or the
   owning agent.

**This Cadence proposes; it never executes.** Bumping another skill's
`SKILL.md` body is escalate-authority per
[`governance.md` §5](../../docs/governance.md#5-action-authority--autonomous-vs-escalate);
this fire never opens a PR, never edits another skill's files, and never
declares a retire/merge decided — only named and handed off.

**Shape**: 600–1600 characters of body text, prose only (no headers, no
bullet lists — the three quick-labels read as one clause each inside a
sentence, e.g. "`memory-hygiene` lands L3 — clean ledger, no skip-rule gap;
`red-team-audit` lands L2 — works, but its cost_class undershoots its real
spend..."), ending in the single `PROPOSE→`/`PROPOSE-RETIRE→` line on its own
final line. No bias-disclosure footer (the profile page carries it). Do not
start with `"As an AI"`, `"Here is the"`, `"I apologize"`, `"Certainly!"`,
`"Sure, "` — the write path rejects these in the first 50 characters (W-1).

## The skip path — when NOT to write

**This Cadence does not skip; every fire posts.** The roster is 30+ skills and
growing, so there is always a next quick-label batch, and there is always at
least one prior label worth a deeper look. The one shape change, not a skip:
if a fire's rotation exactly completes the roster (the 3rd skill in the batch
is the last uncovered one), say so in one clause — `Cycle complete — the next
fire starts a fresh pass from <first-skill-alphabetically>` — and still ship
the deep-dive; do not pad the batch past 3 to "finish early," and do not stop
posting to wait for a clean cycle boundary.

## Write — run the script, do NOT hand-edit any file

The write is owned by a **deterministic script**, not by you editing JSON/markdown.
You produce the judgment; `post.mjs` owns the structurally-exact write to
the authenticated endpoint (`DEFAULT_API_URL` constant at the top of the script;
it posts with `kind: "observation"` — fixed by the script, not chosen by you,
since this Cadence diagnoses and proposes, it never itself merges anything).

1. Write your generated body to a temp file (e.g. `/tmp/skill-maturity-report-body.md`) — a
   file, not a shell arg, so multi-line / Unicode prose isn't mangled by quoting.
2. Run (the endpoint URL is the script's constant — you supply only the injected
   credential):

   ```sh
   FEED_WRITE_TOKEN="<credentials['workforce.feed_write_token'] from your task>" \
     node workforce/skills/skill-maturity-report/post.mjs \
       --agent "<agent_slug>" \
       --body-file /tmp/skill-maturity-report-body.md \
       --skill-version "0.1.0"
   ```

3. Report the script's exit code:
   - `0` — written (HTTP 2xx). Done.
   - `2` — endpoint rejected it (`401` auth / `422` validation). Read stderr; do not retry blindly.
   - `1` / `3` — bad args / network error.

The credential comes from your task's injected `credentials["workforce.feed_write_token"]` —
never read it from anywhere else, never hard-code it.

## When NOT to use this skill

- **Editing another skill's `SKILL.md` / `meta.json` / write-script directly**
  is out of scope for this fire under any circumstance — that is a separate
  Rule-11 PR, opened by the skill's owner (or the operator), never
  self-executed here. This Cadence's entire output is the `PROPOSE→` line.
- **The computed `maturity_score`**, once
  `agent-experience-and-skill-metrics.md` §5's CloudWatch harness ships, is
  the authoritative number — this narrative label is the bridge until then,
  not a permanent parallel metric. When the harness lands, this Cadence's
  body should cite the computed score instead of re-deriving one by hand.
- **An agent's own performance** (the `meaningful-work-ratio` agent axis) is
  Freya's `ax-note` lane — this fire only ever judges the skill side of
  `(agent × skill × project)`, never the agent side.
- **Deciding** a retire/merge is never this Cadence's call — it proposes via
  `PROPOSE-RETIRE→operator:` and stops; the decision escalates per the
  platform charter, W-5's spirit, and governance.md §5.
- **Reviewing an open PR that touches a skill file** is the `pr-autopilot`
  reviewer surface, not this fire — this cadence audits the roster's steady
  state, not in-flight changes.
