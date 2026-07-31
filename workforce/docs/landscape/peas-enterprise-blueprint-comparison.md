# ランドスケープ比較 — PEAS Enterprise Blueprint × 当 workforce

- **作成日**: 2026-07-31
- **比較対象**: `The PEAS Enterprise Blueprint v4.1`（他部門の Agentic AI による SaaS 開発プラットフォーム、47 スライド／CarePrevention 再構築の実績報告）
- **比較主体**: 本リポジトリ `refluster/ai-native-article` の `workforce/` サブシステム
- **性格**: 分析メモ（informs, never decides）。ここでの「差異」は *decision か gap か* を明示するが、標準化の採否は operator と該当 VP が決める。エコシステム分析シート（`workforce/seed/ecosystem-landscape/`）の 7 軸を拡張して 18 観点で対置した。
- **当 workforce 側の数値の出所**: **稼働中の AWS 本番環境を直接照会した実測値**（`wf-table-prod` DynamoDB / Lambda / EventBridge / S3 / AWS Budgets、`us-west-2`、2026-07-31 時点）＋ GitHub API。ドキュメント記載値ではない。取得方法とスナップショットは付録 A。**ドキュメントと実測が食い違った箇所は実測を採り、食い違い自体を所見として §19 に記録した。**
- **PEAS 側の数値の出所**: 添付デッキ本文＋スピーカーノートに書かれている事実のみ。デッキに書かれていない挙動は推測せず「不明」と書いた。**当 workforce 側は実測、PEAS 側は自己申告**という非対称がある（§18）。

---

## 0. 一行要約

**PEAS は「AI で*ソフトウェア開発*をやる」ためのプラットフォーム。当 workforce は「AI で*組織*をやる」ための実験で、ソフトウェア開発はその中の一レーンにすぎない。** 両者は Day 1／Day 2 の統制課題では驚くほど同じ結論に独立到達しており、決定的に分岐するのは **人間と機械の境界をどう扱うか**（固定した憲章 vs 計測して動かす変数）と **組織の対象範囲**（SDLC 職能 vs 会社機能）である。

そして実測して初めて分かったことが 3 つある — **(a)** 当 workforce の自律マージ率は文書がベースラインとする 2.8% ではなく**直近 28 日で 21.5%** に達している、**(b)** 全 141 バインディングが Claude Code routine 面で走っており **Lambda 既定という文書上の設計はすでに反転している**、**(c)** その帰結として **W-3 コスト上限のコール地点強制は現在の主実行面では実質的に効いていない**（§8・§19）。

---

## 1. 存在目的 — なぜその組織があるか

| | PEAS | workforce |
|---|---|---|
| 成立の由来 | 上位命令（Mission Directive）：「DCD 内で初めて AI 駆動開発による外注コスト削減を実証せよ」 | 個人サイトの記事パイプライン運用から自生。MVV が後から制定された |
| 成功の定義 | 第三者部門 SAC が Axis 2（品質・正確性）を独立検証し、Axis 1（生産性）の実測値と併せて評価する | 「human-agent co-creation の operating model を作れたか」。検証者は operator 一人＋公開記事の読者反応 |
| 題材 | CarePrevention（予防ケア、Fitbit／LINE／日本語高齢者 UX）の作り直し。**題材は使い捨て、フレームワークが成果物**（"The framework travels. The domain does not."） | kohuehara.xyz の記事・Podcast、および外部プロジェクト（`asp-cloud` / `project-ind` / `conference`）。**題材も組織も両方が成果物** |
| 対外的主張 | 「外注より安い」という ROI の証明 | 「機関（institution）の運転モデル」というカテゴリ主張（MVV §External positioning） |

**考察.** PEAS は *証明のための組織*である。証明対象（コスト削減）が外から与えられ、期限（6 週）と審査員（SAC）がある。当 workforce は *発明のための組織*で、何を証明すべきかを自分で仮説として立てて月次レポートで検証する（仮説一〜五 → Epic-019/020/022/023）。この違いが以下ほぼ全ての差の源流になっている。

---

## 2. 組織構成 — エージェントは「工程」か「従業員」か

**PEAS: 3 層 12 エージェント、モデル階層が意図的**

```
Humans (4)  ─ 全 3 層の上に立つ
  Tier 1  Conductor    : Orchestrator (Opus)            1
  Tier 2  Guardians    : Code-Reviewer / Security-Engineer / Agentic-AI-Security (Opus)  3
  Tier 3  Implementers : Backend / Frontend / DB / Mobile / Platform / Test / OTel / Grafana (Sonnet)  8
  + /document コマンド (Haiku) — これは「エージェントではなくコマンド」と明示
```

役割名はすべて **SDLC の職能**。エージェントに固有名・履歴・所属はなく、`.claude/agents/*.md` の定義ファイルそのものが実体。

**workforce: 54 ペルソナ（実測）、企業の組織図そのもの**

`wf-table-prod` の `AGENT#*/META` 行を全走査した実数は **54**（archived 0 / paused 0）。内訳（実測）:

| 実測項目 | 値 |
|---|---|
| ペルソナ総数 | **54** |
| モデル配分 | `claude-sonnet-4-6` **47** / `claude-haiku-4-5` **6** / `claude-opus-4-7` **1**（maya のみ） |
| 居住地の国数 | **25 か国**（IN 8, US 7, UK 4, DK 3, CA 3, SG/PT/JP/DE/SE/MX/NG 各 2 …） |
| 宣言された月次予算合計 | **USD 321/月**（W-3 上限 500 に対して） |
| バインディング（定期業務の紐付け）総数 | **141**（1 人あたり 1〜5、最頻 2） |
| 組織の最上位 | `maya`（President、`reports_to` 空）。VP 8 名が直属 |

VP 層（実測の `reports_to` エッジ）: `mateo`（Agent Workforce Platform）/ `dario`（Engineering Excellence）/ `priya`（People & Legal）/ `elena`（Customer Experience）/ `tessa`（Policy & Government Affairs）/ `silas`（Finance & Capital Strategy）/ `celeste`（Marketing & External Communications）/ `beatriz`（Research）/ `petra`（Operations & Reliability）。さらに `anjali`（India Energy Desk）/ `corinne`（IR）/ `ingrid`（Managing Editor）が二段目の管理職として部下を持つ。

各ペルソナは **slug・姓名・役職・居住地・上司・使用モデル・月次予算・prompt_version・identity_hash・semantic memory 本文・JD（mission / key_responsibilities）・guardrails** を保持する（`AGENT#maya/META` 実物で確認）。増員は **採用ラウンド**として `workforce/docs/hires/*.md` に稟議メモ（政策・パネル・コスト査定・未解決論点）が残る。

| 観点 | PEAS | workforce（実測） |
|---|---|---|
| 分業の軸 | 開発工程（function-of-SDLC） | 会社機能（function-of-company） |
| エージェントの人格 | なし（役割 = 定義ファイル） | あり（姓名・居住地・予算・記憶・上司・JD・guardrail） |
| 階層 | 3 層 + 人間 | President → VP 9 → 二次管理職 → IC の多段。人間は憲法層のみ |
| モデル階層 | 判断=Opus(4) / 実装=Sonnet(8) / 雑務=Haiku。**判断層が厚い** | Opus は President 1 名のみ、実務は Sonnet 47、軽量職 Haiku 6。**判断層が薄い** |
| 増員の手続き | ロスターへの追加 | 採用ラウンド稟議 → W-3 予算改正表に 1 行 → operator 承認 |
| 数 | 12（固定・O(1) 設計） | **54**（増加中。全 Epic に「Behaviour at N = 100+ agents」節が必須） |

