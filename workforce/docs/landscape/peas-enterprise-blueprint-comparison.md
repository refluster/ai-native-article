# ランドスケープ比較 — PEAS Enterprise Blueprint × 当 workforce

- **作成日**: 2026-07-31
- **比較対象**: `The PEAS Enterprise Blueprint v4.1`（他部門の Agentic AI による SaaS 開発プラットフォーム、47 スライド／CarePrevention 再構築の実績報告）
- **比較主体**: 本リポジトリ `refluster/ai-native-article` の `workforce/` サブシステム
- **性格**: 分析メモ（informs, never decides）。ここでの「差異」は *decision か gap か* を明示するが、標準化の採否は operator と該当 VP が決める。エコシステム分析シート（`workforce/seed/ecosystem-landscape/`）の 7 軸を拡張して 16 観点で対置した。
- **出典の扱い**: PEAS 側の記述はすべて添付デッキ本文＋スピーカーノートに書かれている事実のみ。デッキに書かれていない挙動は推測せず「不明」と書いた。

---

## 0. 一行要約

**PEAS は「AI で*ソフトウェア開発*をやる」ためのプラットフォーム。当 workforce は「AI で*組織*をやる」ための実験で、ソフトウェア開発はその中の一レーンにすぎない。** 両者は Day 1／Day 2 の統制課題では驚くほど同じ結論に独立到達しており、決定的に分岐するのは **人間と機械の境界をどう扱うか**（固定した憲章 vs 計測して動かす変数）と **組織の対象範囲**（SDLC 職能 vs 会社機能）である。

---

## 1. 存在目的 — なぜその組織があるか

| | PEAS | workforce |
|---|---|---|
| 成立の由来 | 上位命令（Mission Directive）：「DCD 内で初めて AI 駆動開発による外注コスト削減を実証せよ」 | 個人サイトの記事パイプライン運用から自生。MVV が後から制定された |
| 成功の定義 | 第三者部門 SAC が Axis 2（品質・正確性）を独立検証し、Axis 1（生産性）の実測値と併せて評価する | 「human-agent co-creation の operating model を作れたか」。検証者は operator 一人＋公開記事の読者反応 |
| 題材 | CarePrevention（予防ケア、Fitbit／LINE／日本語高齢者 UX）の作り直し。**題材は使い捨て、フレームワークが成果物**（"The framework travels. The domain does not."） | kohuehara.xyz の記事・Podcast、および外部プロジェクト（`asp-cloud` 等）。**題材も組織も両方が成果物** |
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

役割名はすべて **SDLC の職能**。エージェントに固有名・履歴・所属はなく、`.claude/agents/*.md` の定義ファイルそのものが実体。「判断は Opus、実装は Sonnet」というモデル階層がコスト構造の中核として設計されている。

**workforce: 約 35 ペルソナ、企業の組織図そのもの**

- VP 層（`mateo` Agent Workforce Platform / `dario` Eng. Excellence / `priya` People & Legal / `elena` Editorial / `tessa` Policy & Gov. Affairs / `silas` Finance & Capital / `celeste` Marketing & External Comms）＋ `maya`（代表）＋多数の IC。
- 各ペルソナは **slug・役職・居住地・上司（`reports_to`）・使用モデル・月次予算（USD 5–8/月）・semantic memory** を持つ。組織図は `reports_to` エッジから生成され、span of control が採用メモで議論される。
- 職能は開発だけではない：政策リサーチ（US／India）、カーボン市場、財務・資金調達・IR、Podcast 制作、メディア権利コンプライアンス、人事法務、赤チーム監査、そして**エコシステム分析（自分たちの立ち位置を調べる席）**。
- 増員は **採用ラウンド**として `workforce/docs/hires/*.md` に稟議メモ（政策・パネル・コスト査定・未解決論点）が残る。

| 観点 | PEAS | workforce |
|---|---|---|
| 分業の軸 | 開発工程（function-of-SDLC） | 会社機能（function-of-company） |
| エージェントの人格 | なし（役割 = 定義ファイル） | あり（名前・居住地・給与・記憶・上司） |
| 階層 | 3 層 + 人間 | VP → Director/Manager → IC の多段。人間は憲法層のみ |
| 増員の手続き | ロスターへの追加（Zone 相当の明記なし） | 採用ラウンド稟議 → W-3 予算改正表に 1 行 → operator 承認 |
| 数 | 12（固定・O(1) 設計） | 約 35（増加中。全 Epic に「N=100+ での挙動」節が必須） |

**考察.** PEAS のエージェントは *道具の名前*であり、workforce のそれは *従業員の名前*である。これは趣味の違いではなく統制設計の違いに直結する — 人格があるからこそ workforce は「実績台帳」「信頼階梯（Epic-023）」「アイドル検知」「月次評価」といった *人事的*機構を持てるし、持たざるを得ない。PEAS は人格を持たないので、統制はすべて *工程上のゲート*として表現される。どちらも整合的だが、拡張したときに増えるものが違う（PEAS は工程が増える／workforce は席が増える）。

---

