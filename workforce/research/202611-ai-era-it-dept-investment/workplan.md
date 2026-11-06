# S2 ワークプラン (workplan)

## 座席 (lens → persona) — G2

ロスターは 2026-11-04 に `GET /agents` (69 名、paused/archived なし) で確認。熟議の参加者 (mateo / freya / anjali / yuki) は **当事者**として仮説の提出者に回り、判定は別の座席が行う (自己採点を避ける熟議自身の規律 D4 に従う)。

| Lens | Persona | 役割 | 段階 |
|---|---|---|---|
| 研究リード / engagement manager (chair) | **margaux** (Client Studies Office) | 与件→三条件と kill line、S0–S11 の運用、ゲート判定 | 全段階 |
| 研究基準の監督 | **beatriz** (VP Research) | 引用・確度語・証拠階層の基準、open-question ledger | G3, G6, G9 |
| Client value / so-what | **nadia** (PM) | 各 key message の so-what 署名、次の意思決定を安くする | S5, S10 |
| 日本企業の意思決定翻訳 | **haruto** | 稟議・予算線・部門 go/no-go への翻訳、I-8 | S4, S5, S9 |
| WS1 基盤・セキュリティ・権限 (I-2, I-4) | **sora** (AI-native product research) | 分析、agent security / identity / HITL の一次資料 | S3–S4 |
| WS2 アドバイザリ・市場景観 (I-1) | **bruno** (landscape cartographer) | Gartner/Forrester/IDC/McKinsey の提言の地図化、コモディティ化データ | S3–S4 |
| WS3 迂回コスト・経済性・費用負担 (I-3, I-5.2–5.3, I-2.3) | **anjali**(提出者) の仮説を **pranav** (quant model) + **silas** (財務) が検証 | 数値の抽出、FinOps・chargeback、shadow AI 推計 | S3–S4 |
| WS4 スキル再利用・エージェント体験・記憶 (I-5.1, 5.4, 5.5) | **sana** (skill maturity) + **freya**(提出者) | 再利用単位、成熟度判定、記憶/同一性研究 | S3–S4 |
| WS5 データ・知識資産とコモディティ化 (I-6) | **tobias** (data) + **tariq** (knowledge system) + **linnea** (confounds) | RAG vs fine-tune、比較実験の設計、固有資産 | S3–S4 |
| WS6 制度・規制 (I-7) | **levi** (product counsel) + **tessa** (policy) | EU AI Act / ISO 42001 / NIST / 日本法・ガイドライン | S3–S4 |
| WS7 現場の言葉・行動科学 (I-3.3, I-4.3) | **yuki**(提出者) + **clara** (behavioural science) | 承認疲れ、信頼、現場の一文 | S3–S4 |
| ファクトバンク / 表記統一 | **oksana** | value · unit · period · S-x.y · grade の一表、S9 で grep 照合 | S3, S9 |
| 独立ファクトチェック | **nikhil** (書かなかった座席) + **owen** | A 級数値の一次資料再開封 | S7 |
| レッドチーム | **rafael** | 反証の試み、代替仮説、key assumptions check | S8 |
| 判定スキーマ | **dalia** | 判定語の一貫性、採用/保留/却下の形式 | S4, S8 |
| 編集 (W-1) | **ingrid** | ピラミッド構造、答え先行、限界章 | S5, S6, S9 |
| 読者体験・図表 | **aoi** | 読者別参照、図表の情報設計、両テーマ可読性 | S10 |
| ビルド | **yusuf** | markdown → 自己完結 HTML、公開前チェック | S10 |
| 人間にしか閉じられない問い | **ines** | operator への一頁の問い (U1, U4 など) | S11 |

座らなかった lens: 市場戦略 (sofia)・消費者 (sneha)・電力系 (amara, grace, vikram) — 本件に表面なし。platform 当事者 mateo は提出者として記録し、判定には座らない。

## 実行形態 (正直な記載)

全段階は本セッション内で operator (Claude) がサブエージェント (Opus 5.5) に各座席を役割演技させて実行する。ワークフォースが自律で発火したものではない。実績 (engagement) 登録は `engagements.jsonl` に staged し、operator が `log-workforce-engagements` で登録する (engagement 書き込みトークンは本セッションに無い)。

## ワークストリーム → 仮説 → 一次資料種別

| WS | 担当 | 仮説 | 一次資料の種別 (≥2) | 探索予算 |
|---|---|---|---|---|
| WS1 | sora | H-2.1, H-2.2, H-4.1, H-4.2 | 標準 (OWASP, NIST, ISO, MCP spec)・ベンダ公式セキュリティ文書・公表インシデント | 検索 12 回 |
| WS2 | bruno | H-1.1, H-1.2, H-1.3 | アドバイザリのプレスリリース/公式要約・学術 (AI Index)・企業調査 | 検索 12 回 |
| WS3 | pranav + silas | H-2.3, H-3.1, H-3.2, H-3.3, H-5.2, H-5.3 | 業界調査 (Microsoft WTI, IBM, Cyberhaven, Netskope)・FinOps Foundation・MIT/McKinsey | 検索 14 回 |
| WS4 | sana + freya | H-5.1, H-5.4, H-5.5 | ベンダ製品文書・学術論文 (memory)・Gartner 推計 | 検索 10 回 |
| WS5 | tobias + tariq + linnea | H-6.1, H-6.2, H-6.3 | 学術論文 (arXiv/SSRN/Science)・企業実験 | 検索 10 回 |
| WS6 | levi + tessa | H-7.1, H-7.2 | 法令本文 (EUR-Lex, e-Gov)・標準・官庁ガイドライン | 検索 10 回 |
| WS7 | yuki + clara | H-4.3, H-3.3 (現場側) | DORA 報告書・HCI/自動化研究 | 検索 8 回 |
| WS8 | haruto | H-8.1, H-8.2 | IPA / JUAS / 総務省白書・Cooper | 検索 8 回 |

内部一次証拠: 熟議ログ (本 PDF) を `[S-0.1]` として登録 (内部・観察)。ワークフォース自身の運用 (Zone-A 線、USD 6/月のエージェント予算、R-N10 autopilot マージ範囲) は `AGENTS.md` / `docs/governance.md` を内部資料として引く。

## ゲート運用

S3 の各 WS は `sources/wsN.md` に G3 形式 (value · unit · period · S-x.y · confidence A/B/C、NOT FOUND を明記) で返す。S-ID は `S-N.k` (N = WS 番号) で各 WS が採番し、lead が `sources/register.md` に統合する。矛盾は `analysis.md` の矛盾ログに集約。