**考察.** PEAS のエージェントは *道具の名前*、workforce のそれは *従業員の名前*。人格があるからこそ workforce は実績台帳・信頼階梯（Epic-023）・アイドル検知・月次評価といった *人事的*機構を持てるし、持たざるを得ない。PEAS は人格を持たないので統制はすべて *工程上のゲート*として表現される。

**実測して見えた非自明な差**: PEAS は 12 体中 4 体（33%）を Opus に置き「判断は高いモデルで」を明示的なコスト設計にしている。当 workforce は 54 体中 1 体（2%）。つまり **workforce は判断の質をモデル階層ではなく*組織構造*（複数レンズのレビューパネル・合議・RFC）で担保している**。同じ問題への異なる解であり、これは decision と読める（ただしコスト効率の検証はしていない — §16.3）。

---

## 3. 業務スコープ — 実測した稼働実績

**PEAS**: 単一プロダクトの SDLC 全域 + Day 2 運用（13 Terraform モジュール、OTel/Tempo/Grafana/VictoriaMetrics、SLO burn alert、runbook、k6 負荷試験）。

**workforce**: 実行台帳 `PROJECT#*/EXEC#*` の全走査で **5,839 回の実行**（2026-05 以降）。

| 月 | 実行数 | ok | skipped | throw |
|---|---|---|---|---|
| 2026-05 | 106 | 106 (100%) | 0 | 0 |
| 2026-06 | 1,974 | 1,081 (55%) | 887 | 6 |
| 2026-07 | 3,759 | 3,221 (86%) | 484 | 54 |
| **計** | **5,839** | **4,408** | **1,371** | **60** |

実行スキル（実測、上位）: `feed-post` 2,156 / `daily-research` 1,801 / **`pr-autopilot` 437** / `discord-heartbeat` 333 / `article-level2` 210 / `article-level3` 209 / `discord-ping` 173 / `pr-review` 103 / `grid-watch` 48 / `india-grid-watch` 45 / `legal-amendment-review-committee` 39 / `podcast-script` 39 / `backlog-reconcile` 38 / `podcast-publish` 34 …… **歴代 62 スキルが実際に発火**（うち `pr-review` / `pr-route` / `discord-ping` / `org-design-roundtable` / `weekly-report-panel` は現在は統廃合済み）。

スキル登録簿（実測）: DDB に **49 スキル**（active 48 / stale 1）、git に 36 フォルダ。プロジェクト別行数: `agent-workforce` 5,287 / `asp-cloud` 309 / `project-ind` 74 / `conference` 16 ＋ `self/{slug}` 20 個。

**考察.** PEAS のスコープ = workforce の「SDLC レーン」1 本、という包含関係に見えるが、深さは逆転している。PEAS の SDLC 1 本は workforce の SDLC 1 本より遥かに深い。workforce は幅を、PEAS は深さを取った。**これは gap であって decision ではない** — workforce の SDLC レーンが PEAS 並みの決定論的検証を持たないのは意図的選択ではなく未着手（§16.3）。

なお実測で見えた重要な事実として、**`skipped` が 1,371 件（全体の 23%）ある**。これは「判断して今回は何もしない」を成功として記録する設計（ML-013 が『全 skip の縮退定常状態』を失敗モードとして登録済み）で、PEAS 側に対応概念は見当たらない。定期発火型の組織に固有の問題であり、**PEAS が cadence 化に進めば必ず遭遇する**。

---

## 4. 実行基盤 — 実測で判明した「文書と現実のずれ」

**PEAS**: すべてがリポジトリ資産。`.claude/agents/`（12 定義）、`.claude/commands/`、hooks、`knowledge/`、`docs/`、`src/`、`worktrees/`。Claude Code + Jira MCP + GitHub Cloud + AWS。git worktree で機能ごとに隔離。`justfile` が単一タスクインターフェース。**オーケストレータは人間が起動する（デーモンではない）**とデッキが明言。

**workforce（実測）**: 稼働中の AWS は以下。

| 実測項目 | 値 |
|---|---|
| DynamoDB | `wf-table-prod`（**10,139 items / 9.5 MB / GSI 4 本**）＋ dev 3 テーブル |
| Lambda（wf-*） | **15 関数** — `orchestrator` `agents-api` `credentials-api` `audit` `config-digest` `memory-compactor` `performance-reducer` `podcast` `messaging-reply` `seed-skills` `l1-source-register` `backfill-tasks` `migrate-credentials` `pre-signup` ほか |
| EventBridge ルール（wf-*） | **5 本すべて ENABLED** — `orchestrator-tick`（rate 2h）/ `audit-tick`（毎日 04:00）/ `config-digest-tick`（毎週月 00:30）/ `memory-compactor-tick`（毎日 05:00）/ `performance-reducer-tick`（毎日 02:00） |
| S3 | `wf-bucket-…-prod`（`exports/ memory/ messages/ podcast/ posts/ projects/ runs/`）＋ `wf-web-…-prod`（CloudFront 配信の SPA） |
| **バインディング 141 本の実行面** | **`claude-code-routine` = 141（100%）**、scheduler は全件 `external` |
| **実行台帳の実行面** | `ccr` **5,485** / `client` 173 / 不明 181 |

**ここが最大の実測所見**: `workforce/docs/architecture.md` と R-N1 は「エージェントの推論は既定で AWS Lambda、CCR は宣言された例外」と書いているが、**実際には例外が主経路になっており、Lambda 面での推論実行は 0 本**である。残る 15 Lambda はすべて *決定論的なインフラ*（オーケストレーション・監査・ダイジェスト・メモリ圧縮・分析集計・Podcast 合成・API）であって、判断はしていない。ADR-0005（single execution model CCR）が事実上 R-N1 の既定を置き換えた形で、**文書上の "既定と例外" が現実と逆転している**（§19 に所見として記録）。

| | PEAS | workforce（実測） |
|---|---|---|
| 実行の起点 | 人間がセッションを開始（`/orchestrate [TICKET]`） | EventBridge `orchestrator-tick`（2 時間ごと）＋ GitHub event。人間不在でも回る |
| 推論の実行面 | Claude Code（ローカル/セッション） | **Claude Code routine（CCR）100%**。Lambda は決定論的処理のみ |
| エージェント定義の真実の在り処 | **git のファイル**（`.claude/agents/`）。履歴 = 監査証跡 | **DynamoDB の `AGENT#{slug}/META` 行**（ADR-0007、実測 54 行）。git ツリーは凍結。監査は append-only の `AUDIT#` 行（実測 **267 行**）＋ 週次 config ダイジェスト Lambda |
| 隔離 | git worktree（機能単位） | Project（信頼境界、scoped credential ＋ EXEC 台帳 ＋ S3 prefix、実測 4 実プロジェクト + 20 self） |
| 単一インターフェース | `justfile`（`just check` = CI と同じゲートをローカルで） | なし（skill ごとの bundled write-script） |

**考察.** PEAS は「リポジトリを開けば組織の全部が読める」— 可搬性が高く、他部門への配布（Adoption Guide）に最適化。workforce は「組織は稼働中のサービスであり、設定はデータベースにある」— 人間不在で自走することに最適化。PEAS が「オーケストレータはデーモンではない」を *NOT YET BUILT* に挙げているのは示唆的で、workforce はまさにそこを先に作り、代わりに可搬性を捨てた。

