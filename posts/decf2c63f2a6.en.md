---
title: "Replacing a Quant Research Team with 6 AI Agents: Designing a “Swarm” That Hunts Alpha 24/7"
lang: "en"
type: "explanation"
category: "Agentic AI"
date: "2026-07-07"
abstract: "Backend developer Roan (@RohOnChain) has published a concrete “swarm” architecture that assigns each of the six stages of quant alpha research—from reading arXiv papers to factor decomposition—to a dedicated AI agent and runs them in parallel around the clock. The core idea is a role shift: humans stop serving as the pipeline that validates hypotheses one by one and instead move into designing the loop, with strict maker-checker separation—using different models for generation and validation—as the foundation of rigor. That said, the piece also doubles as promotion for the tool “Slate,” recommended by Anthropic Claude Code lead Boris Cherny, and many of its claims are presented as design theory rather than measured results."
notionId: "396d0f0b-e61e-811a-b400-decf2c63f2a6"
sourceUrls: "https://x.com/rohonchain/status/2074134246784921977?s=46&t=JLj57N67SbZn6GQzDkxKag"
author: "elena"
---

## Executive Summary

Backend developer Roan (@RohOnChain) has published a concrete “swarm” architecture that assigns each of the six stages of quant alpha research—from reading arXiv papers to factor decomposition—to a dedicated AI agent and runs them in parallel 24 hours a day. The core idea is a shift in role: “humans stop serving as the pipeline that validates hypotheses one by one and instead move into designing the loop.” As justification, he cites a remark by Anthropic Claude Code lead Boris Cherny: “I no longer prompt Claude. I run loops that prompt Claude and determine what should be done. My job is to write the loops.” However, the article also doubles as promotion for the tool “Slate,” which Cherny advocates, and many of its claims are presented as design theory rather than empirical measurement.

## Distinguishing “Prompts,” “Loops,” and “Swarms”

Roan defines the three concepts step by step. In his own profile, he describes himself as a backend developer “building life around prediction markets and crypto quant systems,” and says he specializes in system design, HFT-style execution, and quantitative trading.

- **A prompt** is “a question.” You ask once, get one answer back, and it stops there.
- **A loop** is “work.” The agent keeps going while checking its own progress until the task is actually complete. If you have used Claude Code, Cursor, or Codex, then you have probably been using a loop without thinking about it: model call → choose an action → execute → return the result, repeated until the goal is reached.
- **A swarm** is “many loops running in parallel.” Each loop is a specialist, takes charge of one stage, and the output of one stage becomes the input to the next stage.
Roan maps this to the difference between “one researcher typing” and “a research team.” As evidence, he says Renaissance runs this pipeline with 100 people, Two Sigma with 200, and Citadel with even more PhDs, concluding: “The only difference is that they need hundreds of humans inside the pipeline. You don’t.”

## Six Dedicated Agents and Rejection Thresholds

The swarm Roan proposes breaks down the six stages that, he argues, every serious quant fund shares, assigning each stage to a separate agent. A notable feature is that concrete statistical thresholds are specified for each stage.

- **Agent 1: Idea Generation** — Reads arXiv q-fin, SSRN, and finance journals every night; extracts the claimed mathematical model, hypothesis, required data, and expected direction of the predictive signal; and writes a structured “research ticket.” This runs on a low-cost, high-speed model for high-volume structured extraction.
- **Agent 2: Feature Engineer** — Takes the hypothesis ticket and retrieves data from price and fundamentals databases. It standardizes cross-sectionally and handles missing values, outliers beyond 3 standard deviations, and look-ahead bias.
- **Agent 3: Backtester** — Tests on 20 years of data, including realistic trading costs (5bps per trade), stock borrow costs on the short side, and slippage, then outputs the Sharpe ratio, maximum drawdown, turnover, and capacity.
- **Agent 4: Validator** — Runs Newey-West adjusted t-statistics to correct for autocorrelation and 10,000 bootstrap resamples, rejecting anything whose out-of-sample Sharpe deteriorates by more than 30% relative to in-sample Sharpe as overfitting. Because “the maker never validates their own work,” this runs on a stronger reasoning model.
- **Agent 5: Regime Auditor** — Uses a hidden Markov model (HMM) to identify regimes from volatility and returns, then recalculates Sharpe, drawdown, and hit rate by regime. Anything that only works in a single regime is rejected as “regime timing disguised as alpha.”
- **Agent 6: Factor Decomposition** — Regresses against the Fama-French 5 factors + Carhart momentum + a low-volatility factor, then reports residual alpha (intercept) and the t-statistic. Only signals whose residual alpha survives factor decomposition count as truly novel alpha; everything else is “just momentum or value repackaged.”
In the published JavaScript loop, Sonnet is assigned to the faster stages, Opus to validation and factor decomposition, and the setup is configured to trigger every 24 hours with `slate.sleep('24h')`.

## Maker-Checker Separation and the Five Failure Modes That “Kill 90%” of Efforts

What Roan places at the center of rigor is “maker-checker separation”: splitting generation and validation into different agents and different models. He argues that “the agent that generated the hypothesis is the worst possible judge of whether it is real alpha,” and says Renaissance, Two Sigma, and Citadel all use the same separation.

He lists five failure modes that, he says, kill 90% of retail efforts:

1. **Skipping the validator** — 100 signals with beautiful Sharpe ratios all turn into data snooping. 2. **No state persistence** — A swarm with no memory tests the same failed hypotheses every day. Record everything, including the reason for rejection, and never let it spend tokens twice on the same failure. 3. **No maker-checker separation**. 4. **Making one agent do everything** — The moment generation, engineering, backtesting, and validation are collapsed into a single agent, quality falls apart. 5. **No stopping condition for the loop** — A verifiable stopping condition, based on something other than the agent’s own claim that it is “done,” is mandatory—for example, “Sharpe above 1.5 across the last 30 out-of-sample trades” or “drawdown below 5%.”

## Slate as the Implementation Layer, and the Implication That “The Research Moat Is Dead”

Roan says that if you try to build this with your own Python scripts, things break down the moment “one agent has to wait for another,” “you need to preserve state across cycles,” or “you want to run 6 loops in parallel on different models.” In the end, he says, you stop doing research and wind up building your own agent infrastructure instead. As the solution, he points to “Slate” (https://randomlabs.ai), a coding harness from @wearerandomlabs, and “Programs,” a newly launched feature that lets you write loops in JavaScript and keep their state alive continuously. Even after subtracting the promotional element, the argument being made is clear.

- There are 3 operating patterns: “overnight discovery,” where you review the surviving signals the next morning after running overnight (20:00–8:00); “burst mode,” where you validate 100 hypotheses at once when new papers land; and “alpha decay monitoring,” where validated signals are rechecked every week and exposure is cut when Sharpe declines.
- The conclusion is: “You stop being the pipeline and become the architect.” Roan states flatly: “The research moat is dead. The infrastructure moat is real.”
That claim amounts to a division of labor in which humans design and supervise while agents execute, learn, and accumulate. Repetitive validation work is delegated to agents, while scarce human judgment is concentrated on “which loops to design, and with which rejection thresholds.” Structurally separating validation from generation and accumulating rejection history as state is a framework that can be applied well beyond quant work to agent operations in general.