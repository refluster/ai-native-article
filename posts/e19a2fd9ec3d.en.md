---
title: "AI May Increase Not the Amount of Code, but “Artifacts Aligned to the Wrong Intent” — Trust as the Rate-Limiting Step in Engineering Organizations"
lang: "en"
type: "explanation"
category: "Verification & Trust"
date: "2026-05-24"
abstract: "Leonid Bugaev’s argument is straightforward: the bottleneck in AI adoption within engineering organizations is not model capability, but trust. AI can generate specs, code, tests, and docs consistently, but consistency does not guarantee correctness; if the entire artifact set aligns around the wrong intent, even green CI is no basis for safety."
notionId: "36ad0f0b-e61e-8192-9bde-e19a2fd9ec3d"
sourceUrls: "https://blog.reqproof.com/p/engineerings-ai-bottleneck-is-trust"
---

## Executive Summary

Leonid Bugaev’s point is clear: the bottleneck to using AI in engineering organizations is not model capability, but trust. AI can generate specs, code, tests, and docs coherently, but that coherence does not guarantee correctness; if the full set of artifacts lines up around the wrong intent, even green CI is no proof of safety.

The question, therefore, is no longer “how much code can AI write,” but “what needs to exist around the code so that increased change can be safely absorbed.” As the answer, the author presents a trust layer that does not treat specs as temporary artifacts to be consumed and discarded, but instead traceably links requirements, obligations, tests, docs, and implementation—turning the pull request into an “evidence pack.”

## What green CI proves is not correctness, but that “the current artifacts match the current checks”

The author explains why development speed does not continue to scale linearly after AI adoption as a divergence between falling implementation cost and persistently high trust cost. A pull request is only a proposal for change; by itself, it is something asking to be trusted, not something that contains the basis for that trust.

- Evidence
- The author writes, “AI can write specs, code, tests, and docs. If all of them agree on the wrong intent, green CI isn’t enough.”
- While noting that “AI does make some things dramatically faster. MVPs are faster. Prototypes are faster. The time to validate an idea is reduced a lot,” he distinguishes that from the fact that “creating the first version of something isn’t the same as maintaining a product.”
- The traditional trust model was “write the code, write the tests, pass CI/CD, review the pull request, ship,” but as he puts it, “Green CI never meant the product was correct. It meant the code passed the checks we had.”
- As examples of what those checks do not prove, the author lists whether the requirement itself is correct, whether the tests are testing the right thing, whether the documentation is complete, and whether the change matches real product behavior.
- He states explicitly: “They prove that the current artifacts agreed with the current checks.”
- With AI, the following chain becomes possible: “The spec can be wrong, the code can follow the wrong spec, the tests can validate the wrong code, the docs can describe the wrong behavior, and CI can still be green.”
- He defines that state this way: “That’s not trust. That’s a consistent mistake.”
- Conclusion
- CI/CD, tests, and code review remain necessary, but in the AI era they are no longer sufficient to guarantee the validity of intent.
- The problem is not the quality of any one artifact in isolation, but the structure in which an entire set of artifacts can become mutually consistent around the wrong intent.
- As a result, reviewing only the code diff is no longer enough; review has to expand to include context such as why this change exists, what it affects, and what remains unresolved.
## “Undocumented specification” that even high coverage cannot fill — security and malformed input are no longer optional

The author argues that many defects originate not in code, but in missing specification that predates the code. In particular, items such as malformed input, authorization boundaries, resource limits, timeout behavior, error states, and public API behavior should not be treated as enterprise extras, but as product requirements.

