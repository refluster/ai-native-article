---
title: "Moving Review to Machines to Protect Human Time: How the Claude Code Team Designs Code Review"
lang: "en"
type: "explanation"
category: "Verification & Trust"
date: "2026-10-21"
abstract: "On a team where Claude writes about 90 percent of the code, the Claude Code group did not remove review; it moved most of the reading to machines and reserved human time and attention for the judgments only people can make. From June to September, merged pull requests more than doubled while the share reverted fell by more than 40 percent. The design starts from a different question: not whether a human read the code, but what could go wrong and which check is the right one to catch it."
notionId: "400d0f0b-e61e-81f9-957f-fddb68b8fde1"
sourceUrls: "https://claude.dev/blog/solving-code-review-at-anthropic/"
author: "ingrid"
---

## Executive Summary

On a team where Claude writes about 90 percent of the code, the Claude Code group did not remove review. It moved most of the reading to machines and reserved human time and attention for the judgments only people can make. From June to September, merged pull requests more than doubled while the share that had to be reverted fell by more than 40 percent. The design starts from a different question: not "did a human read the code?" but "what could go wrong with this change, and which check, automated or human, is the right one to catch it?"

## Rethinking the Purpose of Code Review

According to the source post (Addy Osmani, Morgan Westlee Lunt and Qing Wang, published 15 October 2026), agents writing code make the number of changes rise fast. In Anthropic's monorepo, changes landing per day went from about 2,500 in May to more than 30,000 in September. Claude Code lives in a separate repository but sees similar pressure. At this speed, the authors say, manual line-by-line review is "incredibly difficult if not impossible."

Code review does two jobs:

- Find and fix issues before they ship
- Build shared context and codebase understanding across the team
The post focuses on the first and returns to the second near the end. The authors treat "did a human read the code?" as an imprecise proxy for the real question above. That also changed when review happens. It used to be a gate at the end of the road; now it runs continuously, like spellcheck while you write, and most changes have been reviewed and fixed by Claude at least once before a human is asked to look.

## The Scarce Resource Is Human Time and Attention

The goal is that most pull requests in the Claude Code repositories (the CLI, the desktop and web apps, and the mobile apps) merge with at most one human in the loop, who can be the author, with no increase in reverts or incidents. Human time is measured by human approvals per PR (median and 95th percentile), human comments, and how long a PR waits on a person. Human time covers both the time spent reviewing and the time spent fixing what bad code breaks, so revert and incident rates serve as the guardrail: if they rise, time has been moved, not saved.

## The Life of a Change: Layers, Not One Gate

The post describes the path of a change as automated layers, a risk-scaled human decision, and recovery.

1. **Verified before a PR exists.** Claude runs the tests, build and linter and shows the output rather than saying it is done; a second agent reviews the diff in a fresh context. Boris Cherny, who created Claude Code, has called giving Claude a way to verify its work probably the most important thing for good results, estimating that it makes the final result two to three times better. When the automated reviewer keeps flagging the same thing, the team fixes it at the source: in a skill, a lint rule, or instructional files. REVIEW.md, written by code owners, says what failure looks like in that part of the repo (for docs, "it lies"; for config, "it misroutes"), caps nits, lists paths to skip, and asks for a file and line as evidence instead of a guess. 2. **AI review on every PR.** Every pull request gets a Claude review before a person looks, reading the diff against the whole repo and the PR's stated intent. When the research preview launched, the share of internal PRs getting substantive review comments went from 16% to 54%. Several agents hunt for bugs in parallel, then a separate group votes on each finding, and it is posted only if enough agree it is real. Findings about style, diagnostics or cleanup are dropped, a filter the team A/B tested on its own PRs. Survivors are tagged Important, Nit or Pre-existing and sorted by severity, and every finding must be fixed or resolved with a reason. 3. **Security review that can block.** A PR cannot merge while any finding from the bug review or security review is open; a later commit that fixes the issue clears the finding automatically. 4. **Automated checks that block.** Lint, type checks, tests on every platform, and a build. The PR template asks how the change was tested and how to undo it; Claude can fill it in, but the person who asked for the change signs off. 5. **Human approval, scaled by risk.** Low risk (docs, copy, internal-only features, additive changes behind a flag) needs no human approval once automat

## Principles Behind Approval

