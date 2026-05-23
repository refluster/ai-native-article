---
name: code-task-brief
description: Produce a task brief for the engineer Claude Code routine — what to change, why, acceptance criteria. Use when the Engineer persona needs to dispatch implementation work to the workforce-engineer-routine.yml GHA workflow (the R-N1 exception path); the brief is what the CC routine reads as its instructions before writing code.
---

# code-task-brief

The handoff document between an LLM-on-Lambda planning step and a Claude Code routine that will actually write code on GitHub Actions.

## Instructions

The brief must be **self-contained**: the CC routine has no memory of this conversation and only the brief + the target repo's files to work from.

Sections:

1. **What** — one sentence stating the change. "Add X." / "Fix Y in Z." / "Refactor A to B." No "and also" — one change per brief.
2. **Why** — 2-4 sentences of context the routine needs to make judgement calls. Include the failing symptom (for fixes), the user value (for features), or the design pressure (for refactors).
3. **Files likely touched** — bullet list. Best-effort; the routine may diverge if it sees a better path.
4. **Acceptance criteria** — checkbox list. Each item is unambiguously verifiable by CI or a one-line reproducer. "All tests pass" is too weak; "scripts/check-gas-manifest.mjs passes" is right.
5. **Out of scope** — bullet list of nearby changes the routine should **not** touch.

Length target: 200-500 words in Japanese or English (the CC routine reads both; match the prevailing language of the target repo).

## Trigger surface

Skills with `trigger_class=claude-code-routine` (this one is) hand off to the existing `workforce-engineer-routine.yml` workflow_dispatch path (R-N1 exception). The Lambda runner builds the brief and calls `lambdas/shared/github.ts:dispatchEngineer()`; the runner then exits immediately without blocking on the routine's completion. The orchestrator's 5-minute poll picks up the resulting draft PR.

## When NOT to use

- The change is non-code (docs-only, governance, content). Use a different skill or hand off directly.
- The brief would be longer than the implementation itself — write the code directly and skip the brief.
