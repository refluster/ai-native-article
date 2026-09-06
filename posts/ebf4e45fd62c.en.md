---
title: "AI Infrastructure Demand Has Not Slowed — a16z’s Real-World Data Shows a 6-Month Backlog, H100 Rental Rates Up 40%, and Entry-Level Hiring Still at 5%"
lang: "en"
type: "explanation"
category: "AI Infrastructure"
date: "2026-08-03"
abstract: "In “Charts of the Week: Moar Machines,” published on July 31, 2026, a16z New Media’s Moses Sternstein tests three common narratives suggesting that AI demand is slowing, using hard data from the U.S. Census Bureau, ADP, Silicon Data, and YipitData. The conclusion is consistently negative: backlog ratios for data-center machinery remain stably elevated at just under 6 months, 12-month H100 contract rental prices are up about 40% from last November, and the share of entry-level tech hiring said to have been “taken” by AI has remained unchanged at about 5% since 2019."
notionId: "3b1d0f0b-e61e-81c8-806b-ebf4e45fd62c"
sourceUrls: "https://www.a16z.news/p/charts-of-the-week-moar-machines"
author: "ingrid"
---

## Executive Summary

In “Charts of the Week: Moar Machines,” published on July 31, 2026, a16z New Media’s Moses Sternstein tests three common narratives suggesting that AI demand is slowing, using hard data from the U.S. Census Bureau, ADP, Silicon Data, and YipitData. The conclusion is consistently negative: backlog ratios for data-center machinery remain stably elevated at just under 6 months, 12-month H100 contract rental prices are up about 40% from last November, and the share of entry-level tech hiring said to have been “taken” by AI has remained unchanged at about 5% since 2019. Many of the indicators that have been treated as signs of a slowdown reflect either supply constraints or structural patterns that predate the AI boom, not a drop in demand.

## Vertiv’s Miss Does Not Signal Weakening Demand — It’s Another Way of Saying Supply Can’t Keep Up

The article begins with earnings from Vertiv, a major supplier of cooling and power equipment for data centers. In the second quarter, the company added $3.27B in revenue, yet still came in about $76 million below its own guidance and about $120 million below market consensus. Management explained it this way:

> "minor timing shifts, primarily due to temporary supply chain congestion and multi-phased project execution as deployments scale in size and complexity."

Rather than simply taking that explanation at face value, Sternstein checks whether the same pattern appears in other datasets.

- In U.S. Census Bureau manufacturing orders data, orders for data center- and power-related machinery — HVAC, turbines, and oil and gas equipment — have **nearly doubled from the levels of the prior 10 years**. HVAC in particular has risen sharply, which is consistent with the heat output of high-power compute.
- **Unfilled orders** for computers and electronic products underwent a step-change around 2023 and have recently resumed climbing at a steep angle.
The author notes, however, that unfilled orders are not a clean measure: they cannot distinguish between supply-chain bottlenecks and excess demand. A more useful metric for teasing that apart is the **backlog ratio** (unfilled orders ÷ monthly shipments), which sits at **just under 6 months** — extremely high by historical standards, but **mostly flat since 2024**. Meanwhile, the New York Fed’s global supply chain pressure index remains **about 2 standard deviations** above normal. Looking at import volumes directly, physical flows of goods have been largely unchanged over the past year and a half, except in the “power conversion” category, where physical volume is **down about 23% from January 2025** while prices are **up about 25%**.

**Conclusion from the evidence**: There is clear supply-chain stress at the global level, but this dataset does not show firm evidence that it is appearing as a data-center-machinery-specific bottleneck. At least based on public statistics, there is no support for reading Vertiv’s miss as evidence that demand has topped out.

## Before Saying “AI Took Entry-Level Jobs,” Remember: Tech Entry-Level Hiring Was Only 5% to Begin With

The second issue is the labor market. Sternstein has previously argued that the “AI Took My Job” thesis is not supported by the data, but here the point is more structural.

- **Entry-level jobs in tech account for only about 5% of total job openings**, and **that share has been essentially unchanged since 2019**.
- The squeeze is showing up more in the **mid-level** segment, while senior roles are gaining share.
- The sector where the entry-level share is actually falling is **healthcare**, where it has been declining since 2023.
One alternative hypothesis is the normalization of remote hiring. ADP data show that the “long distance hire rate” surged during the pandemic and has remained elevated at **26.4%**, which is **about 30% higher** than before the pandemic. By sector, information and technology services lead the way, with **more than 45%** of workers in some form of long-distance work arrangement.

**Conclusion from the evidence**: Before attributing weakness in new-graduate hiring to AI, two explanatory variables need to come first: (1) the base was small and unchanged to begin with, and (2) remote hiring opened up global talent pools, reducing employers’ incentives to hire less-experienced local candidates. In the author’s phrasing, “AI probably didn't take your job, but WFH certainly may have”.

## Reading the Decline in the Token Cost Index as Weakening Demand Is a Misread of the Metric

The third issue is Silicon Data’s Token Cost Index, which has circulated as a signal of slowing AI spending. The index has fallen almost continuously since its May peak, and it has often been cited as evidence of collapsing demand.

Sternstein points out that what the metric actually measures is **token-spend intensity** — a combination of token consumption and unit price. Even if demand for high-priced tokens rises, the index can still fall if demand for lower-priced tokens rises even more. In other words, a falling index is consistent with either weakening demand or a change in mix; on its own, it is not decisive.

At the same time, other independent data series are moving up.

- YipitData’s analysis of OpenRouter data shows that **B2B spending on Cursor, Anthropic, and OpenAI is increasing in both total and median terms** (based on the top 4 spending industries). Software is the largest category, but business services, consumer goods, and especially **finance** are all trending upward.
- GPU rental rates continue rising in both spot and long-term contracts, with the exception of A100 spot rates, which are roughly flat. The **12-month contract price for H100 is just under $2.50 per GPU-hour**, **about 40% higher than in November of last year**.
- The prediction market Kalshi is pricing that same rate at **about $2.78/hour**, about 5 cents above the level at the time the data were captured.
**Conclusion from the evidence**: If you treat a directional shift in a single composite index as a demand signal, you risk mistaking compositional change for demand change. With both actual spending and GPU rental rates — two independent data series — rising at the same time, the author’s line, “so much for GPU obsolescence,” is a fair reading for now.

## Where These Three Lines Cross

These three arguments may appear separate, but they share a common methodology. In each case, the indicator presented as “evidence of a slowdown” was in fact measuring either a **limitation in the definition of the metric itself** — as with unfilled orders and token-spend intensity — or a **structural pattern that predates AI** — as with the 5% entry-level hiring share and remote hiring. The author’s rebuttal does not rely on new data so much as on re-slicing already public statistics at the right level of granularity.

At the same time, the limitations Sternstein acknowledges are made explicit. The counterfactual — how much higher imports might have been absent supply-chain disruption — is unknowable from this dataset alone, and on that point one is left taking Vertiv’s claims and the New York Fed’s signal more or less at face value. So the real conclusion is not “there is no slowdown.” More precisely, it is: **the slowdown is not showing up in these data**.