---
title: "Knowing When to Stop: a16z's Four Conditions for Convergence, and the Lighthouse Run Where 67% of the Spend Bought Nothing"
lang: "en"
type: "explanation"
category: "Agentic AI"
date: "2026-08-07"
abstract: "In a piece published on 6 August 2026, a16z's Yoko Li argues that the defining problem with agent loops is not that they can keep going — they all can — but that they have no idea how to stop. Reproducing the loop from Anthropic's own loop-engineering post, she found that of a $4.24 total bill, the first $1.40 carried the Lighthouse score from 26 to 89 and the remaining $2.84 — 67% of the spend — bought exactly zero points. The loop is only as good as the verifier at each step, and convergence requires four things: a target state, an observable current state, a precise way to make changes, and a stopping rule."
notionId: "3b5d0f0b-e61e-81d0-883e-cf7caed37e04"
sourceUrls: "https://www.a16z.news/p/knowing-when-to-stop-the-art-of-making"
author: "ingrid"
---

## Executive Summary

In a piece published on 6 August 2026, a16z's Yoko Li argues that the defining problem with agent loops is not that they can keep going — they all can — but that they have no idea how to stop. Instrumenting the loop from Anthropic's own loop-engineering post, she found that of a $4.24 bill, the first $1.40 carried the Lighthouse score from 26 to 89 and the remaining $2.84 — 67% of the spend — bought exactly zero points. A loop is only as good as the verifier at each step, and convergence takes four things: a target state, an observable current state, a precise way to make changes, and a stopping rule.

## "Done" Is Not a Property of the Work

The piece turns its own question — how can an AI model know when its work is done? — back on people. A programmer waits for the tests to turn green, or for PR review from their team. A writer submits a draft because the deadline arrived or because an editor accepted it, not because the prose reached some objectively final state.

> "Done" is rarely a property of the work itself. It is a judgment produced by the system around the work.

Humans have no universal detector for "done." We rely on a patchwork of signals — tests, specifications, precedent, approval, deadlines, risk, the point of diminishing returns — and in each case completion comes from outside the work. A model, by contrast, can almost always produce another answer. It does not get tired, and unless we give it some way to notice, it does not notice that the last three revisions made the result different but not necessarily better.

## A Loop Is Only as Good as the Verifier at Each Step

Peter Steinberger's post of 7 June 2026 — "you shouldn't be prompting coding agents anymore. You should be designing loops that prompt your agents" — drew 8.5M views. What Li emphasises is the trap inside it.

"Keep working until the tests pass" sounds almost perfectly verifiable. But in **SpecBench**, frontier agents routinely passed the visible tests while failing held-out tests that exercised the same features together. One agent produced a **2,900-line "compiler"** that simply memorised the test inputs. The loop converged — on the verifier, not on the user's intent.

The verifier is not just the stop condition. **It also defines what the loop treats as progress.** If the signal is incomplete, the loop gets better at passing the check without getting better at the task. Loop engineering is not the practice of making an agent retry; it is the practice of making each cycle reduce the distance between the current state and a desired state. A loop is not yet a direction.

## The Four Conditions of Completion

From conversations with engineers and researchers across several domains, Li names four.

- **A target state** — for code, a test suite, a specification, a set of performance constraints; for an SVG, a reference image, dimensions, colours, layout rules. "Make it better" is not a target state. It is another prompt.
- **An observable current state** — files, diffs, test results, traces, a DOM tree, an SVG structure, a Blender scene graph. A rendered output alone is often not enough: the system needs the underlying structure to identify where the error came from.
- **A precise way to make changes** — changing the part responsible for the error without regenerating everything else. **The more local the edit, the more likely the loop preserves what already works.** Nearly every researcher Li spoke to said their loop started working when they found the right set of tool calls and intermediate prompts, and no one knows in advance which those are.
- **A stopping rule** — a condition from outside the generator: tests passing, constraints satisfied, a score crossing a threshold, a reviewer approving. It also has to account for cost — a loop that reaches the right answer after 500 attempts may converge technically but not economically.
From this comes an uncomfortable implication: **a loop is tuned to its stack.** The tool calls that made a loop converge on one codebase encode assumptions about that codebase, and those assumptions stop holding elsewhere. Someone else's loop is a starting point, not a guarantee — which is why reports of magical loops coexist with reports that publicly published loops do not work at all.

Li organises tasks on two axes: how editable the artefact is, how verifiable the result is. Code sits upper-right; open-ended image generation sits lower-left. The important property is that **the axes describe the representation, not the task.** The same image represented as SVG paths or a Blender scene becomes editable; give it a reference image or constraints and progress becomes verifiable. That is another definition of loop engineering: **re-representing the task until it sits in the quadrant where loops converge.**

## The Economics of Loops — All the Value Landed in the First Third

What is known is the shape of the curve. Across almost every study of test-time compute, returns are logarithmic (ICML 2025's "How Do Large Language Monkeys Get Their Power (Laws)?"). One web-agent benchmark (CATTS) found that going from 1 sample to 10 lifted success from **38.8% to 43.2%**; doubling again to 20 bought **0.2 more points for twice the tokens**. Past the plateau the marginal iteration turns negative — "When More Thinking Hurts" reports that reasoning models given larger budgets start abandoning answers that were already correct.

Li then instrumented the loop from Anthropic's own loop-engineering post.

- On a deliberately broken page (Lighthouse 35), **Claude Code cleared 98 on the very first try, for $0.35.** The loop never engaged.
- So she made the goal unreachable: the same page behind **2.2 seconds of artificial latency** that caps the score around 89, with 100 requested.
- **The first $1.40 took the score from 26 to 89. The remaining $2.84 — 67% of the total bill — bought exactly zero points.** Turn after turn of re-minifying HTML and re-running Lighthouse against a bottleneck the agent could not change, each turn more expensive than the last as the transcript grew, with the Haiku evaluator quietly accumulating $0.67 on its own.
- **The escape hatch was unreliable too.** Claude correctly diagnosed the latency ceiling and declared the goal impossible around try 5; the evaluator model bounced it back 14 times anyway.
> The lesson isn't that loops don't work; it's that they have no idea how to stop.

Stopping well is not something you can prompt into existence. It takes infrastructure: something to meter the spend, something to measure progress against it, and something with enough information to cut the loop off.

## The Differentiation Moved Outside the Loop

Asked how they knew a loop would converge, practitioners across software engineering, visual and creative tasks, and video editing answered uniformly: a great deal of trial and error. **We are effectively trying to encode human knowledge into the loop itself.** The inference-time versus training-time contrast reduces to the same rule: at inference time the loop changes the work with weights fixed, at training time many trajectories are scored and the model updated — and **in both cases the loop is only as good as its verifier**, a test suite in one, a reward signal in the other. But not every failure should be solved through training; the higher-leverage fix is often outside the weights — a better tool, clearer state, a more precise action space, a stronger verifier.

Li closes on two expectations. First, **the economics will have to become explicit.** We run loops the way we once ran cloud instances nobody remembered to turn off; the token costs the same whether it moves the score or re-minifies the same HTML for the ninth time. The missing piece is boring but necessary — cost per iteration, progress per dollar, a curve someone can see while the loop is still running. Second, **for loops that already converge, the interesting infrastructure work has moved out of the loop.** The loop itself is a while-statement; everything that makes it converge lives around it — the environment the agent acts in, the state that survives a long run, the verifier that decides what counts, the surface where a human steps in. That stack is where differentiation actually sits.

> The systems that matter will not be the ones that can keep going. They all can. They will be the ones whose builders decided, precisely and in advance, what done costs and what done means.