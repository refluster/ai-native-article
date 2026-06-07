# `.githooks/` — local CI mirror

These hooks run a subset of the CI gates at `git push` time, so the cheap,
deterministic failures surface before you open a PR instead of after. Pattern
imported from [mononaware's `.githooks/`](../../mononaware/.githooks/README.md).

## Install (one-time per clone)

```sh
git config core.hooksPath .githooks
```

## What runs

| Hook | When | Gates | Why not the rest |
|---|---|---|---|
| `pre-push` | `git push` | R-1 (GAS manifest), R-2 (design tokens), R-12 (governance registries) | Fast, no network, no build. |

Gates intentionally **not** mirrored:

- **R-10 (corpus truncation)** needs a fresh `fetch-notion` (Notion credential) — CI/deploy only.
- **R-11 (L1 citation)** needs a PR body — CI only.
- **The build / workforce / Lambda checks** are slow; they stay in CI to keep `git push` snappy.

## Bypass

```sh
git push --no-verify
```

Use sparingly — CI re-runs every gate and will reject a bypassed push that breaks one.

## Keeping the mirror honest

When you add or change a fast gate in `.github/workflows/ci.yml`, mirror it here
(or deliberately decide not to, and note why above). A drifted mirror is worse
than no mirror — it teaches you to trust a green local run that CI then rejects.