- Evidence
- Referring to an earlier article on jsonparser, the author writes, “I had near-100% coverage in the area that mattered. The problem was that malformed input behavior was never properly described. So the tests proved what existed, not what should have existed.”
- From that, he derives the proposition: “You cannot test what you never described.”
- On security, he says that in the past, not a few teams relied on “some quiet version of security by obscurity.”
- As evidence that this assumption has collapsed, he cites: “VulnCheck reported that in the first half of 2025, 32.1% of known exploited vulnerabilities had exploitation evidence on or before the day the CVE was issued.”
- He then makes the point directly: “malformed input, authorization boundaries, resource limits, timeout behavior, error states, data exposure, public API behavior. These aren’t enterprise extras. They’re product requirements.”
- As subtle cases, he also names: “Concurrency. Non-deterministic behavior. Map iteration. Merge order. I’m looking at you, Go.”
- Conclusion
- High test coverage shows only the depth of verification against behavior that has already been described; it cannot compensate for omissions in areas that were never specified.
- In an environment where AI is also generating the tests, validation can easily become hollow unless the specification has already defined what questions need to be asked.
- Especially for “boring” items such as security, error handling, and determinism, these should no longer be treated as after-the-fact quality work, but as obligations embedded in the requirements.
## The same in open source and inside the company — contributors who touch the outside structure do not own the intent

The author explains this trust problem through his experience as an open source maintainer. External contributors, internal support engineers, and solutions architecture staff may all be able to work with the visible code, tests, and docs, but they do not share the accumulated product promises and load-bearing behavior built up over years. In that sense, the structure is the same.

- Evidence
- The author writes, “For the last 12 years at least, I worked a lot in open source,” and speaks from his experience with his own popular open source projects and from building an open source API Gateway at Tyk.
- He says that a maintainer’s job is not limited to the technical correctness of a PR: “you still need to get inside the context. You need to understand what’s happening and why this person is doing it.”
- Contributors see “the outside structure,” but “they don’t see the intent in the same way the owner of the project sees it.”
- He goes further: “They don’t know all the small product promises made over the years. They don’t know which ugly thing is accidental and which ugly thing is load-bearing.”
- The same structure exists internally as well: “A support engineer may understand the product from the customer side, but not the architecture. Another team may understand code, but not the local history. AI may generate something that looks clean, but it has no real ownership unless someone gives it context and checks it.”
- In Tyk’s customer context, the software is used by “banks, governments, and large enterprises,” and the cost of bugs is described as: “Sometimes it’s legal. Sometimes it’s regulatory. Sometimes it’s very big money.”
- The author redefines speed as: “Speed isn’t how quickly you can make a change. Speed is how quickly you can safely absorb change.”
- He also cites Lehman’s software evolution work: “The safe rate of change per release is constrained by the process dynamics,” and explains that as the number, size, and architectural distance of changes grow, complexity and fault rate grow more than linearly.
- Conclusion
- Whether a contributor is external or internal, human or AI, is secondary; the core issue is whether that change is connected to deep intent.
- The more AI broadens the entry point for contributions, the more organizations with weak maintainer-side trust systems will see only an amplification of review burden.
- In mature products embedded in customers’ operating infrastructure, “move fast” has to be redefined not as the ability to generate change, but as the upper limit of change that can be safely absorbed.
## A temporary spec eventually becomes archaeology — what’s needed is a source of truth with obligations and traceability

In consumer engineering, many specs are created as temporary artifacts and then go unmaintained through implementation, review, and operations, with knowledge scattered across Jira, GitHub comments, Slack threads, Confluence, and individual memory. The author calls this not development, but archaeology.

