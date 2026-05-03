# Azure OpenAI budget sizing rules

**Status:** Adopted (governance L1).
**Last updated:** 2026-05-03.
**Audience:** anyone calling `azureGenerateText` in `gas/src/Code.gs` or extending the LLM-driven prompts.

The L2 truncation bug (visible until 2026-05-03 on `kohuehara.xyz/.../d17e1d58ec42`) shipped because L2's call to `azureGenerateText` used the 2000-token default while L3's call correctly overrode to 8000. The rule below would have caught it at code-review.

## The rule

Every call to `azureGenerateText` MUST set `maxCompletionTokens` explicitly to one of these brackets:

| Bracket | `maxCompletionTokens` | Use for |
|---|---|---|
| **Tiny** | `2000` (the default) | Short structured outputs only — JSON metadata extraction (`L1_SAVE`), title-and-category derivation (`L3` step 1), single-line decisions |
| **Standard** | `8000` | Long Japanese prose (>500 visible chars). All article-body generation: L2 explanations (~3000字), L3 insights (~3000–4000字), panel-member synthesis |
| **Heavy** | `16000` | Reserved for future panel-aggregation or multi-section reports. Not currently used. |

## Why brackets and not "size to your prompt"

`gpt-5.4` is a reasoning-family deployment. The `max_completion_tokens` budget covers **reasoning + visible output combined**, and the split is opaque to us. With 2000 tokens, the hidden reasoning consumed most of the budget and Japanese visible output ran out partway through. With 8000, there's enough headroom that finishing the article never competes with reasoning for tokens.

Brackets are easier to enforce than per-call tuning: any new call site picks one of three numbers; reviewers don't need to predict reasoning depth.

## Mechanical guard

`azureGenerateText` throws on `finish_reason === 'length'` (Code.gs lines around `if (reason === 'length')`). This means an undersized budget surfaces as a thrown error immediately, not as a silently-truncated published article. The L2/L3 batch wrappers swallow per-row errors and stamp `LAST_RUN_AT` only on success, so a length-throw causes the next cron tick to retry — better than publishing partial content.

This guard is the runtime expression of the rule above. **Do not catch and ignore it.** If you find yourself wanting to, the right fix is to bump the bracket.

## Adding a new call site

1. Pick the bracket from the table.
2. Pass `maxCompletionTokens` explicitly even when you mean the default:
   ```js
   azureGenerateText(prompt, key, { maxCompletionTokens: 2000 });  // tiny
   ```
3. If you used Standard or Heavy, leave a one-line code comment naming the visible-output target ("~3000字 Japanese") so the next reader sees why.
4. PR description must cite this doc when introducing a non-default budget.

## Verification

After deploying a new call site, run the `gas-deploy-verify` skill. After running it for the first time on real input, check the GAS execution log (Apps Script editor → Executions) for any `Azure OpenAI hit max_completion_tokens` error. If you see it, you under-budgeted; bump the bracket.

For a global view of which articles slipped through truncated, run the `article-health` skill — it scans gh-pages for the symptom.
