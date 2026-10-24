---
title: "The Optimization Principle That Will Shape the Economics of AI Operations"
lang: "en"
type: "analysis"
category: "Agentic AI"
date: "2026-06-04"
abstract: "**Summary: The core competitive axis in AI is shifting from “higher performance” to “control over tokens and operations.”**"
notionId: "375d0f0b-e61e-81e8-aa90-dceccea18f87"
sourceUrls: "https://www.goldmansachs.com/insights/articles/ai-agents-forecast-to-boost-tech-cash-flow-as-usage-soars, https://x.com/fukkyy/status/2061285149774663814, https://www.pagerduty.com/blog/ai/new-enhancements-to-pagerdutys-sre-agent-triage-faster-without-waking-a-human/"
author: "elena"
hasPodcast: "true"
---

## Introduction

As agentic AI spreads, monthly LLM token consumption is set to expand **24x from 2026 to 2030, reaching 120 trillion tokens**. At the same time, inference unit costs are falling **60–70% annually**, and PagerDuty, through its SRE Agent, is trying to build a world where incident response can begin “**without waking people up**.” At first glance, these may look like separate stories about infrastructure economics, developer productivity, and operations automation. But in fact, they can all be explained by the same principle. **AI value creation is shifting away from the model itself and toward how organizations manage the inference resources being consumed—and where they choose to stop automation.**

## Analysis 1: AI Infrastructure Economics, Where Exploding Demand and Falling Unit Prices Advance at the Same Time

First, Goldman Sachs’s observation matters. According to the article, the expansion of agentic AI is expected to drive LLM token consumption **24x from 2026 to 2030**, to **120 trillion tokens per month**. At the same time, inference costs are projected to decline **60–70% annually**, and hyperscalers may reach an **“inflection point for margins” in the next 3–12 months**.

What matters here is that rising demand and falling prices are not contradictory. If anything, they are linked. Lower unit prices drive more usage, and more usage in turn creates further optimization and economies of scale. But total cost does not necessarily fall. A **24x increase in tokens** generates enormous compute demand across the overall workload, even if unit prices plunge.

The article’s four-part framework—“**exploding demand, falling costs, supply constraints, and asymmetry in adoption**”—is especially suggestive. Together, these facts indicate that the AI market is no longer a simple contest to build the “highest-performance model.” It has entered a struggle between those creating demand and those trying to keep that demand economically sustainable. In particular, “supply constraints” and “asymmetry in adoption” matter. In an environment where high-performance GPUs are not abundant, a strategy of running every task on the largest possible model does not hold up. In other words, the question is no longer peak performance, but **where limited inference resources should be allocated**.

## Analysis 2: The Shift From “Token Maximizing” to “Token Management”

The second article frames this structural change as a management-level issue. Its title says it all: from **“token maximizing” to “token management.”** In the early phase of generative AI adoption, people often assumed that “longer context,” “more inference,” and “more frequent calls” translated directly into value. But with agentic AI, completing a single business task may involve multiple model calls, tool executions, retries, and verification steps. As a result, usage grows not in proportion to the number of users, but to the **number of actions an agent takes**.

This affects day-to-day software development practice as well. As the article explains, AI is reshaping development workflows, and what is needed is not mere assistance but a redesign of the development process itself. That means moving away from one-shot prompt usage and toward **continuous, iterative AI consumption**. For example, if loops involving code generation, test generation, review, fix suggestions, and reruns become more common, apparent productivity may rise while token consumption accumulates behind the scenes.

What matters here is that AI cost is no longer a minor IT line item; it is becoming **something that must be managed at the executive level**. These facts suggest that AI usage is no longer just “an added SaaS feature,” but **an operational workflow with inference costs as a variable expense**. Traditional software generally had relatively low marginal costs after deployment. AI does not. Every use incurs cost, and with agents, the number of uses can rise exponentially. That is why the central question is not “how much should we use it?” but “**where should we let it act, and where should we stop it?**”

## Analysis 3: The “Optimal Stopping Point” for Automation, as Shown by PagerDuty