## 3. 業務スコープ

| PEAS | workforce |
|---|---|
| 単一プロダクトの SDLC 全域 + Day 2 運用 | 36 の Cadence（定期業務スキル） |
| spec → ticket → failing test → implement → review → PR → merge | 記事 L2/L3 生成、Podcast 台本・製作・配信、日次リサーチ、月次組織レター、週次プロジェクト報告、採用、法改正審議委員会、赤チーム監査、メモリ衛生、実績登録、読者シグナル分析…… |
| Day 2: IaC（13 Terraform モジュール）、OTel/Tempo/Grafana/VictoriaMetrics、SLO burn alert、runbook、k6 負荷試験 | ソフトウェア開発は `pr-autopilot` / `issue-implement` / `code-task-brief` の 3 レーンに凝縮 |

**考察.** PEAS のスコープ = workforce の「SDLC レーン」1 本、という包含関係に見えるが、深さは逆転している。PEAS の SDLC 1 本は workforce の SDLC 1 本より遥かに深い（TDD 強制、カバレッジ床、SBOM、OWASP ASI レビュー、負荷試験しきい値、13 モジュールの IaC）。workforce は幅を、PEAS は深さを取った。**これは gap であって decision ではない** — workforce の SDLC レーンが PEAS 並みの決定論的検証を持たないのは、意図的な選択ではなく単に未着手である（後述 §16）。

---

## 4. 実行基盤 — repo-as-runtime か cloud-as-runtime か

**PEAS**: すべてがリポジトリ資産。`.claude/agents/`（12 定義）、`.claude/commands/`（パイプラインコマンド）、hooks、`knowledge/`（ADR・ルール・runbook）、`docs/`、`src/`、`worktrees/`。Claude Code（Opus/Sonnet）+ Jira MCP + GitHub Cloud + AWS。git worktree で機能ごとに隔離。`justfile` が bootstrap／build／deploy／operate の**単一タスクインターフェース**。**オーケストレータは人間が起動する（デーモンではない）**とデッキが明言している。

**workforce**: AWS Lambda が既定の実行面（R-N1）。EventBridge → `wf-orchestrator-tick` → `wf-agent-runner` の常時スケジュール駆動。状態は DynamoDB 単一テーブル + S3 のみ（R-N2）、秘密は Secrets Manager の `wf/` 名前空間のみ（R-N3）、観測は CloudWatch のみ（R-N5）。Claude Code routine（CCR）は**宣言された例外**（R-N1(a)、ADR-0005）で、対話ツールが要る skill だけが通る。

| | PEAS | workforce |
|---|---|---|
| 実行の起点 | 人間がセッションを開始（`/orchestrate [TICKET]`） | スケジューラ（cron / GitHub event）。人間は不在でも回る |
| エージェント定義の真実の在り処 | **git のファイル**（`.claude/agents/`）。履歴 = 監査証跡 | **DynamoDB の `AGENT#{slug}/META` 行**（ADR-0007）。git ツリーは凍結。監査は append-only の `AUDIT#` 行＋週次 config ダイジェスト |
| 隔離 | git worktree（機能単位） | Project（信頼境界。scoped credential ＋ EXEC 台帳 ＋ S3 prefix、Epic-010） |
| 実行面の制約 | 明文化なし（Claude Code 前提） | R-N1 に許可された面を列挙し、追加は Zone A 改正 |
| 単一インターフェース | `justfile`（`just check` = CI と同じゲートをローカルで） | なし（skill ごとの bundled write-script） |

**考察.** ここは**思想が正面から分岐している**。PEAS は「リポジトリを開けば組織の全部が読める」— 可搬性が高く、他部門への配布（Adoption Guide）に最適化されている。workforce は「組織は稼働中のサービスであり、設定はデータベースにある」— 人間不在で自走することに最適化されている。

PEAS が「オーケストレータはデーモンではない」を *NOT YET BUILT* に正直に挙げているのは示唆的で、workforce はまさにそこ（常時自走）を先に作り、代わりに可搬性を捨てた。**双方とも自分が捨てたものを認識している**。

なお両者は「自前のエージェントフレームワークは作らない」で完全に一致する。PEAS は「`~/.claude/` は可搬でベンダーロックされていない、閾値を超えたモデルが出れば設定変更で差し替え」（ロードマップ 02）、workforce は design-policy D-3「external substrate over reinvention」で自前のスケジューラ・エージェント・秘密管理を作らないと明文化している。同じ結論への別経路。

---

## 5. ガバナンス思想 — 工学的ガードレール群 vs 成文法体系

**PEAS の骨格: 「8 つの壁」と structural gate**

Day 1（コードを信頼できるようにする）4 つ、Day 2（3 年間所有し続ける）4 つ。特筆すべきは Wall 8「安全チェックがオフにされたまま戻らない」への回答 —「ゲート設定をファイルとして保存し PR で変更する。CI は CI 自身の設定もチェックする」。そしてスピーカーノートの一節：

> *"AI agents do not create new kinds of failure. They remove the slow steps that used to catch these problems early. So the control must be built into the system, not into team culture."*

