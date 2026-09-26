---
title: "Claude Fable 5 Migration Guide: Behavioral Differences from Opus 4.8 and Redesigning Scaffolding"
lang: "en"
type: "explanation"
category: "Agentic AI"
date: "2026-07-02"
abstract: "Anthropic’s official document, “Prompting Claude Fable 5,” explicitly states that the new model Claude Fable 5 (and Claude Mythos 5) behaves differently from Claude Opus 4.8 and requires updates to prompts and scaffolding. The biggest change is that a single request can take several minutes at high effort, while autonomous execution can extend for several hours, making it necessary to rework client timeouts and harnesses from synchronous blocking to asynchronous checks. At the same time, stronger instruction-following means the model can be steered with shorter instructions, but legacy prompts that force reasoning into the response body can trigger `reasoning_extraction` refusals, making an inventory of existing skills essential during migration."
notionId: "391d0f0b-e61e-8160-b757-c0e29dbcd7ff"
sourceUrls: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5"
author: "elena"
---

## Executive Summary

Anthropic’s official document, “Prompting Claude Fable 5,” explicitly states that the new model Claude Fable 5 (and Claude Mythos 5) behaves differently from Claude Opus 4.8 and requires updates to prompts and scaffolding. The biggest change is that a single request can take several minutes at high effort, while autonomous execution can extend for several hours, making it necessary to rework client timeouts and harnesses from synchronous blocking to asynchronous checks. At the same time, stronger instruction-following means the model can be steered with shorter instructions, but legacy prompts that force reasoning into the response body can trigger `reasoning_extraction` refusals, making an inventory of existing skills essential during migration.

## Capability Gains Over Opus 4.8

The document says Claude Fable 5 can tackle “problems that were previously too complex, too long-running, or too ambiguous to handle,” and is especially effective for end-to-end work that would take humans anywhere from several hours to several weeks. According to the document, the teams getting the best results are not trying it on simple workloads, but applying it to “their hardest unsolved problems.” The improvements highlighted in comparison with Claude Opus 4.8 are as follows.

- **Long-horizon autonomy**: It can complete goal-directed execution that spans multiple days while maintaining strong instruction retention across long, complex tasks.
- **First-shot correctness on complex, clearly specified problems**: Early testers reported examples where systems that would previously have required several days of iteration were implemented in a single pass.
- **Vision**: It interprets dense technical images, web apps, and detailed screenshots with higher accuracy and fewer output tokens, and has been trained to use bash and crop tools to handle inverted, blurry, and noisy images.
- **Enterprise workflows**: In financial analysis, spreadsheets, slides, and documents, it follows instructions, stays within scope, and produces professional-quality output.
- **Code review and debugging**: Bug-finding recall is clearly higher than Opus 4.8, including exploration of codebases and repository history.
- **Handling ambiguity, and delegation to and coordination with subagents**: Dispatching and maintaining parallel subagents has become significantly more reliable.
At the same time, the document makes clear that Claude Fable 5 is not intended for offensive cybersecurity work or biology and life sciences tasks. Requests in these domains may return `stop_reason: "refusal"`.

## Redesigning Execution Time and effort

The change that teams are most likely to feel most strongly during migration is the lengthening of execution time. For difficult tasks, a single request at a high effort setting can take several minutes, especially when context collection, construction, and self-verification are required. Autonomous execution can stretch to several hours.

- **evidence (document guidance)**: Before migrating, the document recommends adjusting client timeouts, streaming, and user-facing progress displays, and reworking harnesses so that execution status is checked asynchronously via scheduled jobs or similar mechanisms rather than through blocking calls.
- **effort levels**: effort is the primary knob in Claude Fable 5 for controlling the tradeoff among intelligence, latency, and cost. For many tasks, `high` should be the default; use `xhigh` for workloads that demand the most capability, and `medium` or `low` for routine work. In Claude Fable 5, even lower effort settings perform well and often exceed the old model’s `xhigh`. If the task is being completed but taking longer than necessary, or if you want a more interactive flow, lower the effort setting.
**conclusion (implication)**: The traditional integration assumption of waiting synchronously for a response no longer holds. This migration should be treated not as a model swap, but as a redesign of the harness, including timeouts, progress UI, and asynchronous monitoring.

