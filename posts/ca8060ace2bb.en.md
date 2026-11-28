---
title: "Work Is Shifting from Turns to Loops"
lang: "en"
type: "analysis"
category: "Agentic AI"
date: "2026-07-02"
abstract: "The smallest unit of AI-enabled work is quietly shifting from a single request—a turn—to a loop that keeps running. A technical document saying model runtimes have stretched into hours, a claim that expert work has moved from writing prompts to designing loops, and an observation that the majority still use AI in the slowest possible way all reflect the same underlying shift at different layers: infrastructure, expertise, and adoption. The source of value is moving from the quality of one-off input/output to the structure of the loop itself, and asynchronous supervision is becoming a new foundational skill."
notionId: "391d0f0b-e61e-81cc-b294-ca8060ace2bb"
sourceUrls: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5, https://x.com/0xmortyx/status/2069722362765832202?s=46, https://x.com/anatolikopadze/status/2068328135611822149?s=46&t=JLj57N67SbZn6GQzDkxKag"
author: "elena"
hasPodcast: "true"
---

The smallest unit of AI-enabled work is now quietly being replaced: from “a single request (turn)” to “a continuously running loop.” At first glance, three seemingly unrelated facts—a technical document saying model runtimes have stretched into hours, a claim that expert work has shifted from “writing prompts” to “designing loops,” and the observation that the majority of daily AI users still rely on the slowest usage pattern—can in fact all be explained by this same principle. They are happening at different layers—infrastructure, expertise, and adoption—but they all point to one and the same transition.

## The Infrastructure Is Being Rewired Asynchronously—Models Themselves Are Beginning to Assume Loops

The first fact lies on the side of the technical foundation. The biggest change conveyed by the “Claude Fable 5 Migration Guide” is not the model’s intelligence, but the length of its runtime. A single request can take several minutes at high effort, and autonomous execution can extend to several hours. That one change fundamentally alters client-side design. The guide explicitly states that synchronous, blocking harnesses built around timeout assumptions need to be reworked into asynchronous checks. In other words, the synchronous pattern of “submit a request and wait” is starting to break down on the model’s own terms.

### From “Waiting” to “Supervising”

If a response comes back in a few seconds, a human can simply wait for the result. A process that runs for several hours cannot be waited on—it becomes something that must be supervised in progress, with intervention if necessary. Another detail raised in the guide reinforces this point. It notes that older instructions that forced reasoning into the response body can trigger rejection by `reasoning_extraction`, which means existing skills need to be inventoried during migration. The old craft of tightly steering a single response in fine-grained detail no longer works; what matters instead is how the process as a whole is run. The foundation itself is being redesigned to operate not at the level of turns, but at the level of loops.

The guide also says instruction-following has been strengthened, so that even short instructions can steer behavior. At first glance, that makes it sound as though fine-grained control has become easier rather than harder. But what is actually happening is not that control is disappearing, but that the control point is moving. Instead of constraining each response line by line, you place a short governing rule that affects the entire loop—the reins have not vanished, they have been lifted one level up, from the turn to the loop. Longer runtimes and stronger instruction-following are not separate changes; they are two sides of the same redesign.

## Expert Work Moves Up a Level—From Writing Prompts to Designing Loops

The second fact concerns the role of the humans working on top of that infrastructure. An article by @0xMortyx introduced in “The Case for ‘Loop Design’” begins with a striking line: “The person who built Claude Code hardly writes prompts anymore; the loop writes the prompts. His job is to design the loop.” From that point, it argues that the primary task in AI development has shifted from prompt writing to loop design. The added value of an expert, on this reading, has moved upward—from writing a good sentence to designing a mechanism that continuously generates prompts automatically.

### Identifying What Can Actually Be Verified

That said, the briefing itself includes an important caveat. What could be verified was limited to the title, opening preview, and post metadata (87.8K Views); the contents of the “5 stages” could not be consulted as a primary source because the article itself sits behind a login wall. So this piece, too, does not attempt to reconstruct the five-stage framework. It takes only the core claim—that the center of gravity in the work has shifted from prompts to loops—as the verifiable takeaway. Precisely when speaking in terms of principle, intellectual honesty requires making clear the limits of what the evidence actually supports.