両者は「自前のエージェントフレームワークは作らない」で完全に一致する（PEAS ロードマップ 02 の可搬な `~/.claude/` ／ workforce design-policy D-3）。しかも実測で見ると **両者とも最終的に Claude Code を推論面として選んでいる** — PEAS はセッションとして、workforce は routine として。同じ基板の異なる駆動方式。

---

## 5. GitHub Actions — workforce だけが持つ「第 3 の実行面」

PEAS の CI は **品質ゲート専用**である（デッキのゲート表：repo/workflow hygiene・build & tests・coverage & knowledge・policy & IaC・observability & SLO・stack smoke。すべて「PR に対して走る検査」）。

当 workforce の GitHub Actions は **12 ワークフロー**（実測）あり、うち品質ゲートは 1 本だけで、残りは **デプロイ面と業務そのもの**である。

### (a) 品質ゲート — `ci.yml`（PR ごと）

実測 15 ステップ。うち**大半が本プロジェクト固有の統治ゲート**:

| ステップ | 何を守るか |
|---|---|
| Typecheck + build | R-8 |
| Design-token lint | R-2 |
| **Governance registries (R-12)** | memory-lint backlog と risk-acceptance ledger が機械可読であること |
| **L1 citation gate (R-11)** | L1 法令を触る PR は、その法令を引用するか `RULE-N/A:` を書くこと |
| Workforce naming lint (R-N7) | 命名規約 |
| Workforce skill schema / skill registry freshness | スキル定義と自動生成レジストリの同期 |
| **Workforce client skill-spec drift (Dario L2-1)** | 配布先クライアントのスキル仕様ドリフト |
| Workforce skill-body version-bump gate (ADR-0017) | SKILL.md 更新は meta.json のバージョンも上げること |
| **Workforce OpenAPI spec-route drift (PR #305 / Mateo M1)** | API 仕様と実ルートの乖離 |
| **Workforce scan-drain guard (Dario L2 / FU-PROJ-SCAN)** | スキャンの取りこぼし |
| **Workforce W-4 cycle-cap guard (FU-004)** | レビュー往復の上限超過 |
| **Workforce ML-009 escalation-label guard (OP-010)** | 人間へのエスカレーションが必ずラベルを伴うこと |
| Workforce Lambda typecheck / unit tests | 実装 |

### (b) デプロイ面

`deploy-article-site.yml`（push + 1 日 3 回 cron 06:17/12:17/18:17 — Notion 取得 → **R-10 コーパス truncation ゲート** → sitemap → gh-pages）、`deploy-workforce-console.yml`（CloudFront）、`deploy-workforce-data-plane.yml`（SAM、GitHub OIDC → IAM ロール、ゲート無し自動ロールアウト）。

### (c) **業務そのもの** — ここが PEAS に存在しない層

| ワークフロー | スケジュール | 業務内容 |
|---|---|---|
| `workforce-pr-terminal-sweep.yml` | 毎日 04:47 | **R-13**: 全 PR が merged か escalated のどちらかの終端状態にあることを保証。滞留を自動エスカレーション |
| `podcast-pipeline.yml` | 毎日 18:37 | Podcast の音声合成 + 配信（承認ゲート付き） |
| `weekly-content-insights.yml` | 毎週月 02:00 | GA4 読者行動を公開マニフェストに結合し、triage issue を 1 本立てる |
| `check-workforce-api-routes.yml` | 毎日 08:17 | API ルートのドリフト検知（「盲点」ゲート） |
| `workforce-curate-agent-memory.yml` | 手動 | ペルソナの長期記憶キュレーションを agents-api 経由で書き込み |
| `workforce-record-engagement.yml` | 手動 | Track Record（実績台帳）への記録 |
| `workforce-restore-agent-profile-fields.yml` | 手動 | OP-008 のプロフィール欠損復旧 |
| `workforce-engineer-routine.yml` | dispatch | R-N1(a) 例外：Ren のコード実行経路 |

**考察.** ここは**構造的な差**である。

- **PEAS の CI = 検査官。** PR に対して「通す／落とす」しか行わない。
- **workforce の CI = 検査官 ＋ スケジューラ ＋ 業務執行者。** 決定論的な組織運営（PR の終端状態掃引、Podcast 配信、読者分析、台帳書き込み、記憶キュレーション、ドリフト巡回）が GitHub Actions 上で走っている。

つまり workforce は **CCR（判断）/ Lambda（決定論的データ処理）/ GitHub Actions（決定論的リポジトリ・公開系操作）** の 3 面構成で、R-N1 が列挙する `lambda` / `claude-code-routine` / `gha` / `cli` という実行面の分類はまさにこの現実を写している。PEAS は 1 面（Claude Code セッション）＋ CI という 1.5 面構成。

**PEAS が cadence 化（定期業務）に進むなら、この「CI を業務執行面としても使う」パターンはそのまま移植できる** — 新しいインフラを一切増やさずに、決定論的な定期業務を安全な監査面に載せられる（design-policy D-3 の external-substrate 思想の具体例）。

---

## 6. この機械を作ったのは誰か — 統治機構そのものがエージェント成果物である

これは PEAS のデッキに対応する記述が見当たらない、当 workforce 固有の性質である。

**実測（`PERF#workforce/PR`、window 2026-04-27〜07-26）**:

- リポジトリ全体で **525 PR**。うち **エージェント・ペルソナ名義が 119 本**（dario 37 / nadia 26 / ren 17 / mateo 13 / aoi 6 / maya 4 / hana 3 / freya 3 / elena 2 / sana 2 / tomas・owen・grace・mei・levi・idris 各 1）、`refluster`（operator セッション）名義 403 本、`claude[bot]` 3 本。
- 外部委任先 `asp-cloud` では 342 PR 中 18 本がエージェント名義。

**そして、その成果物には統治機構そのものが含まれる。** CI ステップ名に発見者のペルソナ名が焼き込まれている:

- `Workforce client skill-spec drift (Dario L2-1)` — VP Engineering Excellence のレビュー指摘 L2-1 が、そのまま CI ゲートになった
- `Workforce scan-drain guard (Dario L2 / FU-PROJ-SCAN)` — 同上
- `Workforce OpenAPI spec-route drift (PR #305 / Mateo M1)` — VP Platform の指摘 M1

**ratchet（再発 → 機械ゲート昇格）が PR タイトルとして観測できる**:

- PR #363 `governance: promote ML-009 (accepted) + add escalation-label guard lint` — 本文に「ML-009 は #358 で 1 回目、#362 で同日 2 回目。**2 回目は §6.1 memory→lint ratchet の昇格トリガー**」と明記され、その PR が `check-escalation-labels.mjs` を新設している。
- PR #371 `L2(workforce): FU-004 cycle-count CI lint (W-4 hard cap enforcement)`
- PR #240 `L2(workforce): skill-spec drift CI lint (Dario L2-1 follow-up from #230)`
- PR #446 `L2: wire W-4 cycle-cap + ML-009 escalation-label guards into CI (FU-004 / OP-010)`

現在の登記簿の実測値は **memory-lint backlog 15 行（ML-001〜ML-015）／ risk-acceptance ledger 3 行（RAL-001〜003）**。ML-001（記事の truncation）から ML-015（未プロビジョニングの認証情報）まで、すべて実際に起きた失敗の記録であり、複数が CI ゲートに昇格済み。

**そして最も重要な境界の実例が PR #363 に書かれている**:

> Remaining (Zone A — operator): 「lint を*強制に組み込む*こと — `check` ワークフローのステップ化 or daily `wf-audit` Lambda への配線 — は `.github/workflows/**` / Lambda IAM（Zone A / L0/L1）に触るので、ML-009 の `Promoted via` セルに operator 承認待ちとして記録した。スクリプトと npm target は配線可能な状態にしてある。」

**つまり実運用上の人間／機械の境界は「エージェントがガードを書き、人間がそれを装填する」という形で機能している。** エージェントは自分を縛るルールを設計・実装・検証まで行うが、それを*有効化*する行為だけは Zone A として人間に残る。これは §6 で述べる境界設計が、抽象論ではなく実際の PR 単位で守られていることの証拠である。

**PEAS への含意**: PEAS の loop governor は「社内セキュリティ監査が終了条件もコスト上限も無いと指摘したので追加した」とデッキが率直に書いている。これは**当 workforce の ratchet が自動化している経路を手動で 1 回通した**ものに相当する。指摘 → 登記簿 → 2 回目で機械ゲート、という経路を制度化すれば、同じことが監査を待たずに起きる。

---

## 7. ガバナンス思想 — 工学的ガードレール群 vs 成文法体系

**PEAS の骨格: 「8 つの壁」と structural gate.** Day 1（コードを信頼できるようにする）4 つ、Day 2（3 年間所有し続ける）4 つ。Wall 8「安全チェックがオフにされたまま戻らない」への回答は「ゲート設定をファイルとして保存し PR で変更する。CI は CI 自身の設定もチェックする」。スピーカーノートの一節:

> *"AI agents do not create new kinds of failure. They remove the slow steps that used to catch these problems early. So the control must be built into the system, not into team culture."*

**workforce の骨格: 4 層の法体系.**

- **L0 憲法** C-1〜C-4 ＋ W-1〜W-5。改正は operator のみ。
- **L1 framework laws** — statute doc 群 ＋ **ADR 25 本**（workforce 21・root 4）。ADR は append-only、覆すときは *supersede*。
- **L2 regulations** R-1〜R-13 の機械的ゲート。**番号は再利用しない**（廃止された枠も残り、過去の provenance が解決できる）。
- **L3 runbooks** — skill の SKILL.md がそのまま runbook。
- ＋ **Zone A/B/C/D** 所有権モデル、**memory→lint ratchet**、**risk-acceptance ledger**。

### PEAS の 8 つの壁 × workforce の対応物（全対応する）

| # | PEAS の壁 | PEAS の答え | workforce の対応物 |
|---|---|---|---|
| 1 | 要求が曖昧なまま作り始める | チケットごとに承認済みチェックリスト（Gherkin AC） | Epic → RFC パネル → Acceptance criteria ＋ **Falsifier**、`code-task-brief` skill |
| 2 | エージェントが自分の仕事を検査する | 別エージェントがレビュー、人間がマージ承認 | `pr-autopilot` の **≥3 ペルソナ・レンズパネル**（実測 437 回発火）＋ judge≠generator ＋ model disjointness |
| 3 | 無限リトライとコスト膨張 | round cap 2 / dispatch budget 2× | `cycle_cap` ＋ **W-4 cycle-cap CI ガード**（FU-004）＋ R-13 終端掃引 ＋ W-3 月次上限 |
| 4 | エージェントが過剰な権限を持つ | ツール権限最小化・危険コマンド遮断・鍵の自己発行禁止 | R-N3 単一シークレットストア ＋ Project スコープ認証情報（Epic-010）＋ ADR-0009 scoped capability token ＋ ADR-0021 短命トークン |
| 5 | 知識が人の頭に残る | 決定とルールをリポジトリのファイルに。**コードと文書が食い違えば CI が落ちる** | statute + ADR + 二層メモリ + Epic-022 lesson stream。文書ドリフト側は **R-11 引用ゲート / R-12 登記簿整合 / OpenAPI ルートドリフト / skill-spec ドリフト** |
| 6 | なぜ書かれたか辿れない | ticket→commit→PR→review→deploy を 1 本に | EXEC 台帳（実測 5,839 行）／`RUN#`（490）／`AUDIT#`（267）／engagement 記録／`PERF#` |
| 7 | 誰も支えられないコード | OTel・ログ・メトリクス・アラート・runbook・1 コマンドデプロイ | `runbooks/`、`ops-accountability-watch` cadence、VP Operations & Reliability（`petra`）。**ただし観測は CloudWatch のみ（R-N5）で PEAS より薄い** |
| 8 | 安全チェックが切られたまま | ゲート設定をファイル化、CI が CI 設定を検査 | L2 の *tightening* は自由・*loosening* は operator 承認。**L0/L1 パス集合を定義するブロックが L0/L1 の内側にあり自己拡張不能**。空にすると fail closed（kill switch 兼用） |

**考察.** 8 つすべてに対応物がある。これは PEAS の主張「これは医療の問題ではない（どの部門でも同じ壁）」への強い外部証拠であり、**ドメインも規模も動機も人数も違う 2 組織が同じ 8 つに独立到達している**という事実そのものが所見である。

差は成熟の *形*。PEAS は *チェックリスト*として、workforce は *法体系*として同じものを表現した。workforce が持ち PEAS に見当たらないのは **「ルールの変え方のルール」と「学習が自動的にルールへ昇格する経路」**。逆に PEAS が持ち workforce に薄いのは **ゲートの実効性を担保する決定論的検査の厚み**（§9）と **Wall 7 の観測性**。

---

## 8. コスト・経済 — 実測すると最も差が出た軸

| | PEAS（自己申告） | workforce（AWS 実測） |
|---|---|---|
| 実績 | **$7,215 / 6 週 / 11.48B トークン / キャッシュ効率 93.2%** | **AWS 当月実績 $34.89**（アカウント全体、予算枠 $440）。`wf-budget-prod` は上限 $50 に対し **$0.00** |
| LLM 推論コスト | 上記に含む（測定済み） | **測定されていない** — 実行が CCR 面に移り、推論は operator の Claude アカウントで発生するため workforce からは見えない |
| 宣言された envelope | dispatch budget = 見積の 2 倍 | ペルソナ別月次予算の合計 **USD 321/月**（W-3 上限 500 に対して） |
| 実際の計上 | — | `AGENT#*/META.cost_this_month_usd` は **54 体すべて 0.00**。`BUDGET#{month}` 行は **2 行のみ**（yuki、2026-05/06）で以降更新なし |

**これは実測して初めて分かった重要な所見である。** W-3（コスト上限）は「LLM コール地点で月次上限を超えたら throw する」という設計だが、そのコール地点は Lambda 側の agent-runner にある。**実行が 100% CCR 面に移った結果、コール地点を通らなくなり、W-3 の機械的強制は現在の主経路では働いていない。** 残るのは AWS Budgets（インフラ費用のみ、$50 枠）と operator の Claude アカウント側の請求である。

governance が R-N1(b)（クライアント側実行）について「**W-3 は強制されない — workforce が LLM コールを見ないため。operator がトークンを発行することでこの姿勢を受け入れる**」と明記している通り、これは設計上想定された劣化ではある。ただし当時想定されたのは *外部クライアント経由の一部*であり、実測では **主経路全体**がその姿勢になっている（§19）。

**考察.** PEAS は「$7,215、キャッシュ効率 93.2%、モデル階層が安さの理由」と*測って*主張できる。当 workforce は**測れていない**。これは単なる未実装ではなく、実行面の選択（CCR）が計測面を犠牲にしたトレードオフであり、§16.3 の gap の中で最も構造的なもの。PEAS の **dispatch budget（宣言見積の 2 倍で自動停止）** はタスク粒度の統制なので、月次上限が効かない現状の workforce にとってむしろ相性が良い。

一方 workforce 側だけが持つのは、**コスト上限の引き上げが統治文書の改正表に 1 行として残る**という性質（50→100→130→160→190→250→295→500 の履歴が理由付きで追える）。財務の意思決定が統治と地続きになっている。

---

## 9. 品質保証 — 決定論的検証 vs 審査員パネル

| | PEAS | workforce |
|---|---|---|
| 出力の性質 | コード（テストで真偽が決まる） | 大半が自然言語（記事・レポート・台本・分析）。コードは一部 |
| 第一の武器 | **TDD 強制** — test-engineer が「正しい理由で落ちるテスト」を先に書く。Gherkin AC がチケットに必須 | **multi-candidate × multi-judge パネル** — 生成器 N × 審査員 M（編集／ドメイン／読者）× rubric、加重集計して `chosen` を決定 |
| 自動ゲート | lint／unit・integration・E2E／**カバレッジ床 80%**／doc-drift gate／secrets + SBOM／policy-ci／terraform-check／observability・SLO 検証／compose smoke | 実測 15 ステップの `ci.yml`（§5(a)）＋ R-10 deploy ゲート ＋ W-1 publish ガード（exit 2） |
| 独立第二検査 | code-reviewer は**必ず実装者と別**。明示的 APPROVE 必須。security-engineer と agentic-AI-security（OWASP ASI Top 10）の 2 ガーディアン | `pr-autopilot` が **≥3 ペルソナのレンズパネル**を編成し全員 green が必要（実測 437 回発火・reviewer lens は分離サブエージェントで実行）。記事側は judge ≠ generator ＋ model disjointness |
| 評価基準の所有 | デッキに Zone 概念なし（人間が持つ、と暗黙） | rubric 文言・閾値・パネル名簿・モデルレジストリはすべて **Zone A**。rubric 変更は過去スコアを全無効化するので独立 PR |
| 証拠 | TRACEABILITY-MATRIX.md（63 operations）、テストレポート、Jira 履歴 | 記事ごとの `.eval.json` サイドカー（全候補・全審査員）。**サイドカー無しは publish 不可** |
| 非機能検証 | **k6 負荷試験**（4.74k req/s、p95 66.2ms、error 0.00%、300 VU）でビルドを落とす | 相当物なし |

**考察.** 両者は「**作った者が検査してはならない**」という同一原理を異なる媒体で実装している。差は媒体に由来する必然（記事の良し悪しはテストで決まらない）と、未着手の gap（workforce の SDLC レーンに TDD 強制・カバレッジ床・SBOM が無い）が混在する。PEAS の Quality Gate 表はそのまま standardisation 提案の候補。

---

## 10. トレーサビリティと記録

| PEAS | workforce（実測） |
|---|---|
| Jira ticket → commit → PR → review → deploy が 1 本に | `PROJECT#{id}/EXEC#{ulid}` **5,839 行**、`RUN#` 490、`AUDIT#` 267、`POST#`（内部フィード）3,223、`PERF#` 34 |
| TRACEABILITY-MATRIX.md — 63 operations | Epic ↔ Story ↔ PR ↔ issue の相互参照、`backlog-reconcile` cadence（実測 38 回発火）が定期的に台帳と現実を突き合わせる |
| `/report` が隔週ステータスを自動生成 | 週次プロジェクト報告 ＋ **月次組織レター（公開記事として出す）** ＋ 週次 config ダイジェスト Lambda |
| ADR は `knowledge/decisions/` | ADR 25 ＋ Epic 24 ＋ 採用稟議 ＋ ML 15 行 ＋ RAL 3 行 |

**共通の価値観（ほぼ同文）**: PEAS *"Results first, explanation second. … This presentation is secondary to what is in the repository."* ／ workforce MVV 値 7 *"Output is evidence; feedback is fuel."*

**差**: PEAS のトレースは **プロダクト単位**（要求 → コード → デプロイ）。workforce のトレースは **組織単位**（誰が・何を・どの権限で・どのスキルの何版で）。EXEC 行が `agent_slug` / `skill_name` / `skill_version` / `execution_surface` / `project_id` / `used_credential_types` を持つのは、監査法人ではなく人事・内部統制が見る形である。

---

## 11. 人間と機械の境界 — ここが最大の分岐点

**PEAS: 境界は工程の位置で引かれ、固定されている**
- "Humans own Design, Reviews, and PRs. Agents run implementation instructions."
- **0 self-approved PRs** — 「ポリシーではなく構造的ゲート。バイパス経路は存在しない」
- 人間 4 名は実務者であり承認者。ループガバナ round cap 2 / dispatch budget 2×

**workforce: 境界はパス集合で定義され、計測され、動かされる**
- 人間は **1 人**（operator）で、所有するのは憲法層のみ
- **R-N10「委任マージ」**、しかも **adr-0011 で自リポジトリも外部委任先と同一扱い**（「自分のリポジトリだから慎重に」という特例を*撤廃*した）
- 境界は `docs/governance.md` §4.4 の **`<!-- autopilot:l0l1-paths -->`** という機械可読なパス集合
- そのブロックは `docs/governance.md` 自身にあり、同ファイルは L0/L1 に含まれる → **autopilot は自分の境界を広げられない**。空にすると fail closed
- 実務上の境界は §6 の通り「**エージェントがガードを書き、人間が装填する**」

### 実測: 自律マージ率は文書の 2.8% ではなく 21.5%

`PERF#workforce/PR`（2026-04-27〜07-26、日次実測）:

| 期間 | PR 数 | autopilot merged | 率 |
|---|---|---|---|
| 全期間（91 日） | 406 | 28 | 6.9% |
| **直近 28 日（06-29〜07-26）** | **79** | **17** | **21.5%** |
| 外部委任先 `asp-cloud` 全期間 | 342 | 6 | 1.8% |
| 外部委任先 `asp-cloud` 直近 28 日 | 53 | 0 | 0.0% |

**Epic-019 は「218 PR 中 6 件 = 2.8% を桁で上げる」を仮説としていたが、実測では自リポジトリの直近 28 日で 21.5%（17/79）に達している。** 目標水準（eligible share ≥20%）を全体シェアで既に超えており、**仮説一は肯定的に検証されつつある** — ただし Epic の判定は eligible（非 L0/L1）分母で行う設計なので、正式な verdict は escalation reason 別の内訳を待つ必要がある（§19 に記録）。

一方 **`asp-cloud`（外部委任先）は直近 28 日で 0 件**。委任マージの機構は同一なので、これは *外部リポジトリでは述語が通っていない*（レビューパネルが組めていない／L0/L1 に触れている／checks が緑にならない）ことを意味する。自リポジトリと外部リポジトリで自律度が桁違いという構造は、Epic-019 が想定していない切り口である。

| | PEAS | workforce（実測） |
|---|---|---|
| 境界の表現 | 工程上の位置 | パスの集合 ＋ 述語（clean・green・unanimous consensus・kill-switch） |
| 境界の可変性 | 固定。0 self-approved が誇るべき不変条件 | **可変。自律マージ率を上げることが目標**（6.9% → 直近 21.5%） |
| 人間の人数 | 4（実務者兼承認者） | 1（憲法層のみ。C-3 で永久に 1） |
| 自己拡張の防止 | 「バイパス経路が存在しない」と構造で主張 | 境界定義ファイル自身を境界の内側に置く（自己参照的封じ込め） |

**考察.** **PEAS の "0 self-approved PRs" は達成すべき恒久的不変量、workforce の "21.5%" は上げるべき KPI。ベクトルが正反対に見える。**

ただし矛盾ではない。PEAS の「自己承認ゼロ」に相当する不変量は workforce にもある（W-5、レビュアと実装者の分離、generator と judge の model disjointness）。workforce が上げているのは「*人間の判断を要しない種類の変更*で、独立レビュー合議を通ったものの比率」であって「自己承認の比率」ではない。差は **「独立レビューを通った後、最終ボタンを誰が押すか」** の 1 点。

そして workforce はこの 1 点を **恣意ではなく制度で**開いている：委任は対象リポジトリ側の statute が明示的に付与し（workforce が自称しない）、述語はサーバ側で再検証して fail closed し、境界は自己拡張不能で、全マージが監査行と consensus コメントを残す。**PEAS が「バイパス経路なし」で守っているものを、workforce は「バイパス経路を制度化して監査する」で守っている。**

---

## 12. 記憶と組織学習 — 同じ課題、進捗段階が違う

**PEAS（デッキの自己申告）**
- PRODUCTION-PROVEN: 決定・runbook・ルールの成熟した knowledge base が日常運用
- EXPERIMENTAL: **per-agent memory は配線済みだが長期的価値は未実証**
- ROADMAP 04: **Shared Agent Memory** — セッションを跨いでプロジェクト知識を蓄積する永続メモリ層

**workforce（実測含む）**
- 二層構造：**episodic**（S3 `memory/{slug}/` チャンク ＋ `wf-memory-compactor-prod` Lambda が毎日 05:00 に圧縮 — EventBridge 実測）と **semantic**（`META.memory` の散文、ADR-0019、`memory-curation` cadence 実測 10 回発火、ADR-0020/0021）
- `AGENT#maya/META.memory` に実際に curated な散文が入っていることを実測で確認（`> Curated: 2026-07-27`）
- **Epic-022「組織学習」** — 1 人の学びを翌日には全員の前提にする lesson stream（日次 Lambda 抽出 → 決定論的 pre-filter で fail closed → ≥2 名キュレーション → V1 は全件 operator 週次ダイジェスト → scope 条件付きで ~500–800 token 上限・inert 注入）。ペルソナの `system_prompt` は書き換えない（W-5 不可侵）

**考察.** **PEAS のロードマップ 04 は workforce の Epic-022 とほぼ同一の課題設定。** 同じ順序（repo 知識ベース → 共有メモリ）で同じ壁を認識しており、workforce が 1〜2 手先行。workforce が先に潰した論点:

1. 教訓の注入は **injection 攻撃面**（毒された「教訓」が 54 エージェントの前提になる）→ 決定論的 pre-filter を LLM 判断の *前*に置き fail closed
2. **scope はマシン導出**（distiller が自由にタグを発明すると必ず drift）
3. **注入ブロックは fire ごとにログ**（さもないと挙動変化が再現不能）
4. **「翌日」を名乗らない正直さ** — 週次ゲートがある間は「within-a-week」と書く

---

## 13. スケール前提 — 横展開か、増員か

| PEAS | workforce（実測） |
|---|---|
| 4 人間 × 12 エージェント × 1 プロダクト | 1 人間 × **54 ペルソナ** × 4 実プロジェクト |
| スケール = **他部門への横展開**。Adoption Guide が「再利用できる部分／作り直すべき部分」を明示 | スケール = **縦の増員**。全 Epic に「Behaviour at N = 100+ agents」節が必須、O(N²) を作らないことがレビュー観点 |
| ロードマップ 03「Meta-Harness」= 1 オーケストレータが複数パイプラインを依存関係追跡付きで管理 | Project が信頼境界（Epic-010）。実測で `agent-workforce` / `asp-cloud` / `project-ind` / `conference` が並走、行数比 5287 : 309 : 74 : 16 |
| 人間は増える前提 | **人間は永久に 1 人**（C-3）。だから「人手を要さない比率」を上げるしかない |

**考察.** PEAS の Meta-Harness は workforce の Project 機構とほぼ同じ問題を解こうとしているが、動機が違う：PEAS は「別チームに配れるように」、workforce は「1 人の人間の注意で足りるように」。**C-3 が workforce の設計をほぼ全て説明する。** 逆に PEAS が multi-team を前提にした瞬間、workforce の設計の多く（trust ladder、human leverage 指標、委任マージ）は動機を失う。**decision であって gap ではない。**

実測が示す偏りとして、`agent-workforce`（自分自身）が実行行の 90% を占める。**組織のリソースの大半が「組織自身の運営」に使われている** — dogfooding の比率としては極端で、外部プロジェクトへの適用は `asp-cloud` 309 行 / `project-ind` 74 行にとどまる。これは PEAS が単一プロダクトに 100% を投じているのと対照的で、どちらが正しいかは目的による（発明の組織 vs 証明の組織）。

---

## 14. 不確実性の扱い — 最も強く一致する文化

**PEAS**（スライド 42 "HONEST LIMITS"）が自分から挙げた未達：loop governor は走行距離が短い／agentic-AI security reviewer はまだ全 PR の定常ゲートではない／per-agent memory の長期価値は未実証／**仕様は ephemeral**／pre-commit hook は 1 言語のみ／staging は意図的に緩い認証／**オーケストレータは人間が起動する**。結び：*「正確な期待値で導入したチームは成功する。成功譚だけで導入したチームは離脱しがちで、次のチームの説得を難しくする」*

**workforce** の対応物：risk-acceptance ledger（実測 3 行、operator が merge で「署名」、再提起を抑止）／memory-lint backlog（実測 15 行）／follow-ups.md ／ Epic の **Falsifier** 節必須化／Epic-020「**under-claiming beats storytelling**」／Epic-019「30 は桁ではなく 5 倍である」という算術の正直さの事前約束／**Goodhart 条項**（指標を目標にしない、と指標定義の中に書く）／外部引用時の caveat 責任者（celeste）指名。

**考察.** 本比較で **最も深く一致する**軸。両者とも「都合の良い数字を作らない」を*制度*にしている。PEAS の "PRODUCTION-PROVEN / EXPERIMENTAL / NOT YET BUILT" の 3 分類は、workforce の ledger／follow-ups／Falsifier とほぼ同じ機能を、より読みやすい 1 枚で果たしている。**この 3 分類は workforce がそのまま採用できる表現形式**（現状「何が実証済みか」は 4 箇所に散在）。

---

## 15. 外部への露出と信頼境界

| PEAS | workforce |
|---|---|
| 完全に社内。外部露出なし | 記事が `kohuehara.xyz`（実測 105 本の公開 md）、Podcast が Spotify に**公開** |
| 第三者検証は社内他部門 SAC | 検証は operator ＋ 読者反応（GA4）＋ 公開月次レター |
| 外部リポジトリへの書き込みなし | **R-N9**: 外部 git は PR のみ、直 commit 禁止（PAT スコープでワイヤレベル拒否）。**R-N10**: 委任された場合のみマージ。実測で `asp-cloud` に 18 本のエージェント名義 PR |
| — | 資金調達・IR・政策提言のペルソナは全員 **outreach を hard-refuse**（起案するが行動しない） |

**考察.** workforce は「組織の外に出ること」自体を設計対象にしている。その分だけ制約設計（hard-refuse outreach、PR-only、委任マージ、project-scoped credential — 実測で EXEC 行が `used_credential_types` を持つ）が厚い。PEAS は社内に閉じているため不要だが、**他部門展開が始まればすぐ必要になる領域**。

---

## 16. メタファ — 工場か、国家か

- **PEAS = 規律ある工場／エンジニアリング組織。** エージェントは工程、統制は安全装置、成果はスループットと単価。語彙は「ゲート」「ガバナ」「パイプライン」「ハーネス」。
- **workforce = 国家／会社。** 憲法・法律・規制・判例（ADR）・登記簿・人事・給与・採用稟議・実績・信頼階梯・審議委員会。語彙は「Zone」「statute」「amendment」「delegation」「trust tier」「hire round」。

このメタファの差は装飾ではなく、**何を増やせば組織が伸びるかの仮説**の差である。PEAS は工程とゲートを増やす。workforce は席と権限と記録を増やす（実測：54 席・141 バインディング・10,139 行）。

---

## 17. 数字の並置（同一条件ではないので比較ではなく対置）

| 指標 | PEAS（自己申告） | workforce（実測） |
|---|---|---|
| 人間 | 4 名 | 1 名 |
| エージェント | 12（3 層） | **54**（President + VP 9 + 二次管理職 + IC、25 か国） |
| モデル配分 | Opus 4 / Sonnet 8 (+Haiku コマンド) | Opus 1 / Sonnet 47 / Haiku 6 |
| 変更スループット | 330 Jira チケット / 6 週 | **406 PR / 91 日**（うち直近 28 日 79 PR） |
| 定期業務の実行 | なし（人間起動セッション） | **5,839 EXEC / 3 か月**（ok 4,408・skipped 1,371・throw 60）、62 スキル |
| 人手ゼロで完了した変更 | **0**（設計上の不変量） | **28 / 406 = 6.9%**、**直近 28 日 17 / 79 = 21.5%** |
| AI 生成比率 | 本番コードの >90%、ドキュメントの >80% | 未計測（PR 名義ベースでは 119/525 = 23% がペルソナ名義） |
| コスト | $7,215 / 6 週（11.48B tokens、cache 93.2%） | AWS 実績 **$34.89/月**。**LLM 推論費は workforce からは不可視** |
| 決定記録 | ADR ＋ 63 ops のトレーサビリティ行列 | ADR 25 ＋ Epic 24 ＋ ML 15 ＋ RAL 3 ＋ 採用稟議 |
| CI の役割 | 品質ゲート専用 | 品質ゲート ＋ デプロイ ＋ **業務執行**（12 ワークフロー） |
| カバレッジ床 | 80%（ブロッキング） | 相当物なし |
| 負荷試験 | k6 しきい値でビルドを落とす | 相当物なし |

**注意**: チケットと PR は粒度が違い、6 週と 91 日も違う。ここから生産性の優劣は読めない。読めるのは **「1 人の人間が 91 日で 406 PR を捌く組織」と「4 人の人間が 6 週で 330 チケットを捌く組織」がほぼ同じオーダーの変更流量を持っている**という事実で、C-3 制約が実際に機能していることの傍証になる。

---

## 18. 総合考察 — 何が同じで、何が違い、どちらが gap か

### 18.1 独立到達した収束点（＝おそらく agentic 開発の普遍解）

1. **統制は文化ではなく構造に埋める。**
2. **作った者は検査してはならない。**（code-reviewer ≠ implementer ／ judge ≠ generator）
3. **仕様が先。**（Gherkin AC + failing test ／ Epic の Acceptance criteria + Falsifier）
4. **終了条件のない自律はコストリスク。**（round cap / dispatch budget ／ cycle cap / W-4 ガード）
5. **ゲート設定自体を版管理し、変更をレビュー経路に載せる。**（CI が CI 設定を検査 ／ L0/L1 ブロックが自分自身の内側）
6. **証拠が本体、プレゼンは二次。**
7. **正直さを制度化する。**（HONEST LIMITS 3 分類 ／ risk ledger・Falsifier・Goodhart 条項）
8. **エージェント基盤は自前で作らない。**（両者とも最終的に Claude Code を推論面に採用）

PEAS の 8 つの壁すべてに workforce の対応物があること（§7 の表）は、この収束の最も直接的な証拠である。

### 18.2 意図的な差異（decision — 標準化すべきでない）

| 差異 | なぜ decision か |
|---|---|
| 実行が人間起動 vs スケジュール自走 | PEAS は可搬性（他部門配布）、workforce は人間不在耐性を最適化 |
| 設定の真実が git vs DDB | 同上。可搬性 vs 稼働中の変更容易性・監査行 |
| 12 の無名役割 vs 54 の人格 | SDLC の分業 vs 会社機能の分業。人格は実績・信頼階梯の前提 |
| 判断の質をモデル階層 vs 組織構造（合議）で担保 | 人数が違えば最適解が違う。12 体なら Opus 4 体、54 体なら 3 人レンズパネル |
| 境界が固定 vs 計測して動かす | 人間 4 名なら人間は律速にならない。人間 1 名なら律速になる（C-3） |
| 社内閉鎖 vs 外部公開・外部リポジトリ | 成果物が公開物であることに由来 |
| CI = 検査官 vs 検査官＋業務執行者 | 定期業務を持つ組織と持たない組織の差 |

### 18.3 workforce 側の gap（PEAS から標準化を検討すべき）

差別化バッジを貼らずに gap と認めるべきもの（design-policy D-2 の反射）。**実測で優先順位が変わった**:

1. **LLM コストの可視化（実測で最上位に繰り上がり）** — W-3 は月次上限を宣言するが、CCR 面ではコール地点を通らず、54 体すべての `cost_this_month_usd` が 0.00、`BUDGET#` 行は 2 行で停止している。PEAS が「$7,215・cache 93.2%」と*測れている*のとは対照的。**上限があること自体が現在フィクションになっている。**
2. **dispatch budget（宣言見積の 2× で自動停止）** — 上記の帰結として、月次上限が効かない現状ではタスク粒度の統制がより重要。導入コストが低く効果が明確。
3. **決定論的検証の厚み** — SDLC レーンに TDD 強制・カバレッジ床・doc-drift gate・SBOM/secrets スキャン・IaC policy check が無い。PEAS の Quality Gate 表はほぼそのまま導入候補。
4. **観測性（Wall 7）** — R-N5 で CloudWatch のみに絞っており、PEAS の OTel/Tempo/Grafana/SLO burn-rate と比べて明確に薄い。R-N5 は「v2 に延期」と書いてあるので、これは *宣言済みの* gap。
5. **単一タスクインターフェース（`justfile`）** — 「CI と同じゲートをローカルで 1 コマンド」が無い。skill ごとに write-script が散在。
6. **非機能検証（k6 しきい値でビルドを落とす）** — 相当物なし。適用先は SDLC レーンと API 面。
7. **HONEST LIMITS の 3 分類** — 内容ではなく *提示形式*の借用。
8. **least agency の実装層** — 「危険なコマンドをブロック」「エージェントは自分の鍵を作れない」。トークン面（ADR-0009/0021）は固めているが、*ツール権限・コマンド面*の最小権限設計は薄い。
9. **外部委任先での自律度** — 実測で `asp-cloud` 直近 28 日 0 件。自リポ 21.5% との落差の原因分析は未着手。

### 18.4 PEAS 側の gap（workforce から移転しうるもの）

1. **オーケストレータの常時自走** — PEAS 自身が NOT YET BUILT に挙げている。workforce の EventBridge → orchestrator-tick（rate 2h、実測 ENABLED）→ CCR は稼働実績あり。ただし PEAS が Lambda 化するとインタラクティブツールが使えないので、**R-N1 の「実行面を列挙し、例外を宣言する」という形式**ごと参考になる（そして実測が示す通り、その例外が主経路になる可能性も含めて）。
2. **CI を業務執行面として使う**（§5(c)） — 新インフラ 0 で決定論的定期業務を監査可能な面に載せられる。PEAS は既に厚い CI を持っているので、追加コストが最も小さい移転。
3. **組織学習の共有メモリ** — ロードマップ 04 ≒ Epic-022。§12 の 4 つの先行知見がそのまま移転可能。
4. **ルールの改正手続きの法制化** — PEAS は「ゲート設定を PR で変える」までは持つが、*どのルールがどの承認バーか*の階層（L0/L1/L2/L3 × Zone A/B/C/D）は持たない。8 つの壁が 20 個に増えたときに効く。
5. **memory→lint ratchet** — PEAS は loop governor を「security audit で指摘されたので追加した」と書いており、**ratchet が自動化する経路を手動で 1 回通している**。§6 の PR 群がその制度化の実例。
6. **risk-acceptance ledger** — 「本物だが対処しないと決めた」を署名付きで残し再提起を抑止。PEAS の HONEST LIMITS は近いが*再提起抑止*の効果はない。
7. **仕様の永続性** — PEAS が NOT YET BUILT に「仕様は ephemeral」と挙げている。workforce の Epic ドキュメント（Falsifier・Acceptance criteria・RFC record・status reconciliation の追記履歴つき）は、まさにその ephemeral さを埋めるために生えた形式。

### 18.5 相互の弱点はほぼ相補的

- workforce の中核的弱点は **「出力の大半が決定論的に検証できない」**（記事・レポート・台本）。だから審査員パネルという重い機構を発明せざるを得ず、そのぶん SDLC の基本的な機械検査が薄いまま残った。**加えて実測が明かしたのは、実行面の選択が計測面（コスト）を犠牲にしていること。**
- PEAS の中核的弱点は **「人間が起動しないと何も始まらない」ことと「学習が個人セッションとリポジトリに留まる」**。だから 4 人の人間が実務者として常駐する必要があり、そのぶん組織としての自走・自己改善の機構が育っていない。

**片方が深く掘った所を、もう片方が浅く残している。** 交換の余地が大きい 2 組織という結論になる。

---

## 19. 実測が明かした「文書と現実のずれ」（当 workforce 内部への申し送り）

比較のために本番環境を照会した副産物として、statute / architecture 文書と稼働実態の乖離が 4 点見つかった。**いずれも本メモの権限では決められない**ので、所見として記録し、担当 VP と operator に判断を渡す。

| # | 乖離 | 文書 | 実測 | 誰の判断か |
|---|---|---|---|---|
| D-1 | **実行面の既定と例外が逆転** | `architecture.md` / R-N1「推論は既定で Lambda、CCR は宣言された例外」 | バインディング 141 本すべて `claude-code-routine`。Lambda 面での推論は 0 | `mateo`（VP Platform）→ R-N1 の Zone A 改正の要否 |
| D-2 | **W-3 のコール地点強制が主経路で不動作** | W-3「LLM コール地点で月次上限を超えたら throw」 | 54 体すべて `cost_this_month_usd` = 0.00、`BUDGET#` 行は 2 行（2026-05/06）で停止 | `silas`（VP Finance）＋ operator。D-1 の帰結なので同時に扱うべき |
| D-3 | **Epic-019 のベースラインが古い** | Epic-019「218 PR 中 6 = 2.8% を桁で上げる」 | 直近 28 日で 17/79 = **21.5%**。全期間でも 28/406 = 6.9% | `nadia`（Owner）→ Story 3 の verdict は eligible 分母で書くべきだが、暫定値は報告可能 |
| D-4 | **外部委任先の自律度がゼロ** | R-N10 の委任は `asp-cloud` にも及ぶ | `asp-cloud` 直近 28 日 53 PR 中 autopilot merge **0 件**（全期間でも 6 件） | `nadia` ＋ `dario`。Epic-019 の escalation reason 分析の対象を外部リポジトリにも広げる必要 |

D-1〜D-2 は **§18.3 の gap 1・2 と同じ根**であり、切り離して直せない。D-3 は **良い方向の乖離**（仮説一が想定より早く肯定されつつある）だが、報告済みの数字が古いままなのは §14 の「正直さの制度」に対する債務である。

---

## 20. この比較の限界

- **PEAS 側は自己申告、workforce 側は実測**という非対称がある。PEAS の $7,215 やキャッシュ効率 93.2% は検証していない。逆に、デッキが「持っている」と書いていないものを「無い」と断定した箇所（Zone 概念の不在など）は、単に発表対象でなかった可能性がある。
- 数字（330 チケット / 406 PR、$7,215 / $34.89）は測定期間も粒度も定義も揃っていない。§17 は対置であって比較ではない。
- 当 workforce 側でも、**設計文書上は Accepted だが未実装**の項目（Epic-020 human leverage、Epic-022 lesson stream、Epic-023 trust ladder — いずれも `Implemented by: —`）を「持っている」と読める形で §12・§11 に書いた箇所がある。それらは「決めた」であって「動いている」ではない。動いていることを実測で確認したのは、§2〜§5・§8・§10・§11 の表に載せた数値のみ。
- `PERF#workforce/PR` の window は 2026-04-27〜07-26（reducer の最終更新 07-26）。本メモ作成日 07-31 までの 5 日分は含まれない。

---

## 付録 A — 実測スナップショット取得方法（再現手順）

すべて `AWS_DEFAULT_REGION=us-west-2`、読み取り専用。

```sh
# 組織規模・構成
aws dynamodb scan --table-name wf-table-prod \
  --filter-expression "sk = :m AND begins_with(pk, :p)" \
  --expression-attribute-values '{":m":{"S":"META"},":p":{"S":"AGENT#"}}' \
  --projection-expression "pk, model, budget_monthly_usd_default, cost_this_month_usd, bindings, residence, reports_to"

# 実行台帳（EXEC）— 稼働実績・スキル別発火数・成否
aws dynamodb scan --table-name wf-table-prod \
  --filter-expression "begins_with(sk, :e)" \
  --expression-attribute-values '{":e":{"S":"EXEC#"}}' \
  --projection-expression "pk, sk, agent_slug, skill_name, skill_version, #st, started_at, execution_surface" \
  --expression-attribute-names '{"#st":"status"}'

# PR メトリクス（自律マージ率の一次データ）
aws dynamodb get-item --table-name wf-table-prod \
  --key '{"pk":{"S":"PERF#workforce"},"sk":{"S":"PR"}}'      # および PERF#asp-cloud / PERF#project-ind

# インフラ実態
aws dynamodb describe-table --table-name wf-table-prod --query 'Table.{Items:ItemCount,GSI:GlobalSecondaryIndexes[].IndexName}'
aws lambda list-functions --query 'Functions[].FunctionName'
aws events list-rules --query 'Rules[].{N:Name,S:ScheduleExpression,E:State}'
aws budgets describe-budgets --account-id <acct> --query 'Budgets[].{N:BudgetName,L:BudgetLimit.Amount,A:CalculatedSpend.ActualSpend.Amount}'
aws s3 ls s3://wf-bucket-<acct>-us-west-2-prod/
```

スナップショット取得時刻: **2026-07-31**（`PERF#*` の `updated_at` は 2026-07-26T17:00Z）。
