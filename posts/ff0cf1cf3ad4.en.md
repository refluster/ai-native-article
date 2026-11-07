---
title: "78% Adoption, 80% No Impact: Why \"Using AI\" Is the Wrong Metric"
lang: "en"
type: "explanation"
category: "AI Productivity"
date: "2026-08-10"
abstract: "\"AI Adoption is a Myth,\" a viral X essay by Varick Agents CEO vas, argues that enterprise AI adoption metrics hide a \"barbell\" distribution: McKinsey finds 78% of organizations use AI while over 80% report no significant EBIT impact, and MIT NANDA's GenAI Divide report finds 95% of integrated pilots show no measurable value. Citing a $10M rollout where 10% of employees burned 90% of tokens and a side-by-side of two engineers given the same ticket, vas argues organizations should stop reporting \"adoption\" and instead report what share of work is manual, hybrid, or fully automated."
notionId: "3b8d0f0b-e61e-81b1-8452-ff0cf1cf3ad4"
sourceUrls: "https://x.com/vasuman/status/2085806422072418632?s=12"
author: "ingrid"
---

## Executive Summary

A viral X (formerly Twitter) essay titled "AI Adoption is a Myth," posted by Varick Agents CEO vas (@vasuman), argues that enterprise AI "adoption" numbers are structurally meaningless because they collapse a skill spectrum into a yes/no question. Citing McKinsey's finding that 78% of organizations use AI in at least one business function while more than 80% of those same organizations report no significant EBIT impact, and MIT NANDA's "GenAI Divide" report showing only 5% of integrated AI pilots produce over $1M in value against 95% with nothing to show for it, the post argues real usage follows a "barbell" — a small power-user minority and a large group that barely engages — that adoption dashboards cannot see.

## "Rolled Out" and "Used Well" Are Different Things

vas recounts a conversation with the leader of a several-thousand-person, non-technical operations organization. After rolling out Claude Cowork company-wide, the leader asked vas why his team's pace hadn't changed at all. vas says the same pattern recurs at every organization he has worked with, regardless of size:

- 5–10% become "power users" — using Cowork daily, building and reusing skill files, wiring in connectors to tools like Outlook
- Of the remaining 90%, 20% use it a few times a day, but poorly
- The remaining 70% don't use it at all
"The dashboards in his org would indicate that the rollout counts as adoption," vas writes. "But to him, nothing got faster. Both of these were true simultaneously."

## The Numbers: McKinsey's 78% and MIT NANDA's GenAI Divide

The post grounds this observation in two external data points:

- McKinsey: 78% of organizations report using AI in at least one business function
- The same survey: over 80% of those organizations report no significant EBIT impact
- MIT NANDA's "GenAI Divide" report: only 5% of integrated AI pilots produced value exceeding $1M, while the other 95% "have nothing to show for it"
vas's conclusion: adoption metrics amount to little more than an abstracted yes/no question — "did this person log in this month?" A single label of "adopted" cannot distinguish someone who pastes emails in for reformatting from someone running three agents in production that touch the general ledger, which is precisely why it fails as a measurement system.

## The Token-Spend Paradox Behind a $10M Rollout

vas describes a second case: an enterprise (several thousand employees) committed to spend at least $10M over the year on enterprise licenses. The observed result was a familiar skew — roughly 10% of people burned 90% of the tokens.

From this, vas draws a deliberately counterintuitive conclusion: "if your entire org WAS great with AI, your spend would not be $10M, it would be $100M. All of a sudden your best-case scenario becomes your worst." It's the single line in the post that most sharply illustrates why "adoption rate" fails as a board-level metric in the first place.

## Two Engineers, One Ticket — and the Proposed Fix

vas illustrates the skill gap directly with a comparison of two engineers handed the same Jira ticket:

- Engineer one pastes the ticket text straight into Claude and hits submit. The resulting fix touches six files; tests pass, so they skim it and merge. Three weeks later, production breaks — the root cause turns out to be a config value the PR changed for no reason.
- Engineer two starts the same way, but first flags which parts of the repo to touch and which to leave alone, relies on pre-built skill files that keep every Claude-authored PR minimal and adequately tested, reads the resulting diff, catches and fixes a stray change, and merges a PR half the size of the first engineer's.
The gap isn't prompting technique, vas argues — it's knowing "which 15% of the automation project requires a model for judgment vs. which 85% just requires deterministic code."

vas proposes a two-track fix. For the power-user minority: give them somewhere to publish their skill files — a shared, ranked database — so status becomes the incentive to trade personal edge for organizational asset. For everyone else: don't ask them to change how they work. Instead, push AI into the background of the systems of record they already use (Salesforce, NetSuite, Dynamics), with humans stepping in only for a second glance — the example given is accounts-payable analysts who move from processing invoices manually to approving, rejecting, or editing what an always-running agent has already done.

## Why Prompt Training Alone Won't Close the Gap

The post singles out a common corporate response — "teach employees how to prompt" — and calls it only 10% of the solution. The other 90%, vas argues, is training people "to understand which workflows should never touch a model vs. which workflows should be entirely automated," an answer that differs at every company and is therefore much harder to sell as an off-the-shelf training program — which vas says is exactly why most organizations never attempt it.

vas also points to a perverse incentive inside the power-user group itself: they already do the work of several people, or finish it 70% faster and coast on the difference. If everyone reached that level, their edge would disappear — so the gap will not close on its own. vas's closing recommendation is blunt: stop reporting "adoption" to the board. Report instead what share of the work is manual, hybrid, or fully automated.