PagerDuty’s enhancements to its SRE Agent are a practical example of this principle in operations. The company says that, through **automatic triage triggered by Incident Workflows**, it can pull forward the initial response in routine investigations “**without waking people up**.” This is not simply an AI rollout. It is, rather, **a design for letting AI run up to the point of highest cost-effectiveness, while delaying human intervention until later**.

In incident response, full automation is not always optimal. That is because the cost of false judgments and the cost of excessive execution can both be high. So PagerDuty assigns AI first to repetitive, easy-to-structure tasks such as triage, information gathering, and routine investigation. That reduces the number of times on-call staff need to be woken in the middle of the night, while allowing humans to focus on higher-uncertainty decisions.

What this example shows is that the real value of AI lies not in **maximizing processing power**, but in **where to draw the line between high-cost human resources and low-cost model resources**. If inference unit prices continue falling **60–70% annually**, then front-end tasks like triage become even easier to shift toward AI. At the same time, final decision-making in incident response will often remain in human hands. These facts suggest that the benefits of AI deployment are determined not by whether “everything has been automated,” but by whether an organization has **designed the optimal stopping point**.

## A Shared Principle: The Economics of AI Reside Not in “Intelligence,” but in “Control”

The most plausible deep principle that unifies all of these facts is this hypothesis: **in the age of agentic AI, the source of value shifts away from model performance itself and toward the operational design capability to control inference resources, number of actions, and the timing of human intervention**.

Goldman Sachs’s forecast of **“24x, 120 trillion tokens”** suggests that the bottleneck in AI is no longer insufficient demand, but **managing runaway demand**. At the same time, a **60–70% annual decline** in inference prices will encourage wider adoption—but that is exactly why uncontrolled agent execution can easily trigger cost inflation. The second article’s phrase **“token management”** is essentially a translation of this issue into the language of management. And the PagerDuty case shows that, at the operational level, the solution is not “automation rate,” but **precise design of which parts AI should handle and which parts should be handed back to humans**.

These facts suggest that competitive advantage in AI will not be sustainable through model selection alone. Model prices will fall, performance gaps will narrow, and the foundation layer will commoditize. What will differentiate companies instead is a **control architecture** that can: 1) reduce unnecessary inference, 2) use small and large models selectively, 3) build in retries and monitoring, and 4) delay expensive human intervention until it is truly needed.

In short, profitability in the AI era will be determined less by “having a smarter AI” than by “**keeping AI from running wild and making sure it operates within profitable bounds**.” That is the Why. The So What is that companies must manage AI not as a “usage feature” but as an **operational asset**.

## Forecasts and Implications

The future implied by this principle is fairly clear. First, with **high probability (around 70–80%)**, the metrics companies use to evaluate AI investments will shift from “model performance” to “**total inference cost per task completed**.” The reason is simple: token consumption is set to grow **24x**, and falling unit prices alone will not offset the increase in total usage. Instead of API unit prices, the key KPI will be how many model calls it takes to resolve one inquiry, complete one code fix, or close one incident.

Second, with **moderate to high probability (around 60–70%)**, AI product design principles will shift away from “always use the biggest model” and toward **“staged escalation.”** For example: a small model for initial classification, a high-performance model only for ambiguous cases, and a human involved only for final confirmation. PagerDuty-style automatic triage is an early example of this. And it is likely to spread beyond SRE into customer support, sales enablement, internal help desks, and development and operations more broadly.

Third, with **high probability (around 80%)**, “token management” will become institutionalized as a new management domain adjacent to FinOps and SRE. In concrete terms, that likely means standardized practices such as token budgets by department, upper limits by agent, controls on retry counts, and defined conditions for handoff to humans when processing fails. The trajectory resembles the way cloud usage governance became established as Cloud FinOps.

There are three practical takeaways.

The first is: **do not measure the impact of AI adoption by usage volume**. More usage does not necessarily mean more value.

The second is: move to **task-level unit cost management**. Look not at token unit prices, but at cost per business outcome.

The third is: **design the stopping point for automation**. As PagerDuty suggests, organizations should decide in advance “how far AI should go, and at what point a human should be called in.”

Ultimately, the essence of agentic AI × operational cost management is straightforward. The winners will not be the companies that use the most AI. They will be the companies that **control AI the best and turn tokens and human intervention into operating margin**.