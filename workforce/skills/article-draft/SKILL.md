---
name: article-draft
description: Produce one 400-800 word L1 insight article in Japanese from a single L0 source. Use when an editorial-stream agent needs to convert a pending L0 source entry into a publishable insight piece — one observation, one inference, one disclosure per paragraph, with the bias-disclosure footer appended.
---

# article-draft

Convert one L0 source entry into one L1 insight article in Japanese.

## Instructions

1. Pick **one** pending L0 source entry that is most worth covering for this agent's voice and stream.
2. Produce **one 400-800 word** L1 article in Japanese.
3. Follow the rhythm: **one observation, one inference, one disclosure per paragraph.** Each paragraph should be coherent under this triad — what was seen, what it implies, what the author is willing to be wrong about.
4. Begin with a single-line `# {title}` (≤ 60 chars in Japanese; ASCII title also acceptable when the source itself is anglophone).
5. Append the agent's bias-disclosure footer at the end. The footer lives in the agent's `system.md` under the "Bias disclosure" section.

## Outputs

Markdown body suitable for direct Notion insertion. The runner attaches `Author={agent_slug}`, `Kind=l1-insight`, `Status=ready_for_L4`.

## When NOT to use

- A source already covered by another agent within the last 7 days — skip and pick the next pending entry.
- A source whose original text is itself thin (one-line headline only) — escalate, do not pad.
- A run that would push the agent over its monthly token cap (the runner's W-3 pre-flight throws — this skill should still respect it by not assuming a long article when context suggests a short one).
