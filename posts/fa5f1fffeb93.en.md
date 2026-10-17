---
title: "What Became Scarce Is Stopping, Not Producing"
lang: "en"
type: "analysis"
category: "Verification & Trust"
date: "2026-08-08"
abstract: "Where the cost of supply has collapsed, the freedom to produce more expands first and nobody designs the rule that says stop. Books with detected AI text reaching about 40% of observed sales, 67% of an agent loop's spend buying exactly zero points, and $720bn of 2026 hyperscaler capex creating inflation before diffusion are explained by one principle. What determines a system's quality is not generative capability but the bandwidth of its verifier and the presence of a stopping rule — and now that generation is cheap, the scarce thing is being able to decide when to stop."
notionId: "3b6d0f0b-e61e-81a9-ac86-fa5f1fffeb93"
sourceUrls: "https://www.a16z.news/p/charts-of-the-week-bookslop, https://www.a16z.news/p/knowing-when-to-stop-the-art-of-making, https://www.lseg.com/en/insights/data-analytics/ai-infrastructure-emerges-as-a-new-macro-cycle"
author: "ingrid"
hasPodcast: "true"
---

Where the cost of supply has collapsed, the freedom to produce more expands first and nobody designs the rule that says stop. Three observations published this summer deal with completely different subjects and converge on exactly that point.

"Charts of the Week: Bookslop," published by a16z's Moses Sternstein on 7 August 2026, reports that books in which AI text is detected have come to account for roughly 40% of observed sales. Yoko Li, also at a16z, reproduced an agent loop and recorded that 67% of a total spend of $4.24 bought precisely zero points. Erwan Jacob, a macro analyst at LSEG, estimates 2026 capital expenditure by the top five US hyperscalers at about $720bn and argues that AI has already stopped being a technology theme and become a macroeconomic force. A book market, an agent lab, and a central bank's policy call — these can in fact be explained by one and the same principle.

## 67% of the spend bought nothing

The numbers recorded in "When Should a Loop Stop?" show the principle in its purest form. Reproducing the loop from Anthropic's loop-engineering article, the first $1.40 of a $4.24 total lifted the Lighthouse score from 26 to 89. The remaining $2.84 — 67% of the whole — bought exactly zero points.

What matters is that the loop is not broken. Being able to keep going is the loop's capability, not its defect. Li's point was that the essential problem is not that a loop can keep running but that it does not know how to stop.

She sets out four conditions for convergence: a goal state, an observable current state, a means of local edit, and a stopping rule. The first three can be supplied on the generation side; only the last cannot be produced by generation. She adds a second proposition that fixes the ceiling — the quality of a loop never exceeds the verifier at each step. However fast and cheap generation becomes, an improvement the verifier cannot see is treated exactly as if it did not exist. The 67% is the consequence of that, not an accident.

## Four-tenths of sales turn over and nothing stops

"AI-Generated Books Reach About 40% of Self-Publishing Sales" shows the same structure at the scale of a market. The paper "Generative AI floods and dilutes the market for books," by researchers at Stony Brook, Columbia, Michigan and the MIT Initiative on the Digital Economy, reports that books with detected AI text have reached roughly 40% of observed sales. The two words in its title — floods and dilutes — carry the whole claim. Not that supply increased, but that value per unit thinned because supply increased.

Here too the generation side is working normally. What does not stop is unstopped because no stopping rule is implemented anywhere in the market. The book market's verifier is a hand-operated sorting apparatus — reviews, editors, shelf space, word of mouth — and its throughput does not track the fall in supply cost. Li's proposition that the verifier sets the ceiling holds just as well outside a loop.

The other three items in the same issue — a surge in defence-industry backlog, IT services valuation multiples shrinking to a third, and demand conversion for Moonshot's "Kimi K3" — are gathered under the same heading of a supply-demand turn. The compression of valuation multiples in particular reads as a record of the market marking down what it will pay for the ability to produce.

## Why $720bn creates inflation first

"AI Investment Has Become a Macro Cycle" describes this structure at the highest layer. On Jacob's estimate, 2026 capital expenditure by the top five US hyperscalers will reach about $720bn and is already moving the prices of semiconductors, electricity and imported goods.

The core of that piece is not the total but the ordering. AI's effect on prices is "inflationary in the investment phase, disinflationary in the diffusion phase," and the two appear sequentially rather than simultaneously. The spending happens now; the productivity improvement that justifies it arrives later. Between the two there is necessarily a period during which spending accumulates unverified.

That is why Jacob writes that this forces a hard judgement on central banks. Monetary policy does have a stopping rule — an observable indicator in the inflation rate and a means of local edit in the policy rate. But that stopping rule cannot distinguish investment-phase inflation from diffusion-phase disinflation. The verifier is running, and it can mistake what it is measuring.

## The shared principle: what is scarce is not generative capacity but the stopping rule

These three facts suggest the following. In a system where supply cost has fallen far enough, what determines the system's quality is not capability on the generation side but the bandwidth of its verifier and the presence or absence of a stopping rule.

Li's "the quality of a loop never exceeds the verifier at each step" was written as a proposition about implementing agents. Set the three side by side, however, and it is not about implementation at all: it is a property of any system whose supply cost has collapsed. The loop's verifier is a Lighthouse score; the book market's verifier is editing, reviewing and reader selection; the macro verifier is inflation statistics and the policy rate. In every case the speed and cost of generation improved by an order of magnitude while the verifier's bandwidth barely moved.

That asymmetry produces two consequences. First, surplus spending does not stop by itself. The figure of 67% is the price of the time a loop kept running after its verifier stopped detecting improvement. Second, the surplus does not present as failure. The loop does not crash, the books get published, the capex is executed as planned. In none of these cases can the system detect that it is doing worthless work.

So the scarce resource has changed places. When generation was expensive, the scarce thing was choosing what to make. Now that generation is cheap, the scarce thing is being able to decide when to stop. And a stopping rule does not emerge as a by-product of generation. That it was the one item among Li's four conditions that the generation side cannot supply is not a coincidence.

## Predictions and implications

If the principle holds, several changes follow.

First, the criterion for valuing an investment shifts from what you can build toward where you stopped. The "Bookslop" observation that IT services multiples compressed to a third reads as an early instance. If generative capability itself is not a differentiator, what the market prices moves to the quality of selection and stopping. This is not a high-confidence prediction, though: there is a lag before the market can observe the quality of verification, and in the meantime totals and growth rates will go on being used as proxies.

Second, and with higher confidence, investment on the verifier side will rise relative to investment on the generation side. For $720bn of capex to produce diffusion-phase disinflation, its output has to be verified and adopted. If verification is the rate-limiting step, verification is the next thing that gets funded.

Third, the central bank's judgement gets harder. If the investment and diffusion phases arrive sequentially, inflation statistics will always require an interpretation of which phase is being measured. The danger that a stopping rule mistakes its own measurement target is maximised exactly when the phases change over.

The practical implication for a reader is simple. For whatever loop you are running — code generation, content production, capital allocation — try writing down only the stopping rule out of the four conditions. The goal state, the observation of the current state and the means of edit are usually already there. The one you cannot write is the stopping rule, and the fact that you cannot write it is itself an estimate of what share of that spending is buying zero points.