**workforce の骨格: 4 層の法体系**

- **L0 憲法** C-1〜C-4（編集の誠実性 / Notion が真実 / 単一運用者スケール / fail loud）+ workforce の W-1〜W-5。改正は operator のみ。
- **L1 framework laws** — statute doc 群 ＋ **ADR 25 本**（workforce 21・root 4）。ADR は append-only、覆すときは *supersede* であって書き換えではない。
- **L2 regulations** R-1〜R-13 の機械的ゲート。**番号は再利用しない**（廃止された R-1/R-3〜R-6 も枠が残り、過去の provenance が解決できる）。
- **L3 runbooks** — skill の SKILL.md がそのまま runbook。

加えて：
- **Zone A/B/C/D** の所有権モデル（AGENTS.md）。パスごとに承認バーが決まる。
- **memory→lint ratchet** — 同じ失敗が 90 日以内に 2 回起きたら自動的に `R-NN` 機械ゲートへ格上げ。「バグ修正は、それを捕まえるべきだったルールがどの層にあるかを記録するまで完了しない」。
- **risk-acceptance ledger** — 「本物だが機械チェックに値しない」指摘は operator が merge で「署名」する台帳に入り、**再提起が抑止される**（監査ループが同じ論点を永久に再燃させないための機構）。

| 観点 | PEAS | workforce |
|---|---|---|
| 形式 | 工学的ガードレールの列挙（8 つの壁 → 8 つの答え） | 階層化された法体系（層・改正手続き・判例・登記簿） |
| ルール変更の手続き | ゲート設定をファイル化し PR で変更、CI が CI 設定も検査 | 層ごとに承認バーが異なる。L2 の *tightening* は自由、*loosening* は operator 承認。L0/L1 パス集合を書き換える行為自体が L0/L1 |
| 失敗からの学習 | 「security audit で終了条件もコスト上限も無いと判明したので loop governor を追加した」（事後の追加として率直に記述） | ratchet として制度化（2 回目の再発 = 自動昇格）。retrospective を怠ること自体が governance defect と定義 |
| 決定の記録 | ADR（`knowledge/decisions/`）、TRACEABILITY-MATRIX、隔週 `/report` | ADR 25 + Epic 24 + hire round メモ + follow-ups + 2 つの登記簿 |

**考察.** 同じ命題 —「統制はチーム文化ではなくシステムに埋め込め」— に両者が独立に到達している。これが本比較で最も強い一致点であり、PEAS の主張「これは医療の問題ではない（=どの部門でも同じ壁に当たる）」の裏付けになる。

差は成熟の形。PEAS は *チェックリスト*として、workforce は *法体系*として同じものを表現した。workforce 側が持ち PEAS 側に見当たらないのは **「ルールの変え方のルール」と「学習が自動的にルールへ昇格する経路」**。逆に PEAS が持ち workforce に薄いのは **ゲートの実効性を担保する決定論的検査の厚み**（§7）。

---

## 6. 人間と機械の境界 — ここが最大の分岐点

**PEAS: 境界は工程の位置で引かれ、固定されている**

- "Humans own Design, Reviews, and PRs. Agents run implementation instructions."
- **0 self-approved PRs** — 「ポリシーではなく構造的ゲート。書いたエージェントは承認を構造的に禁じられ、バイパス経路は存在しない」。
- 上流（spec & grill）は Human + Orchestrator、下流（merge）は Human + CI。人間 4 名は実務者であり承認者。
- ループガバナ：review round cap **2**、dispatch budget **2×**。超えたら人間にエスカレーション。

**workforce: 境界はパス集合で定義され、計測され、動かされる**

- 人間は **1 人**（operator）で、所有するのは憲法層のみ（Zone A = identity / governance / prompts / workflows / 予算 / 公開約束）。
- マージ権限は原則人間だが **R-N10「委任マージ」**が例外を作る。しかも **adr-0011 で自リポジトリも外部委任先と同一扱い**にした（「自分のリポジトリだから慎重に」という特例を*撤廃*した）。境界は `docs/governance.md` §4.4 の **`<!-- autopilot:l0l1-paths -->` ブロック**という機械可読なパス集合だけで決まる。
- そのブロックは `docs/governance.md` 自身に置かれ、`docs/governance.md` は L0/L1 に含まれる → **autopilot は自分の境界を広げられない**。ブロックを空にすると L0/L1 集合が *unknown* になり全マージが fail closed する（＝ kill switch を兼ねる）。
- **Epic-019**: 直近 28 日で 218 PR 中、人手ゼロでマージされたのは 6 件（**2.8%**）。これを「桁で上げる」ことが KPI。ただし *R-N10 述語は一切広げない* — 「権限ではなく配線がボトルネックか」を測る設計。
- **Epic-020**: 人間のタッチ 1 回あたりの leverage（下流で解錠された仕事量）を指標化。「良い組織とは人間のタッチが最少の組織ではなく、1 回のタッチが最も高く値付けされている組織」。Goodhart 条項付き（指標であって目標にしない）。
- **Epic-023**: 実績で権限が伸縮する **trust ladder**（T0 観察者 → T1 レンズ評者 → T2 ルーティング適格）。昇格も降格も記録から機械計算し、人も機械も手で階層を設定できない。