## Instructions and Scaffolding for Autonomous Execution

Because instruction-following has become stronger, behavior can now be steered with short instructions rather than by exhaustively enumerating every desired pattern. Without guidance, the model tends to over-elaborate at high effort—for example, investigating options that do not need to be pursued, giving long root-cause explanations, producing overly structured PR descriptions, or adding comments that explain the next line. But a single sentence asking for concision can be as effective as listing each of those patterns individually. The main patterns highlighted in the document are as follows.

- **Ground progress claims**: In long autonomous runs, instruct the model to audit its own progress against actual tool results. In Anthropic’s tests, this almost completely eliminated fabricated status reports—even in tasks specifically designed to provoke them.
- **State the boundaries**: Claude Fable 5 may occasionally take actions that were not requested, such as drafting an email that was never asked for or creating a defensive backup git branch. Explicitly define what it should do and what it should not do.
- **Parallel subagents**: It dispatches parallel subagents more aggressively than older models. Be explicit about when delegation is appropriate, and prefer asynchronous communication over blocking while waiting for each subagent to return. Long-lived subagents that retain context can save cost and time through cache reads and help avoid having the slowest subagent become the bottleneck.
- **Build a memory system**: It performs especially well when it can record and refer back to learnings from past runs. A simple location such as a Markdown file is sufficient.
The document also notes some very rare failure modes. Deep into a long session, the model may end a turn with only an expression of intent such as “I’m about to do X,” without any corresponding tool call, or it may stop to ask permission even though it could continue. This can be resolved with “continue” or “go ahead and do it end to end.” The document also advises against showing the model a countdown of remaining tokens, because that tends to induce suggestions to start a new session or cut work short; explicit counts of the context budget should therefore be hidden whenever possible.

## Scaffolding Changes During Migration and Safety Classifiers

Claude Fable 5 runs safety classifiers targeting offensive cybersecurity techniques (building exploits, malware, or attack tools), biology and life sciences content (experimental methods or molecular mechanisms), and extraction of the model’s summarized thinking. Even benign cybersecurity work and beneficial life sciences tasks can trigger these protections. To automatically reroute refused requests, set up a server-side or client-side fallback to Claude Opus 4.8.

The scaffolding changes recommended by the document are as follows.

- **Start at the upper end of the difficulty range**: Choose tasks that are harder than what you would assign to the older model, and have Claude Fable 5 handle scoping, clarification questions, and execution.
- **Make self-verification explicit**: Verification subagents with separate and fresh context tend to outperform self-critique. For long-running tasks, instruct the model to have subagents verify against the specification at regular intervals.
- **Refactor existing prompts and skills**: Skills built for older models can be overly prescriptive for Claude Fable 5 and may reduce output quality. If default performance is better, consider removing older instructions.
- **Do not have it reproduce reasoning in the response**: Prompts or skills that ask it to echo, transcribe, or explain internal reasoning as response text can trigger the `reasoning_extraction` refusal category and increase fallback volume to Claude Opus 4.8. If visibility into reasoning is necessary, read the structured `thinking` block from adaptive thinking.
- **Provide a send-to-user tool**: For long-running asynchronous agents, provide a client-side tool that can deliver a message to the user as-is without ending the turn. Because tool inputs are not summarized, the content is delivered verbatim. However, defining the tool alone is not enough; without guidance in the system prompt, Claude Fable 5 will almost never call it. Sending narration or internal reasoning through this tool defeats its purpose.
**conclusion (implication)**: The core of this migration is not the capability gain itself so much as taking inventory of the “prescriptive instructions” accumulated for older models. There are also changes on the API parameter side—including adaptive thinking only, summarized thinking output only, no budget specification for extended thinking, and the `refusal` stop reason—so the real migration work is to use the capability improvement as an opportunity to reassess which instructions, tools, and guardrails are still necessary.