## The Majority Are Still Stuck in the Slowest Loop—The Divide Is Moving from “Access” to “How You Run It”

The third fact concerns adoption. Anatoli Kopadze’s article (9.5Mビュー), discussed in “Using AI in ‘Loops,’” makes a simple but sharp point. AI has been available to everyone for years, and yet the majority of people who use it every day still manually follow the slowest possible pattern: “type a request → wait → revise → ask again.” The problem is not tool performance but the operating pattern, and the conclusion is that the dividing line in who benefits from AI has shifted from “access” to “how you run it.”

Whereas the first and second facts belong to the leading edge of infrastructure and expertise, this third fact reflects the reality at the broad base. At the frontier, loops have already become the assumption, and experts are already moving into loop design. But the majority are still in a turn-based world, operating one step at a time by hand. The same word, “loop,” appears in both places—on one side as an arrival point, on the other as an unexplored entry point.

## The Shared Principle—The Smallest Unit of Human-AI Collaboration Has Shifted from Turn to Loop

These three facts may look like separate events occurring at separate layers. But when placed side by side, they point to one and the same movement. The smallest unit of human-AI collaboration has shifted from “a synchronous, one-shot request (turn)” to “a loop (process) that keeps running asynchronously over time.” That is the principle that runs through all three.

On the infrastructure side (the Fable 5 Migration Guide), investment in model capability is no longer going primarily into “how smart a single response is,” but into “how long it can keep running unattended.” As a result, harnesses must be reworked from synchronous to asynchronous. On the expertise side (0xMortyx’s argument for loop design), human work moves up from “writing a good request” to “designing and supervising a good loop.” On the adoption side (Kopadze’s argument about loops), the dividing line in who captures the benefits shifts from “who has access” to “who knows how to run it.” Taken together, these facts suggest that the source of value in AI use is moving from the quality of one-off input/output to the structure of the loop itself.

Put differently: behind the era of competing over “good prompts,” a new axis of inequality is emerging—who can design a “good loop.” Turns still exist, but they are no longer the unit by which value is measured. The unit of measurement has become the loop.

## Forecasts and Implications—Asynchronous Supervision Will Become a New Foundational Skill

If this principle is correct, then the next changes become somewhat predictable. First, the longer model autonomy runs (and the several hours suggested by Fable 5 are probably still just a waypoint), the wider the gap will grow between loop designers and manual users. That is because differences in the quality of a single response will no longer be enough to create a meaningful advantage. The basis for that forecast is that all three facts point in the same direction: infrastructure, expertise, and adoption are all pushing value toward the loop.

Second, the bottleneck will shift from prompt quality to loop structure. Concretely, stopping conditions (where to stop), validation (how to trust what comes out at the end of a run), and asynchronous supervision (how to watch over a process that runs for several hours) will become the central design problems. Tools and harnesses will be rebuilt around this assumption of asynchronous supervision. The Fable 5 Migration Guide’s call to “rework from synchronous blocking to asynchronous checks” is only the first push.

Third, verification will grow in importance. Just as the briefing in “The Case for ‘Loop Design’” cautiously accepted only the core claim because it could not confirm the full text of the article as a primary source, the longer a loop runs, the smaller the share of the process that a human can inspect directly. In a turn-based world, you could look at each output one by one. In a loop that runs for several hours, you cannot see every step. That means designing in advance “what you need to look at in order to trust the output” becomes a central skill of loop design itself. Verification must be woven into the structure of the loop, not bolted on afterward as an inspection step—and that is what ultimately determines the quality of “how you run it.”

The practical implication is clear. What people need to learn is not more clever prompt phrasing, but the skill of designing and supervising loops—how to set stopping conditions, how to build in verification, and how to monitor a process that keeps running. If Kopadze is right, the majority are still in the slowest loop. That is exactly why the gains from moving just one level up from the slowest loop are so large. If there is a rebuttal to this claim, it would be a world in which simply improving the quality of a single response continues to produce enough differentiation on its own. But the direction indicated by all three facts points the other way.