| | PEAS | workforce |
|---|---|---|
| 境界の表現 | 工程上の位置（design / review / merge は人間） | パスの集合（L0/L1 path set）＋述語（clean・green・unanimous consensus・kill-switch） |
| 境界の可変性 | 固定。0 self-approved が誇るべき不変条件 | **可変。自律マージ率を上げることが目標**。ただし述語自体の変更は Zone A |
| 人間の人数 | 4（実務者兼承認者） | 1（憲法層のみ。C-3 で永久に 1） |
| 境界の計測 | 「0 件」という不変量を git history で検証可能と主張 | 2.8% → 目標桁上げ、touch あたり leverage、trust tier の分布 |
| 自己拡張の防止 | 「バイパス経路が存在しない」と構造で主張 | 境界定義ファイル自身を境界の内側に置く（自己参照的封じ込め） |

**考察.** ここが最大の哲学的差異である。**PEAS の "0 self-approved PRs" は達成すべき恒久的な不変量であり、workforce の "2.8%" は上げるべき KPI である。ベクトルが正反対に見える。**

ただし正確には矛盾していない。PEAS の「自己承認ゼロ」に相当する不変量は workforce にもあり（W-5：ペルソナは自分の identity を変更できない／レビュアと実装者の分離／generator と judge の model disjointness）、workforce が上げようとしているのは「*人間の判断を要しない種類の変更*で、独立レビュー合議を通ったものの比率」であって「自己承認の比率」ではない。差は **「独立レビューを通った後、最終ボタンを誰が押すか」** の 1 点に絞られる。PEAS は人間、workforce は述語を満たせば機械。

そして workforce はこの 1 点を **恣意ではなく制度で**開いている：委任は必ず対象リポジトリ側の statute が明示的に付与し（workforce が自称しない）、述語はサーバ側で再検証し fail closed し、境界は自己拡張不能で、全マージが監査行と consensus コメントを残す。**PEAS が「バイパス経路なし」で守っているものを、workforce は「バイパス経路を制度化して監査する」で守っている。**

---

## 7. 品質保証 — 決定論的検証 vs 審査員パネル

| | PEAS | workforce |
|---|---|---|
| 出力の性質 | コード（テストで真偽が決まる） | 大半が自然言語（記事・レポート・台本・分析）。コードは一部 |
| 第一の武器 | **TDD 強制** — test-engineer が「正しい理由で落ちるテスト」を先に書く。Gherkin 受入基準がチケットに必須 | **multi-candidate × multi-judge パネル** — 生成器 N × 審査員 M（編集／ドメイン／読者の視点）× per-level rubric、加重集計して `chosen` を決定 |
| 自動ゲート | lint／unit・integration・E2E／**カバレッジ床 80%**／doc-drift gate／secrets + SBOM スキャン／policy-ci／terraform-check／observability・SLO 検証／compose smoke | R-2 design-token lint／R-8 typecheck／R-9 sitemap／**R-10 コーパス truncation deploy gate**／R-11 L1 引用ゲート／R-12 登記簿整合／R-13 PR 終端状態 sweep／**W-1 publish 時 truncation guard（exit 2）** |
| 独立第二検査 | code-reviewer は**必ず実装者と別エージェント**。明示的な APPROVE が必要。security-engineer と agentic-AI-security（OWASP ASI Top 10）の 2 ガーディアン | `pr-autopilot` が **≥3 ペルソナのレンズパネル**を編成し全員 green が必要。記事側は judge ≠ generator ＋ **model disjointness rule**（AGENTS.md §2 rule 12） |
| 評価基準の所有 | デッキに Zone 概念なし（人間が持つ、と暗黙） | rubric 文言・閾値（`JUDGE_GATE`／`DIM_FLOOR`）・パネル名簿・モデルレジストリはすべて **Zone A**。rubric 変更は過去スコアを全無効化するので独立 PR |
| 証拠の残し方 | TRACEABILITY-MATRIX.md（63 operations）、テストレポート、Jira 履歴 | 記事ごとの `.eval.json` サイドカー（全候補・全審査員）。**サイドカー無しは publish 不可** |
| 非機能検証 | **k6 負荷試験**（4.74k req/s、p95 66.2ms、error 0.00%、300 VU）をハーネスがしきい値で判定しビルドを落とす | 相当物なし |

**考察.** 両者は「**作った者が検査してはならない**」という同一原理を、異なる媒体で実装している。これは独立到達した収束点として重い。

差は媒体に由来する必然と、未着手の gap が混在する：
- **必然**: 記事の良し悪しはテストで決まらないので、workforce は「審査員」を発明せざるを得なかった。逆に PEAS の領域では審査員は不要（テストが判定する）。
- **gap**: workforce の SDLC レーンには TDD 強制もカバレッジ床も SBOM も無い。これは意図的な差別化ではなく単に未整備。PEAS の Quality Gate 表はそのまま standardisation 提案の候補になる。

