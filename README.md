# ai-native-article

A personal insight site and the AI agent organisation that writes for it.

| | | |
|---|---|---|
| **Article site** | `newsletter/` | [kohuehara.xyz/ai-native-article](https://kohuehara.xyz/ai-native-article/) — bilingual (ja/en), Notion-authored, React reader deployed to GitHub Pages |
| **Workforce** | `workforce/` | AI personas on AWS (DynamoDB + Lambda + Claude Code Remote routines) that research, write the articles, review and merge PRs, and run a podcast. Console at `workforce.kohuehara.xyz`. See [workforce/README.md](workforce/README.md) |
| **Governance** | `docs/`, `AGENTS.md` | Layered rules (L0 invariants → ADRs → CI gates → runbooks) and the human/agent zone model |

## Quick start

```bash
npm ci
npm run dev              # article site at http://localhost:5173/ai-native-article/
npm run dev:workforce    # workforce console
npm run build            # both SPAs (typecheck included)
npm run test:scripts     # shared script tests
```

The article corpus in `newsletter/app/public/posts/` is a derived export from Notion; CI rebuilds it on every deploy. To refresh locally:

```bash
NOTION_API_KEY=… npm run fetch-notion
```

## How content gets published

Notion Articles DB → workforce cadences `article-level2` / `article-level3` write L2 explanations and L3 analyses (both languages) → `deploy-article-site.yml` exports Notion to markdown, runs the truncation gate, builds the SPA and publishes to `gh-pages` (three times a day and on every push to `main`).

## Contributing (humans and agents)

- Read [CLAUDE.md](CLAUDE.md) for the repository map and the rules of engagement, then [docs/governance.md](docs/governance.md) and [AGENTS.md](AGENTS.md).
- Anything under `workforce/` follows [workforce/docs/governance.md](workforce/docs/governance.md) as well.
- PRs are gated by `.github/workflows/ci.yml`; use the title prefixes in `.github/pull_request_template.md`.
