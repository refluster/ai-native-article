---
title: "Code Migration Shrinks from “Multi-Year Project” to Weeks — How Claude Code Changed the Economics of Large-Scale Language Migration and the 6-Step Method"
lang: "en"
type: "explanation"
category: "Agentic AI"
date: "2026-07-22"
abstract: "Migrating a production codebase from one language to another has shrunk from a multi-year undertaking to a matter of weeks. Using Bun’s Zig→Rust migration (1 million lines in under 2 weeks, about $165,000 at API list prices) and a Python→TypeScript migration of 165,000 lines completed over a weekend, Anthropic lays out a six-step method. The core insight is that the real target is not the code but the process—the loop—that produces the code, and with the decision cost now lowered to “the worst case is deleting the branch,” migration no longer needs an “existential” justification."
notionId: "3a5d0f0b-e61e-81c2-8e28-cdfaeb3ed826"
sourceUrls: "https://x.com/claudedevs/status/2079654423828304282?s=46&t=JLj57N67SbZn6GQzDkxKag"
author: "ingrid"
---

## Executive Summary

Porting a production codebase to a different language used to be a multi-year effort. In the past month alone, Anthropic developers migrated 10 packages ranging from tens of thousands to hundreds of thousands of lines using Claude Fable 5, Claude Opus 4.8, and dynamic workflows, including Bun’s Zig→Rust migration (1 million lines in under 2 weeks) and a Python→TypeScript migration of 165,000 lines completed over a weekend. The key, they argue, is not fixing code but fixing the “process (loop)” that produces the code. Because the decision cost of attempting a migration has fallen by orders of magnitude, migrations no longer require an “existential” reason to begin.

## What Happened — Two Migration Cases and Measured Results

Anthropic illustrates the shift from a “multi-year undertaking” to a matter of weeks with two concrete examples. The evidence is as follows.

- **Bun (Zig→Rust)** — Bun co-founder and Anthropic technical staff member Jarred Sumner carried out the migration with Claude Code. It generated 1 million lines of code in under 2 weeks, and before merge, CI confirmed a 100% pass rate on the existing test suite. After merge, 19 regressions surfaced, all of which have since been fixed. The Rust version shipped inside Claude Code in June. Total token usage was 5.9B non-cached input and 690M output, equivalent to about $165,000 at API list prices.
- **Python→TypeScript** — Anthropic Labs co-lead Mike Krieger migrated a Python codebase into 165,000 lines of TypeScript over a weekend. The effort included hundreds of agents, 8 phase gates, 3 rounds of adversarial review, and a final parity check that compared the Python original against the output of every command. The main body of the migration consumed 27M tokens.
The bottom line: million-line migrations that once would have been 4-year projects costing $3 million to $4 million can now be executed for tens to hundreds of thousands of dollars. That said, the article explicitly notes that “they still cost a meaningful amount,” and a valid business case is still required.

## The Decision Equation Has Changed — “The Worst Case Is Deleting the Branch”

More important than the technical speedup is the change in the criteria for deciding whether to attempt a migration in the first place.

- In the past, you might maintain two parallel codebases for quarters or years, only to reach 90% parity and end up with “a bigger headache than before you started.” Now, “the worst case is deleting the branch and trying again.”
- As a result, the business case for migration no longer needs to be “existential.” In the article’s words, “a changelog with a year’s worth of memory bug fixes” or “one chronic bottleneck” may now be enough to justify it.
Mike’s case is a textbook example of that “chronic bottleneck.” His team’s internal tool ships to users as a single binary, but generating binaries with the Python toolchain took about 8 minutes per platform, adding up to 30 minutes of waiting per release across the full build matrix. After the migration, the same compile took about 2 seconds, binary startup became 6x faster, and the team was able to eliminate one separate deployment pipeline.

## Why AI Is Well Suited to Code Migration

The article explains why large-scale migration is such an effective use case for advanced models like Fable and Opus 4.8 by looking at the structure of the work itself.

- **The work is parallelizable** — It can be broken into thousands of independent units such as files or crates, which agents can process simultaneously without waiting on one another.
- **The context is explicit and comprehensive** — The old code itself serves as an excellent specification for the model.
- **The judge is built in** — Most large codebases have test suites, which let agents verify their own work.
- **The queue self-generates** — Compilation failures and test failures become the next items agents need to fix.
- **The task demands consistency and edge-case handling** — Reviewers cite the rule behind each finding, so deviations become queue items rather than “silent drift.”
## The 6-Step Method — Build the Judge First