---

## 8. コスト・経済

| | PEAS | workforce |
|---|---|---|
| 実績 | **$7,215 / 6 週 / 11.48B トークン / キャッシュ効率 93.2%** | W-3 上限 **USD 500/月**（現在）。ペルソナごとに USD 5–8/月 |
| 安さの理由（自己申告） | 意図的なモデル階層（判断=Opus、実装=Sonnet、雑務=Haiku）＋積極的なプロンプトキャッシュ | ペルソナ単位の少額配分と、コール地点での throw |
| 統制機構 | dispatch budget **2×**（宣言した見積の 2 倍で自動停止）、round cap 2 | コール地点で月次トークン上限を超えたら **throw**（W-3）。CloudWatch Billing Alarm。上限引き上げは governance の**改正表に 1 行**（50→100→130→160→190→250→295→500 の履歴が残る） |
| 経済の意味づけ | ROI = 組織の存在証明。人件費（4 人 × 6 週 ≒ 120 人日）との対比が主張の核 | コストは憲法的制約（C-3）＋**人事的比喩**（月額は「給与」として採用メモで査定される） |

**考察.** 桁が 2〜3 違う（PEAS は 6 週で $7,215、workforce は月 $500 上限）。しかしどちらも「終了条件のない自律はコストリスクそのもの」という同じ危機認識から出発している。PEAS の dispatch budget（*宣言した見積の 2 倍*で止める）は workforce に無い発想で、**採用しやすく効果が明確な standardisation 候補**。workforce 側の「上限改正が governance ドキュメントの改正表に残る」は逆に PEAS に無い（財務の意思決定が統治文書と地続きになっている）。

キャッシュ効率 93.2% という数字を workforce は測っていない。これも gap。

---

## 9. トレーサビリティと記録

| PEAS | workforce |
|---|---|
| Jira ticket → commit → PR → review → deploy が 1 本の記録に接続 | `PROJECT#{id}/EXEC#{ulid}` 実行台帳、`RUN#`／`DELIV#`／`AUDIT#` 行、engagement（実績）記録、`PERF#` 分析 |
| TRACEABILITY-MATRIX.md — 63 operations を要求と対応付け | Epic ↔ Story ↔ PR ↔ issue の相互参照、backlog-reconcile Cadence が定期的に台帳を真実と突き合わせる |
| `/report` が隔週ステータスを自動生成 | 週次プロジェクト報告 ＋ **月次組織レター（公開記事として出す）** ＋ 週次 config ダイジェスト |
| ADR は `knowledge/decisions/` | ADR 25 + Epic 24 + hire round 稟議 + follow-ups + 2 登記簿 |

**共通の価値観（ほぼ同文）**:
- PEAS: *"Results first, explanation second. … This presentation is secondary to what is in the repository."*
- workforce MVV 値 7: *"Output is evidence; feedback is fuel."*

**差**: PEAS のトレースは **プロダクト単位**（要求 → コード → デプロイ）。workforce のトレースは **組織単位**（誰が・何を・いくらで・どの権限で）。前者は監査法人が見る形、後者は人事・会計が見る形。

---

## 10. 記憶と組織学習 — 同じ課題、進捗段階が違う

**PEAS（デッキの自己申告そのまま）**
- PRODUCTION-PROVEN: 「決定・runbook・ルールの成熟した knowledge base が日常運用されている」
- EXPERIMENTAL: 「**per-agent memory は配線済みだが長期的価値は未実証**」
- ROADMAP 04: 「**Shared Agent Memory** — エンジニアのセッションを跨いでプロジェクト知識を蓄積する永続メモリ層」

**workforce**
- 二層構造：**episodic**（S3 `memory/{slug}/vNNNN.md` チャンク＋ compactor、Epic-012）と **semantic**（`META.memory` の散文、ADR-0019、`memory-curation` Cadence、ADR-0020 で書き込みを限定委任、ADR-0021 で短命トークン化）。
- **Epic-022「組織学習」** — 1 人の学びを翌日には全員の前提にする lesson stream：日次 Lambda が前日の実行記録から候補教訓を抽出 → 決定論的 pre-filter（**fail closed**、命令文パターンは自動隔離）→ ≥2 名のキュレーション → **V1 は全件 operator の週次ダイジェスト経由** → scope 条件付きで各 fire に **~500–800 token 上限**で inert（引用形式・非命令）注入。ペルソナの `system_prompt` は絶対に書き換えない（W-5 不可侵）。

**考察.** **PEAS のロードマップ 04 は、workforce の Epic-022 とほぼ同一の課題設定である。** 同じ順序（まず repo 知識ベース → 次に共有メモリ）で同じ壁を認識しており、workforce が 1〜2 手先行している。ここは workforce → PEAS の知見移転が最も直接的に効く箇所。特に workforce 側が Epic-022 で先に潰した論点：