The change sets the tier, not the author. A classifier reads the change and picks the risk tier; a second classifier asks whether this particular change needs another person even when its tier says it does not. Anything owners have listed as sensitive and any CI workflow file always needs a person. Only authors on the repo's trusted list, mostly the team that owns it, get the lighter paths; everyone else needs a second person. An agent's approval never counts as a person's, so automated review can clear a low-risk change but cannot fill a slot that calls for a human. On an agent-written PR, the person directing the agent counts as one of the required reviewers. An approval covers one specific commit, and if new commits land that the system cannot vouch for, such as an agent's push or a hand-resolved merge, it must be given again.

The last layers are the merge queue, flags and gradual release, then fast detection and rollback. The merge queue re-runs every check against main with the change applied, so two PRs that pass separately cannot combine into a broken main. New behavior usually ships behind a flag to Anthropic employees first, and public releases go to the latest channel before stable. Flags turn off without a deploy, Claude Code has a weekly on-call rotation, and incident reviews ask which layer should have caught the issue. The authors concede that noticing a bad merge still depends on the author and on-call as well as the revert and incident dashboards. There are not yet circuit breakers that tighten approval when those numbers move, and engineers want them before more code moves to zero-human merges.

## Improving the Reviewer, and Making Review Converge

The review process improves in a loop, and incidents are now an eval. The team collected past PRs that caused incidents, with their fix-forwards and reverts, had engineers who know the code confirm each bug and where it lived, and runs the reviewer against that set daily. Every change to the reviewer's prompts, tools or model is scored against all the cases; if the score goes up it is kept, if not it is dropped.

Noise is measured by what people do with the comments: they fixed it, said it was wrong, said the behavior was intentional, or decided it did not matter. The team also runs the reviewer on PRs known to be clean and counts how often it reports something that would have led someone to make a harmful change. The written priority is catching real bugs first and cutting review rounds second. Noise costs more when the author is an agent: a person waves off a nit in seconds, while an agent fixes it, which means another commit and another round.

Review also has to converge. One CLI PR went through more than fifty rounds of review and fixes overnight before its author stopped it. When the team ran git blame on what the reviewer kept flagging, about 59% of it was code that had been there since the reviewer's first pass: the reviewer was finding a few more old bugs each round, not new ones. The team changed re-review with a round cap (after three rounds the reviewer asks the author to step back and reconsider the approach), diff-only re-review after the first few passes, flagging the class of bug so the author fixes every instance, and no repeats of findings already posted.

Before and after the convergence work, internal pull requests changed as follows:

- Pass after one review and fix round: 65% → 78%
- Need five or more rounds: 8.9% → 1.5%
- Mean reviews to pass: 2.08 → 1.32
## Where Humans Stay, and How Context Is Shared

People remain responsible for deciding whether to build something (direction, taste and scope), reviewing risky code such as billing, the auto-updater and CI workflows, reviewing architecture that sets a pattern others will copy, reading the evidence (test output, the command that ran and what it returned, a screenshot, the reviewer's findings), and owning the outcome. If you cannot say what the checks would miss, the post says to ask for a real review rather than a quick approval.

For review's second job, spreading understanding, the team has no formal process. Nobody keeps a complete mental model of Claude Code, and the authors do not think anyone needs to. To understand a part of the codebase, people ask Claude to write an explainer for exactly that slice, which takes minutes and reflects the code as it is today. A one-line copy change teaches almost nothing; an explainer for the module you are about to change teaches a lot.

A team norm is "you land it, you own it": if a small or medium change goes wrong, the person who landed it usually fixes it. Changes are small, everything is reversible, blast radius sets the bar, and regressions surface fast through telemetry and internal use. It is not blame; the person has the most context, and incident reviews look at the system. Because agents make starting cheap, some work should not land, and the advice is to raise a different direction in the thread early, not as a blocking comment on a finished PR.

## Conclusion: Implications for Adoption

The adoption steps the authors list include: give the agent runnable checks in a short CLAUDE.md plus hooks for formatters and linters; run /code-review and /security-review locally; add a REVIEW.md and move repeated review comments into it; require CI and add "Testing", "Risk" and "How to revert" to the PR template; require every review thread resolved before merge; cap review rounds; set risk tiers from the change rather than the author; dismiss approvals on new commits; use a merge queue, flags, staged releases and one-step rollback; and turn incidents and reverts into an eval set. The measure is human time, with revert and incident rates as the guardrail.

For anyone designing review where agents open pull requests, the implication is that more checking and more protected human time can go together, but only with a mechanism for convergence and a loop that turns failures back into checks. The goal has not changed: less human time per change, and no more reverts than before.