- Evidence
- The author describes the reality of specification this way: “Maybe an RFC. Then it becomes a detailed Jira ticket. Maybe later there is an ADR. There are comments in GitHub. A Slack thread. A Confluence page.”
- Over time, that becomes: “If you want to understand how a component works, you need to dig through history,” and, “This is archaeology, not development.”
- The problem is that the artifacts are disconnected: “The RFC isn’t connected to all the code. The Jira ticket isn’t connected to all the tests. The docs are scattered across ten pages. The final implementation isn’t connected back to the original assumptions. It’s not a graph.”
- As a result, engineers, architects, leads, and PMs are implicitly expected to hold the high-level picture in their heads, but “this is too much context for one person to carry.”
- Even spec-first has limits: “Spec-driven development is better than no spec,” but “if the spec is still treated as a temporary artifact, after a few iterations you end up in the same position, with intent chaos.”
- On obligations, he defines them this way: “An obligation is not a test case. It’s a category of behavior you are required to describe: malformed input, boundary behavior, error handling, access denied, determinism, idempotency, atomicity, nil safety, overflow safety, encoding safety.”
- The role of an obligation is that “It forces you to ask the question,” which the author evaluates as something that “turns ‘maybe someone remembers’ into a deterministic process.”
- AI’s role is not to judge architecture taste, but to surface missed questions—for example, if goroutines are used, asking where cancellation, lifecycle, and error propagation are described; or, for a public API change, asking about compatibility and documentation obligations.
- As something worth learning from regulated industries, the author points to requirement management in aviation, automotive, medical devices, and space systems: “Requirements have IDs. They have layers. They are linked to documentation, tests, implementation, verification evidence. You can see blast radius.”
- On NASA’s FRET, he describes it as “hierarchical system requirements in structured natural language,” with “unambiguous semantics,” and involving “natural language, formal logic, diagrams, and interactive simulation.”
- Conclusion
- The minimum unit that supports trust is not a vague ticket or even a high-coverage test suite, but a source of truth that keeps intent durable, traceable, and linked to evidence.
- Obligations are not templates for answers, but mechanisms for deterministically surfacing points that are easy to miss.
- The value of regulated engineering is not paperwork, but that requirements stay alive alongside the software, and that when change happens, blast radius and verification evidence can be traced.
## Turning the pull request into an “evidence pack” — the trust layer Proof aims for

The implementation unit the author proposes does not replace the ordinary pull request, but adds an evidence chain above it in the form of an “evidence pack.” This bundles not only code, but also intent, requirements, obligations, tests, docs, blast radius, spec conflicts, changes made during implementation, and places where human judgment is still required into a single reviewable package.

- Evidence
- Of today’s pull request, the author says: “Today a pull request usually gives me code, maybe tests, maybe a description. But it doesn’t give me the whole chain.”
- Among the missing pieces, he names “the original intent,” “which obligations apply,” “the blast radius,” “which docs changed or should have changed,” “which specs this conflicts with,” and “what changed during implementation compared to the plan.”
- As a result, the reviewer is forced back into “archaeology.”
- The “evidence pack” the author wants has the following structure: “Here is the intent. Here are the requirements. Here are the obligations. Here are the tests that witness them. Here are the docs. Here is the blast radius. Here is how it aligns with existing specs and where we checked for conflicts. Here is what changed during implementation. Here is what still needs human judgment.”
- This applies equally to “open source,” “support engineers contributing fixes,” “other internal teams,” and “AI agents.”
- The author acknowledges the increase in friction, saying, “Writing obligations is slower than writing a vague ticket. Linking tests to requirements is slower than writing random tests.” At the same time, he distinguishes this from bureaucracy: “Bureaucracy gives you friction without trust. Evidence gives you friction that lets more people move safely.”
- He explains why he is building Proof in this context: “The problem isn’t that we can’t produce enough artifacts. The problem is that the artifacts don’t preserve intent.”
- As goals, he lays out: “I want specs to stop being temporary. I want requirements to live with the software. I want obligations to force the boring questions before they become production bugs. I want code, tests, docs, and requirements to invalidate each other when they drift.”
- Finally, he summarizes the kind of scaling he wants as: “Not just more code. More trusted change.”
- Conclusion
- To connect AI’s value to real production use, what is needed is not artifact generation speed, but an evidence structure that makes change reviewable, traceable, and mergeable.
- The “evidence pack” is not a proposal for eliminating the weight of review, but for shifting the object of review from the code diff to the evidence chain.
- As a result, maintainers can move away from being mere “managers of incoming things” and toward an operating model that can absorb change in parallel based on evidence.