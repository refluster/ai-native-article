# Runbook — Chat notification policy (Discord)

**Layer:** L3 operational (this doc is a runbook per
[governance.md §1](../governance.md#1-scope-and-inheritance); agents may
freely edit it — it does not gate anything on its own, R-N4/R-N5 do).

**Scope:** Every automated Discord post from a workforce Cadence
(`discord.webhook_url` / `discord.bot_token`). Written to close the gap
[docs/governance-mechanisms.md](../../../docs/governance-mechanisms.md) notes
as *not yet adopted*: this repo had no standing rule for when an automation
may post to chat, or what that post has to carry.

## 1. Why this exists

A chat post is an **attention-getting layer**, not a **record-of-truth
layer**. Discord/Slack/Teams-style channels scroll, get muted, and carry no
enforced follow-up — posting to one and treating that as "handled" is
*assignment theater*: it looks like accountability was established, but
nobody is actually on the hook, there's no deadline, and there's no
mechanical close condition. This policy exists so a workforce Cadence cannot
substitute a chat ping for the real thing.

## 2. The rule

**A chat notification about a problem MUST link to a persistent record that
carries an owner, and MUST NOT be the sole place that record exists.**

Concretely, before a Cadence posts to Discord about anything that needs
follow-up:

1. The persistent record already exists or was just created/updated — today
   that means a GitHub Issue (this repo's durable, owner-labelled ledger; see
   [docs/issue-labeling.md](../../../docs/issue-labeling.md)'s `owner:` axis).
2. The record carries: **who** is accountable (an `owner:<slug>` label
   naming a real person or workforce persona — never an unowned label like
   `bug` alone), **what** was observed, and a **close condition** stated in
   the record body (not left implicit).
3. The chat post **links** to the record rather than restating its full
   content — the message is a pointer, the Issue is the truth.

A Cadence that only posts to chat, with no Issue/record backing it, is not
compliant with this policy — see `ops-accountability-watch` for the
reference implementation.

## 3. One aggregate notification per fire, not one per finding

A scheduled sweep that finds N problems and sends N chat messages trains
everyone to ignore the channel by the third fire. Every scheduled Cadence
that can find more than one thing per run **MUST** aggregate: one message,
covering every finding from that fire, each as a one-line pointer to its
Issue. The message still has to be capable of saying "nothing today" — see
§4 — never silently skip a clean fire without saying so.

## 4. Two attention classes, every notification picks exactly one

| Class | When | What it must say |
|---|---|---|
| **Awareness Only** | Nothing from this fire needs a human. | State what was swept and that nothing needs a human — an *empty* body is never acceptable (silence must not be ambiguous with "did this even run?"). |
| **Repair Required** | >= 1 finding this fire. | One line per finding: the owner, a short label, and the Issue link. Never the full finding detail — that's what the Issue is for. |

The two classes should be visually distinct (colour, or an equivalent
at-a-glance marker) so a human skimming a channel history can tell which
fires needed attention without opening every message.

## 5. Observation mode — the introduction-period exception

A brand-new scheduled Cadence that goes silent-when-clean from its very first
fire is indistinguishable, to a human watching the channel, from a Cadence
that's silently broken. Every **newly introduced** monitoring Cadence
therefore launches in **observation mode**:

- Every fire posts — Awareness Only included — so the first several weeks
  prove the pipeline itself is alive, not just that it hasn't found anything.
- The **exit condition** is a named, mechanical count, stated in the
  Cadence's own SKILL.md and its binding `config`: by default, **four
  consecutive clean weekly windows** (i.e. the fire that lands on each of
  four consecutive Mondays is Awareness Only). A Cadence may state a
  different count if its own fire cadence warrants it, but it MUST state one
  — "until it feels stable" is not a condition.
- Exiting observation mode (narrowing to Repair-Required-only going forward)
  is an explicit `config.mode: "steady"` change to the binding — the same
  posture [governance.md §5](../governance.md#5-action-authority--autonomous-vs-escalate)
  already uses for enabling a paused cron (a schedule/behaviour change the
  operator applies, not something a Cadence flips on itself mid-run).

## 6. What every automated post carries, regardless of class

- The Cadence name (so a reader can find its SKILL.md).
- A machine-parseable date.
- For Repair Required: the owner and the Issue link per finding, per §2/§3.
- No LLM-failure artefacts, no empty body — the existing W-1 guard
  convention (reject `"as an ai"`, `"i apologize"`, etc. in the first ~50
  characters) applies here exactly as it does to `feed-post`/`attention-ledger`.

## 7. Adding a new automated chat notification

Before wiring any new Cadence to `discord.webhook_url`/`discord.bot_token`:

1. Confirm it satisfies §2 (a real, owned, persistent record backs every
   notification about a problem).
2. Confirm it aggregates per §3, unless it is structurally single-finding.
3. If it's newly introduced monitoring, confirm it declares an explicit
   observation-mode exit condition per §5.
4. Cite this doc in the PR description.

## Cross-references

- [`ops-accountability-watch` SKILL.md](../../skills/ops-accountability-watch/SKILL.md) — the reference implementation.
- [`docs/issue-labeling.md`](../../../docs/issue-labeling.md) — the `owner:` label axis this policy assumes.
- [`docs/governance-mechanisms.md`](../../../docs/governance-mechanisms.md) — the registries/loops this policy complements (memory-lint-backlog, risk-acceptance-ledger, content-insights).
- [`workforce/docs/hires/vp-operations-hire-round.md`](../hires/vp-operations-hire-round.md) — why this policy and its first Cadence were introduced together.