The premise of the method is simple: build a strong judge first. Without it, you have neither a stopping condition nor a measure of success. Building the judge consists of classifying tests—having Claude distinguish between tests that can be expressed as external calls and those that cannot be ported because they depend on internals—rewriting for portability, and validation. For portability, externally oriented tests are rewritten into assertions that can run against both the original and the target implementation, and adversarial agents verify that those assertions have not been weakened. For validation, you first confirm that the judge passes against the original, then confirm that it fails against intentionally broken code. The article is blunt: “A judge that doesn’t catch breakage is not a judge.” Mike went further, repeating a cycle of revising rules and workflows based on results and then discarding the output, continuing through a third iteration.

The key points of each step are as follows.

- **Step 1: Rulebook, dependency map, and gap inventory** — The order matters: the rulebook must come before the gap inventory. If the new code will preserve the same structure, as in Jarred’s case, the rulebook is a mapping table for types and idioms. If the migration is a full redesign, as in Mike’s case, it becomes a design document. Jarred had 8 sub-agents review for 8 common failure modes drawn from his own intuition. “Gaps” are requirement mismatches between the old and new languages: manual memory management in Zig→Rust, and interfaces and contracts in Python→TypeScript (Python does not require you to declare the shape of the objects you accept or return, while TypeScript does).
- **Step 2: Stress-test the rules** — Jarred ran one agent that translated 3 files “according to the rulebook” and another that translated them “like a senior Rust engineer,” then had the system generate new rules from the diff between the two outputs. That surfaced 2 major issues before expanding to all 1,448 files. All translated files are then discarded—the goal is not forward progress but refinement of the rules.
- **Step 3: Full translation** — Run a multi-agent loop of implement, review, and fix. Implementation can be delegated to smaller models (Mike used Claude Sonnet in 12 sub-agents for the main migration), while reviewers stay on larger models. The work queue can be mechanically reconstructed from which translated files exist on disk, making the migration structurally resumable. Any place the system cannot translate with confidence is marked `// TODO(port): <reason>`. Two adversarial reviewers evaluate the result; disagreements go to a third. If the same error is repeatedly found, you do not patch files one by one. Instead, you add a sentence to the rulebook and regenerate the affected batch—do not fix the code with spot repairs.
- **Steps 4–6: Compile, run, and behavior parity** — These steps share the same loop structure while progressively reducing the amount of human judgment involved. Jarred removed the compiler from the loop and ran it in batches via an orchestrator (because cargo takes several minutes), while Mike kept the TypeScript compiler inside the loop (because it can validate one unit in a matter of seconds). Compiler error lists and smoke-test crashes become sources of mechanical truth. In the final stage, the build daemon—the only process allowed to rebuild—collects patches and performs a single rebuild, serializing the most expensive operation. Even when you cannot inherit the original test suite, you can still create a judge: Mike had Claude write scripts that checked 7 real scenarios against the original, then had Claude autonomously run its own E2E tests for 4 consecutive nights. The original codebase remains the ground truth at all times.
## Results and Implications — “Review the Output of the Loop, Not the Code”

Jarred’s Bun migration is now running in production. There were tradeoffs: about 4% of the Rust codebase consists of `unsafe` blocks, mainly single-line pointer operations at C/C++ boundaries. Even so, the new codebase is measurably better. Every memory leak detectable by the team’s tooling has been fixed, and in one benchmark involving 2,000 repeated builds, memory consumption dropped from 6,745MB to 609MB. The binary became 19% smaller on Linux and Windows, and real workloads such as HTTP serving, `next build`, and `tsc` ran 2–5% faster.

The broadly reusable lessons collapse into 5 practices: do not blindly follow a guide—plan each migration with Claude; focus on patterns rather than one-off failures; make review adversarial and validation mechanical; use smaller models for implementation fan-out and reserve the largest models for review and rule generation; and spend human effort up front on the rulebook and stress testing, the two most time-consuming parts. In short, the thing to fix is not the code, but the process that produced it.