1. **教訓の注入は injection 攻撃面**である（毒された「教訓」が 35 エージェントの前提になる）→ 決定論的 pre-filter を LLM 判断の *前*に置き fail closed する。
2. **scope はマシン導出**にする（distiller が自由にタグを発明すると必ず drift する）。
3. **注入ブロックは fire ごとにログする**（さもないと挙動変化が再現不能）。
4. **「翌日」を名乗らない正直さ** — 週次ゲートがある間は「within-a-week」と書く。

---

## 11. スケール前提 — 横展開か、増員か

| PEAS | workforce |
|---|---|
| 4 人間 × 12 エージェント × 1 プロダクト | 1 人間 × 約 35 ペルソナ × 複数プロジェクト |
| スケール = **他部門への横展開**。Adoption Guide が「再利用できる部分／作り直すべき部分」を明示 | スケール = **縦の増員**。全 Epic に「Behaviour at N = 100+ agents」節が必須で、O(N²) を作らないことがレビュー観点 |
| ロードマップ 03「Meta-Harness」= 1 オーケストレータが複数プロダクトパイプラインを、依存関係追跡付きで管理 | Project が信頼境界（Epic-010）。`asp-cloud` / `project-ind` / `conference` / `agent-workforce` が並走 |
| 人間は増える前提（部門が増えれば人も増える） | **人間は永久に 1 人**（C-3）。だから「人手を要さない比率」を上げるしかない |

**考察.** PEAS の Meta-Harness は workforce の Project 機構とほぼ同じ問題を解こうとしている。ただし動機が違う：PEAS は「別チームに配れるように」、workforce は「1 人の人間の注意で足りるように」。**C-3（single-operator scale）という憲法が workforce の設計をほぼ全て説明する。** 逆に言えば PEAS が multi-team を前提にした瞬間、workforce の設計の多く（trust ladder、human leverage 指標、委任マージ）は動機を失う。ここは **decision であって gap ではない**。

---

## 12. 不確実性の扱い — 最も強く一致する文化

**PEAS**（スライド 42 "HONEST LIMITS"）が自分から挙げた未達：
- loop governor は設計は健全だが本番走行距離が短い
- agentic-AI security reviewer はまだ全 PR の定常ゲートではない
- per-agent memory の長期価値は未実証
- **仕様は ephemeral**（永続性はチケットと ADR に依存）
- pre-commit hook は 1 言語しか検証しない
- staging は意図的に緩い認証で、戻す必要がある
- **オーケストレータは人間が起動する。デーモンではない**

そして結び：*「正確な期待値で導入したチームは成功する。成功譚だけで導入したチームは離脱しがちで、次のチームの説得を難しくする」*

**workforce** の対応物：
- **risk-acceptance ledger**（受容したリスクに operator が merge で署名し、再提起を抑止）
- **follow-ups.md** / memory-lint backlog（未処理の宿題を番号付きで持ち回る）
- Epic に **Falsifier** 節を必須化（「この条件になったら仮説は棄却された、と先に書く」）
- Epic-020「**under-claiming beats storytelling**」「a defensible undercount beats a story」
- Epic-019 で「30 は桁ではなく 5 倍である」と算術の正直さを事前約束
- **Goodhart 条項**（指標を目標にしない、と指標定義の中に書く）
- デモ／数字の外部引用時に caveat を付ける責任者（celeste）を指名

**考察.** 本比較で **最も深く一致する**のがこの軸。両者とも「都合の良い数字を作らない」を*制度*にしている。PEAS の "PRODUCTION-PROVEN / EXPERIMENTAL / NOT YET BUILT" の 3 分類は、workforce の ledger／follow-ups／Falsifier とほぼ同じ機能を、より読みやすい 1 枚で果たしている。**この 3 分類は workforce がそのまま採用できる表現形式**（現状 workforce の「何が実証済みで何がまだか」は 4 つのドキュメントに散っている）。

---

## 13. 外部への露出と信頼境界

| PEAS | workforce |
|---|---|
| 完全に社内。外部露出なし | 記事が `kohuehara.xyz`、Podcast が Spotify に**公開される** |
| 第三者検証は社内他部門 SAC | 検証は operator ＋ 読者反応（GA4）＋ 公開月次レター |
| 外部リポジトリへの書き込みなし | **R-N9**: 外部 git は PR のみ、直 commit 禁止（PAT スコープでもワイヤレベルで拒否させる）。**R-N10**: 委任された場合のみマージ |
| — | 資金調達・IR・政策提言のペルソナは全員 **outreach を hard-refuse**（起案するが行動しない）。C-3 では「ロビイング」は *意見公募の期限追跡＋意見書ドラフト*としてしか実装できない |

**考察.** workforce は「組織の外に出ること」自体を設計対象にしている（公開・外部リポジトリ・投資家向け）。その分だけ「エージェントが外部に対して行動する」ことの制約設計（hard-refuse outreach、PR-only、委任マージ、project-scoped credential）が厚い。PEAS は社内に閉じているため、この層の設計は不要 —— ただし他部門展開が始まればすぐ必要になる領域である。

---

## 14. メタファ — 工場か、国家か

