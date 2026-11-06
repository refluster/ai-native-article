# S2 ワークプラン — 第 2 報

## 座席 (lens → persona)

| Lens | Persona | 役割 | 段階 |
|---|---|---|---|
| 議長 / 戦略仮説 | **maya** (President) | day-one answer、予測 10 本の起草と撤回、統括答え | S1, S4, S5, S9 |
| ゲート運用 | **margaux** | S0–S11 の運用、G 判定 | 全段階 |
| 研究基準 | **beatriz** | 引用・確度・証拠階層 | G3, G6, G9 |
| 投資委員会 / リアルオプション | **arjun** | 段階投資、期待損失、賭けの規律 (I-4.2, I-7) | S3 (WS4), S8 |
| 市場・価格 | **sofia** | 誰が払い、いくらか (I-2) | S3 (WS2) |
| 景観 | **bruno** | 実企業の事例と反例、ベンダ価格 (I-2, I-3) | S3 (WS2/WS3) |
| 財務 | **silas** | 容量計画・Jevons・支出 (I-6.3, I-7) | S3 (WS5) |
| 組織分析 | **tomas** | 内部一次証拠の数値化 (I-5.2)、同型/異質の棚卸し | S3 (WS3) |
| org-as-product | **nico** | 「場」の物語と位置づけ (I-6) | S5 |
| エージェント体験 | **freya** | 複製・記憶・同一性の異質性 (I-1.3) | S3 (WS1) |
| 自動化と説明責任 | **petra** | 「自動化が走った」と「人が責任を負う」の境界 (I-4.3, I-5.3) | S3 (WS4), S8 |
| 研究員 (breadth) | **sora** | I-1 の実測 (METR、Economic Index、推論時スケーリング) | S3 (WS1) |
| 日本 | **haruto** | I-8 | S3 (WS6) |
| 行動科学 | **clara** | 置換の摩擦、人間側の受容 (S8) | S8 |
| ファクトチェック | **nikhil** + **owen** | S7 | S7 |
| レッドチーム | **rafael** | 代替仮説、過剰主張、HILP | S8 |
| 判定スキーマ | **dalia** | 予測の形式 (日付・蓋然性・反証条件) の統一 | S4 |
| 編集 | **ingrid** · 表記 **oksana** | S6, S9 | S6, S9 |
| 読者体験 / ビルド | **aoi** · **yusuf** | S10 | S10 |

座らない lens: 規制 (levi/tessa) — 第 1 報で扱い済み、本報は内部引用のみ。電力系 desk は表面なし。

## ワークストリーム

| WS | 担当 | 仮説 | 一次資料の種別 | 探索予算 |
|---|---|---|---|---|
| WS1 構造的異質性の実測 | sora + freya | H-1.1–1.4 | METR、Epoch、Anthropic Economic Index、arXiv (推論時スケーリング)、ベンダ製品文書 | 12 |
| WS2 as-a-service と価格 | sofia + bruno | H-2.1–2.3 | ベンダ価格ページ・プレスリリース、VC 調査、BPO 市場統計 | 12 |
| WS3 実企業の置換と組織の境界 | bruno + tomas | H-3.1–3.3, H-5.1–5.2 | 企業メモ全文・決算資料、Coase/Williamson、WTI 2025、内部文書 (AGENTS.md、governance、ROADMAP) | 12 |
| WS4 投機的執行とその限界 | arjun + petra | H-4.1–4.3, H-5.3 | arXiv (Park 2024、best-of-n、AI Scientist、model collapse)、agentic misalignment 研究、リアルオプション | 12 |
| WS5 場の形成・容量・先行投資 | silas (+ nico) | H-6.1–6.3, H-7.1–7.3 | Unilever/Gloat、FinOps for AI、Jevons (Nadella)、eval ガイド、CVC 統計 | 12 |
| WS6 日本 | haruto | H-8.1–8.2 | 人口推計、TDB 人手不足倒産、JILPT、JUAS (第 1 報) | 8 |

内部一次証拠: 第 1 報の台帳 (`../202611-ai-era-it-dept-investment/sources/register.md`) は **S-0.x** として引用可 (再調査しない)。本ワークフォースの統治文書・実績は S-9.x (内部) として WS3 が登録する。S-ID は `S-N.k` で WS が採番。

## ゲート運用

第 1 報の `process/process-design.md` のゲート表を継承。追加の規律 (第 1 報の教訓 L1–L4): (1) 統括答えの各句に仮説 ID と確度を対応づける (G5)、(2) 本文の数値 ↔ 図 DATA の照合を S6 で走らせる、(3) 図は本文 1 万字あたり 3 点を目安、(4) FIG の type は `build/figures.mjs` の既存 type のみ (stat-tiles, hbars, grouped-bars, stacked-hbar, dumbbell, line, dual-line, timeline, matrix, table, roadmap, gated-roadmap, process, diagram, principle-diagram, two-layer, mapping, tree, verdicts, small-multiples-bar)。
