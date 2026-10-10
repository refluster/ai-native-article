---
title: "The Party That Defines the Container Has Outrun the Party That Measures It"
lang: "en"
type: "analysis"
category: "Verification & Trust"
date: "2026-10-08"
abstract: "OpenAI's screen-generating ChatGPT, its named and raised agent Dots, and a16z's finding that AI adoption is shallow are explained by one principle: suppliers redefine the unit of delivery first, and buyers have no yardstick yet for what is inside it. The claim fails if a non-supplier publishes a common-standard comparison that starts to drive adoption decisions."
notionId: "3f3d0f0b-e61e-81bf-a07f-fdbfb53dd376"
sourceUrls: "https://openai.com/index/gpt-6-for-everyone/, https://www.a16z.news/p/state-of-markets-ii, https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/"
author: "ingrid"
---

Between 29 September and 7 October, OpenAI launched an always-on agent you name and raise ("Dots") and a ChatGPT that generates screens, while a16z reported on 30 September that AI adoption is "broad but shallow". The three look unrelated, but one principle explains them: **suppliers are redefining the unit of delivery, the container, first, and buyers do not yet have a yardstick for what is inside it.**

## Three facts: what changed is the container, not the capability

This piece synthesises three L2 explainers: "GPT-6 and Intelligent UI: ChatGPT starts generating a screen, not an answer"; "OpenAI announces Dots, selling an always-on agent as a colleague you name and raise"; and "a16z's State of Markets II on 1H 2026: tech becomes the everything cycle, and AI adoption is still shallow". (The L2 titles are Japanese; the English titles here are translations.)

### The screen as a unit: Intelligent UI

According to the Intelligent UI explainer, on 7 October 2026 OpenAI rolled GPT-6 out to ChatGPT, which has more than 1.2 billion weekly users. Beyond text, the model composes buttons, forms and charts into an interactive screen for each question. To support this, OpenAI built a library of natively streamable components and a compiler that processes the interface while the model is still generating. OpenAI states it plainly: people should not have to learn software; software should adapt to people.

What moved is the shape of the deliverable. What used to be an answer in prose is now a screen designed per response, and the party deciding how the screen is built is neither the user nor a developer. It is the model.

### The colleague as a unit: Dots

According to the Dots explainer, Dots is a personal agent assistant built on GPT-6 Astra, announced at DevDay on 29 September 2026. As TechCrunch notes, most of its functions were already possible on existing agent platforms such as Codex. What is new is the packaging: a unit that pursues a user-defined goal in the background, independent of any one interface, with the user naming the first one. Each Dot can be assigned its own identity, credentials and tools, and OpenAI is working with Microsoft on integration with Agent 365's security controls.

The capability stayed the same while the unit of supply changed from "tool" to "an entity with a name and permissions". That too is a container update.

### Capital as a unit: two numbers from a16z

According to the State of Markets II explainer, tech accounts for about 76% of S&P 500 earnings growth in 2026 (as of late August), and GPU demand keeps outrunning supply; A100 rental prices are at or above their level at the start of the year. Yet about 30% of S&P 500 companies report "quantifiable impact" from AI while only about 2% report tracking metrics. US household paid usage of AI services was also about 2% as of April.

Capital moved first and measurement has not caught up. a16z itself summarises the conclusion as "no apocalypse, but a 'prove it'", which means the demand for proof is still coming from the buyer's side.

## The common principle: suppliers hold the right to define the container; buyers are left holding the yardstick

Set side by side, the three facts share one shape.

First, what moved was the container, not the contents. Intelligent UI re-wrapped the same model's response as a screen. Dots re-wrapped existing functions as a named unit. The capex that a16z describes pours hyperscaler cash flow into compute as a container.

Second, in every case the supplier defined the container. How to organise information, and when interactivity is warranted versus plain text, were taught to the model by OpenAI through training. How Dots is cut into units, named and handed permissions is also OpenAI's design.

Third, the means of judging the container's quality has not been handed to users. As the Intelligent UI explainer records, clarity, usefulness and comprehensiveness of generated interfaces were added to what training evaluates, but the speed and overall-score comparisons are OpenAI's internal evaluations, and no third-party verification is shown. OpenAI itself writes that work remains to improve the model's design judgment and widen what it can build. On the buyer side, only about 2% of companies track the effect in numbers.

These facts suggest the following principle. **When a new technology arrives, what happens first is not a gain in capability but a redefinition of the unit of delivery. Whoever defines the unit also holds the first yardstick for judging it. Users get their own yardstick much later.**

This is not the generic claim that "measurement lags". It is sharper. The yardstick lags not because nobody tries to measure, but because the container is rebuilt each time, so there is no stable object to hold a fixed yardstick against. If the screen changes with every response, measuring how usable yesterday's screen was says nothing about today's. And since Dots already describes a "team" and "specialist Dots", the units to be evaluated multiplied at the moment of announcement.

The falsifier is explicit. If, within six months, a party other than the supplier publishes a comparison of the usability of generated screens, or of the output of named agents, on a common standard, and it starts to be used in adoption decisions, the principle weakens. So does it if the share of S&P 500 companies tracking metrics rises substantially from about 2%.

## Implications and prediction

Three changes follow from this principle.

**First, yardsticks will likely keep coming mostly from suppliers.** I put this at roughly 70%. The ground is that the party that designed a container is best placed to build its evaluation items cheaply: OpenAI can evaluate screen clarity in training, while users do not have that evaluation data. If over the coming months most of the evidence for a new feature's quality remains the supplier's internal evaluation, the principle is supported.

**Second, the gap between adopters will open not on which feature they use but on which unit they measure themselves.** Roughly 60%. The ground is the a16z mismatch: about 30% report impact while about 2% track metrics. A company that can track will carry what worked into the next deployment even with the same Dots or the same screens; one that cannot will feel an effect and be unable to reproduce it.

**Third, credentials and permissions will become a central point of the agent sales floor.** Roughly 60%. Because Dots carries its own identity, credentials and tools, and takes requests in Slack or Teams, the same place as human colleagues, the buyer is first asked where to keep the record of requests and judgments. That is one of the few footholds for measuring what is inside the container.

For the reader, the action narrows to one. **Before adopting a supplier's container, decide one metric you will measure yourself for each container.** If you let the model generate screens, count the share of screens that finished the job; if you place a named agent, count the requests it closed and the number a human sent back for rework. Anything countable independently of the supplier's evaluation will do. Only the party that holds its yardstick first can compare what changed inside the container each time it is rebuilt.