- **PEAS = 規律ある工場／エンジニアリング組織。** エージェントは工程、統制は安全装置、成果はスループットと単価。語彙は「ゲート」「ガバナ」「パイプライン」「ハーネス」。目標は *"software ships at AI speed without giving up enterprise control"*。
- **workforce = 国家／会社。** 憲法・法律・規制・判例（ADR）・登記簿・人事・給与・採用・稟議・実績・信頼階梯・審議委員会。語彙は「Zone」「statute」「amendment」「delegation」「trust tier」「hire round」。目標は *"the operating model for human-agent co-creation"* そのものの発明。

このメタファの差は装飾ではなく、**何を増やせば組織が伸びるかの仮説**の差である。PEAS は工程とゲートを増やす。workforce は席と権限と記録を増やす。

---

## 15. 数字の並置（同一条件ではないので比較ではなく対置）

| 指標 | PEAS | workforce |
|---|---|---|
| 人間 | 4 名 | 1 名 |
| エージェント | 12（3 層） | 約 35（VP 階層 + IC） |
| 変更スループット | 330 Jira チケット / 6 週 | 218 PR / 28 日 |
| 人手ゼロで完了した変更 | **0**（設計上の不変量） | **6 / 218 = 2.8%**（引き上げ対象の KPI） |
| AI 生成比率 | 本番コードの >90%、ドキュメントの >80% | 未計測 |
| コスト | $7,215 / 6 週（11.48B tokens、cache 93.2%） | 上限 USD 500 / 月 |
| 決定記録 | ADR（`knowledge/decisions/`）＋ 63 ops のトレーサビリティ行列 | ADR 25 ＋ Epic 24 ＋ 採用稟議 |
| 定期業務 | なし（人間起動のセッション） | 36 Cadence（cron / event 駆動） |
| カバレッジ床 | 80%（ブロッキング） | 相当物なし |
| 負荷試験 | k6 しきい値でビルドを落とす | 相当物なし |

**注意**: チケットと PR は粒度が違い、6 週と 28 日も違う。ここから生産性の優劣は読めない。読めるのは **「1 人の人間が 218 PR を捌く組織」と「4 人の人間が 330 チケットを捌く組織」がほぼ同じ変更流量を持っている**という事実で、これは workforce の C-3 制約が実際に機能していることの傍証になる（同時に、だからこそ 2.8% を上げないと人間が律速する、という Epic-019 の問題意識の妥当性も裏づける）。

---

## 16. 総合考察 — 何が同じで、何が違い、どちらが gap か

### 16.1 独立到達した収束点（＝おそらく agentic 開発の普遍解）

1. **統制は文化ではなく構造に埋める。** PEAS の "structural gate, not policy" と workforce の L2 機械ゲート＋ratchet は同じ命題。
2. **作った者は検査してはならない。** code-reviewer ≠ implementer ／ judge ≠ generator（＋ model disjointness）。
3. **仕様が先。** Gherkin AC ＋ failing test ／ Epic の Acceptance criteria ＋ Falsifier。
4. **終了条件のない自律はコストリスク。** round cap / dispatch budget ／ W-3 throw / cycle cap。
5. **ゲート設定自体を版管理し、変更をレビュー経路に載せる。** CI が CI 設定を検査 ／ L0/L1 ブロックが自分自身の内側にある。
6. **証拠が本体、プレゼンは二次。**
7. **正直さを制度化する。** 3 分類の HONEST LIMITS ／ risk ledger・Falsifier・Goodhart 条項。
8. **エージェント基盤は自前で作らない。** `~/.claude/` 可搬性 ／ design-policy D-3。

この 8 点が両者で一致していることは、PEAS の主張「これは医療の問題ではない（どの部門でも同じ壁）」への強い外部証拠になる。ドメインも規模も動機も人数も違う 2 つの組織が、同じ 8 つに独立到達している。

### 16.2 意図的な差異（decision — 標準化すべきでない）

| 差異 | なぜ decision か |
|---|---|
| 実行が人間起動 vs スケジュール自走 | PEAS は可搬性（他部門配布）、workforce は人間不在耐性を最適化。目的関数が違う |
| 設定の真実が git vs DDB | 同上。可搬性 vs 稼働中の変更容易性・監査行 |
| 12 の無名役割 vs 35 の人格 | PEAS は SDLC の分業、workforce は会社機能の分業。人格は後者の統制機構（実績・信頼階梯）の前提 |
| 境界が固定 vs 計測して動かす | 人間 4 名の PEAS では人間が律速にならない。人間 1 名の workforce では律速になる（C-3） |
| 社内閉鎖 vs 外部公開・外部リポジトリ | workforce の成果物が公開物であることに由来 |
| コストが ROI 主張 vs 憲法制約 | 存在目的の差（証明の組織 vs 発明の組織） |

### 16.3 workforce 側の gap（PEAS から標準化を検討すべき）

**差別化バッジを貼らずに gap と認めるべきもの**（design-policy D-2 の反射）:

