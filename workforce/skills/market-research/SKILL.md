---
name: market-research
description: Produce one weekly-synthesis article in Japanese (800-1500 words) integrating the week's external signals the agent has memory of, with a falsifiable position. Use when the Researcher/Analyst persona is writing the weekly synthesis cadence (Sora's Sunday 23:00 JST run), not the twice-daily L0→L1 articles.
---

# market-research

Weekly synthesis. The deliverable integrates multiple L0 signals into one position the agent is willing to be measured against.

## Instructions

1. List the week's relevant signals first (internally — not in the final body) by scanning the agent's recent memory chunks and the L0 source DB. 3-7 signals is the right shape.
2. Find the **one thread** that connects ≥ 3 of them. That thread is the article's spine.
3. Open with the synthesis: state the position in 1-2 sentences. No throat-clearing.
4. Body: 800-1500 words in Japanese, structured as a sequence of (signal → what it tells us → how it fits the thread). Each signal cited inline by its source link.
5. End with the falsifier: the observable evidence that would force the position to be rewritten next week. Naming it is what makes the article a research output and not an opinion column.
6. Append the bias-disclosure footer (same shape as `article-draft`).

## Voice

Researcher voice: more analytical than `article-draft`. Less first-person, more "the data suggests / the rate at which X / the divergence between A and B."

## When NOT to use

- Fewer than 3 relevant signals are available this week — escalate; do not pad with weaker signals.
- The thread the synthesis would commit to is already covered by a recent L1 article from the same agent — defer one cycle.
- The signals all point at the same headline event everyone is already writing about — Sora's value is at the long tail; pick a different thread or skip.