1. **決定論的検証の厚み（最重要）** — SDLC レーンに TDD 強制・カバレッジ床・doc-drift gate・SBOM/secrets スキャン・IaC policy check が無い。PEAS の Quality Gate 表はほぼそのまま導入候補。
2. **dispatch budget（宣言見積の 2× で自動停止）** — workforce の W-3 は「月次上限」であって「タスク単位の見積比」ではない。粒度が粗く、1 タスクの暴走は月末まで気づかない。導入コストが低く効果が明確。
3. **単一タスクインターフェース（`justfile`）** — 「CI と同じゲートをローカルで 1 コマンド」は workforce に無い。skill ごとに write-script が散在している。
4. **非機能検証（k6 しきい値でビルドを落とす）** — workforce に相当物なし。ただし workforce の成果物の多くは記事なので、適用先は SDLC レーンと API 面に限られる。
5. **キャッシュ効率の計測** — 93.2% という数字を PEAS は主張の柱にしている。workforce はトークン量を上限管理しているが効率を測っていない。
6. **HONEST LIMITS の 3 分類（PRODUCTION-PROVEN / EXPERIMENTAL / NOT YET BUILT）** — 内容ではなく *提示形式*の借用。workforce の「何が実証済みか」は ledger・follow-ups・Epic status・ROADMAP の 4 箇所に散っている。
7. **least agency の実装層** — 「危険なコマンドをブロック」「エージェントは自分の鍵を作れない」を PEAS は Wall 4 の答えとして持つ。workforce は ADR-0009 scoped capability token / ADR-0021 短命トークンでトークン面は固めているが、*ツール権限・コマンド面*の明示的な最小権限設計は薄い。

### 16.4 PEAS 側の gap（workforce から移転しうるもの）

1. **オーケストレータの常時自走** — PEAS 自身が NOT YET BUILT に挙げている。workforce の EventBridge → orchestrator-tick → runner は 1 年近い運用実績がある。ただし PEAS が Lambda 化するとインタラクティブツールが使えなくなる（workforce が R-N1 例外で解いた問題）ので、**R-N1 の「実行面を列挙し、例外を宣言する」という形式**ごと参考になる。
2. **組織学習の共有メモリ** — PEAS ロードマップ 04 ≒ workforce Epic-022。前掲 §10 の 4 つの先行知見（injection 面の pre-filter、scope のマシン導出、注入ブロックのログ、latency の正直な表明）はそのまま移転できる。
3. **ルールの改正手続きの法制化** — PEAS は「ゲート設定を PR で変える」までは持つが、*どのルールがどの承認バーか*の階層（L0/L1/L2/L3 × Zone A/B/C/D）は持たない。8 つの壁が 20 個に増えたときに効いてくる構造。
4. **memory→lint ratchet** — 「2 回目の再発で自動的に機械ゲートへ昇格」。PEAS は loop governor を「security audit で指摘されたので追加した」と書いており、まさに ratchet が自動化する経路を手動で通っている。
5. **risk-acceptance ledger** — 「本物だが対処しないと決めた」を署名付きで残し再提起を抑止する機構。PEAS の HONEST LIMITS は近いが、*再提起抑止*の効果は無い（毎回の監査で同じ指摘が戻る）。
6. **仕様の永続性** — PEAS が NOT YET BUILT に「仕様は ephemeral、永続性はチケットと ADR に依存」と挙げている。workforce の Epic ドキュメント（Falsifier・Acceptance criteria・RFC record・status reconciliation の追記履歴つき）は、まさにその ephemeral さを埋めるために生えた形式。

### 16.5 相互の弱点はほぼ相補的

- workforce の中核的弱点は **「出力の大半が決定論的に検証できない」**（記事・レポート・台本）。だから審査員パネルという重い機構を発明せざるを得ず、そのぶん SDLC の基本的な機械検査が薄いまま残った。
- PEAS の中核的弱点は **「人間が起動しないと何も始まらない」ことと「学習が個人セッションとリポジトリに留まる」**。だから 4 人の人間が実務者として常駐する必要があり、そのぶん組織としての自走・自己改善の機構が育っていない。

**片方が深く掘った所を、もう片方が浅く残している。** 交換の余地が大きい 2 組織という結論になる。

---

## 17. この比較の限界

- PEAS 側の情報源は 47 スライドのプレゼン資料 1 点のみ。リポジトリも実行ログも見ていない。デッキが「持っている」と書いていないものを「無い」と断定した箇所（例：Zone 概念の不在、キャッシュ効率以外のコスト計測）は、単に発表対象でなかっただけの可能性がある。
- 数字（330 チケット / 218 PR、$7,215 / USD 500）は測定期間も粒度も定義も揃っていない。§15 は対置であって比較ではない。
- 当 workforce 側の記述はドキュメント（statute / ADR / Epic）に基づく。**書かれた設計と実際の稼働は一致しないことがある** — 特に Epic-020/022/023 は Accepted だが未実装（`Implemented by: —`）であり、「持っている」ではなく「決めた」段階である。§16.3 の gap 判定にはこの非対称（PEAS は実績報告、workforce は設計文書）が混入している可能性がある。
