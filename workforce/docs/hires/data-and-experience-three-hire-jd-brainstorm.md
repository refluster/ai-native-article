# 2026-08 — Data & Experience 三席：JD ブレスト（ラウンド前の JD 明確化メモ）

- **Status**: **Brainstorm / pre-round.** ラウンド本体（seed bundle、パネル招集、W-3 判定、登録）は未着手。このメモは *JD を固めるための論点整理* であり、hire round そのものではない。
- **Operator request** (2026-08-06): `asp-cloud` / `smartmeter-data-analysis` / `project-ind` の3プロジェクトに向けて **データサイエンティスト / データエンジニアリング / UX（工業デザインではなく人間理解側）** の3席を採りたい。「それに先立って JD をクリアにしたい、LinkedIn もリサーチしながら」。
- **Scope**: 外部3プロジェクト（PSVL）向けの席。`workforce/projects/{asp-cloud,project-ind,smartmeter-data-analysis}/project.json` はいずれも `owner_agent: nadia`、レビュアレンズは Dario / Ren / Aoi。
- **決めてほしいことは §6** に集約。

---

## §0. 結論（先に3行）

1. **DS と DE の境界を、市場の標準的な線で引き直す。** オペレータの原文では DE 側に「分析パイプラインの設計」と「DS / PdM / EM が意思決定できる状態を作る」が *両方* 入っている。2026年の市場ではこれは **Data Engineer**（ingest / raw & staging / orchestration / platform）と **Analytics Engineer**（modeled & marts 層、メトリクス定義、data tests、semantic layer）という別々の職能に分かれている。C-3 の規模では1席に統合してよいが、**統合していると JD 上で明示する**（推奨タイトル: *Analytics Platform Engineer*）。黙って混ぜると「Spark を回せる人」の JD に読まれ、実際に欲しい「意思決定のレイテンシを縮める人」が来ない。
2. **UX 席は UI デザイナーではない。** 原文の記述（認知・感情・記憶・信頼形成・愛情、心理学・行動経済学）は市場語彙では **Behavioral Scientist** あるいは **mixed-methods UX Researcher**。さらに asp-cloud の要求（外側から自動制御される + 動的料金を理解していない状態で実証開始）は、**trust-in-automation / 手続き的公正**という既存の研究文脈にそのまま乗る。Opower（Cialdini の social norms → normative comparison）という明確な先行職能があるので、JD をそこに接続すれば「何を持っている人か」が一意に決まる。
3. **3プロジェクト横断で書くと unicorn JD になる。** 3席とも、プロジェクトごとに求められるものが実は別 archetype（下表）。**共通コア（＝採用基準）とプロジェクト固有（＝配属後に効く差分）を JD 上で分離**しないと、「NILM もできて Spark も書けて心理学 PhD」みたいな募集要項になる。

| 席 | asp-cloud で要るもの | smartmeter で要るもの | project-ind で要るもの | **共通コア（＝これで採る）** |
|---|---|---|---|---|
| DS | 疎な IoT 信号 → 物理世界の推定＋アルゴリズム調整（Airbnb でいう *Algorithms* 寄り） | 大規模探索分析・負荷研究（*Analytics* 寄り） | プロダクト分析＋SNS 大量テキストの特徴抽出（*Analytics* + NLP） | **仮説 → 計測設計 → 検証 → 意思決定** のループを自分で回せること。「定数と変数の分離」＝交絡の統制。 |
| DE | 大量 IoT の読み出し、PdM/EM が判断できる状態 | 10^9 行級の中間層設計、MapReduce 的分割 | Web 利用ログ＋外部 SNS データの取り込み | **意思決定のレイテンシ設計**。再集計コストとアナリストのリードタイムを交換設計できること。 |
| UX | 自動制御＋動的料金という不透明な体験への信頼形成・維持（長期・段階的） | （直接の接点は薄い — 分析結果の解釈支援） | 訪問前からの心理的安心、越境（米国製・インド利用）のオンボーディング | **人間の認知・感情・信頼のフレームワークを持ち、それを測定可能な形に落とせること。** |

---

## §1. 市場リサーチ（LinkedIn / 求人市場で実際にどう呼ばれているか）

JD の言葉選びは母集団を決める。ここは「かっこいい表現」ではなく **検索にヒットする語彙**の問題として調べた。

### 1-1. データサイエンティスト

- **職能の分割の仕方**: Airbnb は DS を **Analytics / Inference / Algorithms** の3トラックに明示的に分けている（Analytics = 分析から戦略的意思決定、Inference = 統計・因果、経済学/統計の博士級、Algorithms = モデルを実装して機械学習システムを本番に載せる）。Netflix は **experimentation & causal inference** を DS の主要フォーカスとして掲げ、実験の設計・分析・解釈をリードすることを役割に据えている。
  → オペレータの記述（「次の AB テストを組む」「全体を定数と変数に分離する」「追加投入すると効くデータポイントを提案する」）は **Analytics + Inference** 側の記述であって、Algorithms ではない。**JD で言い切る**と母集団が正しくなる。
- **ドメイン側の母集団（LinkedIn で辿れる実在プール）**:
  - *ホームエネルギー系*: **Bidgely**（2011年以来 20人超の DS が disaggregation アルゴリズムを開発、センサ無しでスマメの低頻度データから12種の家電負荷を推定）、**Uplight**（Tendril / Simple Energy / FirstFuel の統合体、米国最大級のユーティリティ向けエネルギー管理ソフト）、**Sense**（$105M 調達、宅内リアルタイムエネルギーデータ）、**Oracle Utilities Opower**。Bliq のような「家庭のエネルギー使用・太陽光・EV・市場価格を統合し、家庭用蓄電池の性能を最適化するアルゴリズムを設計・改良する DS」の JD は asp-cloud の記述とほぼ同型。
  - *プログラム評価コンサル*: **Cadmus / Opinion Dynamics / DNV / Guidehouse**。この層は「その介入は本当に効いたのか」を検針データで因果推論するのを職業にしている。**asp-cloud の実証評価に驚くほど近く、かつ DS 市場では見落とされがちなプール**。ここは狙い目。
- **asp-cloud 固有の難所**: 「限られた IoT データから住人の生活実態と機器状態を読む」は学術的には **NILM / load disaggregation**。低サンプリングのスマメデータからの推定は活発な研究領域で、FHMM / CO / Seq2Point / SGN / DAE / BiLSTM といったアルゴリズム系譜がある。
  → **nice-to-have に置くのは正しい。must に上げると母集団が細くなりすぎる**（NILM 実務者は世界的に見ても薄い）。代わりに must は「疎で不完全な観測から物理的にありえる仮説を立てられるか」という**態度**で問う。

### 1-2. データエンジニアリング

- **2026年の市場定義**: Data engineer が **ingest / raw & staging 層 / orchestration / platform** を持ち、Analytics engineer が **modeled & marts 層 / メトリクス定義 / data tests / semantic layer** を持つ、という分割が定着している。アーキテクチャの型は `Raw → Staging → Facts & Dimensions → Semantic Layer → Metrics → Decisions`。2026年の analytics engineer は個々のモデル実装よりも「モデル群のシステムとしての振る舞い — どのモデルがどのメトリクスの source of truth か、ドメイン境界はどこか、semantic layer をどう構造化すれば下流の AI クエリが一貫した答えを返すか」に軸足を移している。
  → オペレータの言う **「中間データと柔軟な分析フロントエンドの切り分け」は medallion + semantic layer の言い直し**そのもの。この語彙を JD に入れるだけで、LinkedIn 上の該当者が自分ごととして認識する。
- **スケールの読み**: 数万世帯 × 3年 × 30分粒度 ≒ **10^9 行オーダー**。2026年にこれは "big data" ではなく **設計問題**。JD は「Spark を回せる」ではなく「**再集計のコストとアナリストのリードタイムを交換設計できる**」を問うべき。
- **語彙**: 時系列基盤は **Amazon Timestream**（asp-cloud が実運用で使用 — `.claude/skills` の `asp-data` 参照）、Timescale / ClickHouse / Druid / Influx。処理は Spark / AWS EMR。AMI/MDM 側のプールは Itron / Landis+Gyr / Oracle MDM / Kaluza / Kraken、および「Smart Grid / AMI の高ボリューム・テレメトリとイベントデータの取り込み・変換・保存パイプライン」を掲げる電力系プラットフォームエンジニア職。

### 1-3. UX（人間理解側）

- **タイトルが3つに割れている**: **Behavioral Scientist**（社会科学の知見を、UX チームより *前段* の「どの行動を起こさせるか」に適用する。ユーザの欲求と達成すべき行動を接続する）/ **UX Researcher (mixed-methods)**（顧客リサーチ手法で需要と痛みを理解し、体験に落とす）/ **Design Researcher**。behavioral science は「職種名というより専門性」と整理されるのが通例で、**心理学 PhD はどのタイトルにも流れる**。逆に言うと **タイトルを間違えると母集団が丸ごと変わる**。
- **先行職能が明確に存在する**: **Opower** は 2008年に behavioral energy efficiency（BEE）産業を作った。基盤は 30年以上 social norms を研究した Robert Cialdini の知見で、**normative comparison アルゴリズム**が製品の中核。以降も "Efficiency Zones"（似た効率的な世帯との比較ではなく目標ゾーンとの比較）など行動科学的手法で更新を続けている。
  → **「行動科学 × エネルギー × 大規模デジタルコミュニケーション」は実在する職能**。JD をここに接続すれば具体性が一気に上がる。
- **asp-cloud の核心論点には既存の研究基盤がある**: 動的料金の受容は **手続き的公正 (procedural fairness) と善意の推定 (benevolent intent) の知覚**に依存し、**価格の結果が本人に不利なときですら、透明性と公正感が負の行動反応を緩和する**。透明性の欠如は「操作された」という感覚を生む。自動化一般でも、**信頼性と透明性の高いエージェントが行動上の信頼を高める**（条件付き自動運転の実証）。
  → これは JD の success measure を「満足度」ではなく **信頼の測定可能な代理指標**（オプトアウト率、オーバーライド率、問い合わせの内容分布、説明への到達率）に置ける、ということ。ここが「サイエンスとコミュニケーションできる人」の実装形。
- **project-ind の難所は別物**: 接点が Web アプリのみ、提供者が米国・利用者がインド、**訪問前からの期待形成**。これは UXR というより **越境の信頼形成 / ブランドコミュニケーション**寄り。→ **Celeste（VP Marketing）との lateral が構造的に必須**（オペレータ自身が「密に連携するのは Product と Marketing」と書いているのと一致）。

---

## §2. 3席それぞれの「一文ミッション」（まずここを合意したい）

| 席（推奨タイトル） | 一文ミッション | **落とすもの**（期待しないこと） |
|---|---|---|
| **Product Data Scientist, Experimentation & Field Inference** | 限られた観測から生活実態・機器状態の仮説を立て、**次に打つ検証を設計し**、「どのデータを足せば最も効くか」を効果順に提案する | 本番 ML システムの実装・サービング・MLOps |
| **Analytics Platform Engineer** | **意思決定のレイテンシを縮める。** raw → 中間層 → 分析フロントエンドの3層を設計し、「新しい切り口を思いついてから答えが出るまで」を日から時間にする | プロダクト機能のバックエンド実装、インフラ運用当番 |
| **Behavioral Design & Trust Researcher** | 自動制御と価格変動という**本質的に不可解な体験**に対して、信頼を**設計し、測る** | UI の見た目・デザインシステム・デザイントークン（Zone A） |

---

## §3. JD ドラフト（seed bundle の `jd` ブロック形式）

そのまま `*.json` に落とせる形で書いた。ラウンド本体では persona 名（`workforce/docs/naming.md` の規約）と residence / model / budget を足すだけにしたい。

### 3-1. Product Data Scientist, Experimentation & Field Inference

```
mission:
  疎で不完全な観測から「いま現場で何が起きているか」の仮説を立て、その仮説を否定できる
  検証を設計し、実証と製品の次の一手を決める。答えを出すことと同じ比重で、
  「どのデータポイントを追加投入すれば最も効くか」を効果とコストの順に提案する。

key_responsibilities:
  - asp-cloud: 限られた IoT テレメトリ（機器電力・状態）から住人の生活実態と機器状態を推定する
    仮説を立て、エネルギーマネジメント・アルゴリズムの編集案に翻訳し、実証で検証する。
    推定は必ず「物理的にありえるか」で一次スクリーニングする。
  - 検証設計を持つ: 何を定数として固定し、何を変数として動かすか、交絡は何か、
    ランダム化できないときにどの準実験（DiD / 合成対照 / 回帰不連続）を使うかを明示した
    実験計画を書く。効果量の事前見積りと必要サンプルを添えない実験計画は出さない。
  - smartmeter-data-analysis: 数万世帯 × 3年のスマートメータ・データから、
    仮説駆動でインサイトを掘る。「集計して眺める」ではなく、問い → 切り分け → 反証、の順で進む。
  - project-ind: Web アプリの利用実態と Reddit / YouTube 等の大量テキストから
    利用者の特徴と洞察を導き、プロダクト意思決定に接続する。
    ソーシャル由来の主張は必ず標本バイアスの但し書きを付ける。
  - データ投入の提案: 現状の観測で答えられない問いを列挙し、
    「このデータポイントを足せば、この問いが、この精度で答えられる」を効果順に並べて提案する。
    取得コスト・プライバシー影響・実装負荷を必ず併記する。
  - Nadia（PdM）と Dario（EM）が判断できる粒度に落とす: 分析結果は
    「示唆」ではなく「意思決定の選択肢と、それぞれが賭けている前提」として渡す。
  - 分析パイプラインの要求を Analytics Platform Engineer 席に仕様として渡す
    （欲しい中間層の粒度、更新頻度、許容遅延）。自分で基盤を作りにいかない。

success_measures:
  - すべての実験提案が「定数 / 変数 / 交絡 / 検出したい効果量 / 必要サンプル」を明記している。
  - 分析結果が、選択肢と前提の形で提示され、Nadia / Dario が追加質問なしに判断できている。
  - 「追加投入すべきデータポイント」の提案が、期待効果とコストの順に並び、
    実際に投入されたものが事前に述べた効果を出したかを事後に検証している。
  - 不確実性が数値化されている。信頼区間なしの点推定、n を書かない割合、
    標本バイアスの但し書きのないソーシャル分析は出さない。
  - 反証されて捨てた仮説が記録として残っている（当たった分析だけが残る状態にしない）。

operating_principles:
  - 疎な観測から言えることは少ない。少ないことを少ないと言うのが仕事。
  - 定数と変数を分離できていない問いは、まだ実験ではない。
  - 「どのデータを足すか」は分析結果と同格の成果物。データがないことは分析の限界ではなく提案の起点。
  - 物理的にありえない推定は、統計的に有意でも間違い。
  - 相関を見つけた時点は仕事の始まりであって終わりではない。
```

**must（採用基準）**: 因果推論の実務（AB / 準実験のどちらでも）／ 交絡と選択バイアスへの反射／ 疎・欠損・不揃いな実データの経験／ 結果を意思決定の言葉に翻訳した実績。
**strong plus**: NILM / load disaggregation、電力・エネルギー領域、時系列、プログラム評価（DR/EE 評価の因果推論）、大規模テキストからの特徴抽出。
**anti-signal**: モデル精度を成果として語る／「まずデータを全部見せてください」から入る／ 実験の失敗経験を語れない。

### 3-2. Analytics Platform Engineer

```
mission:
  意思決定のレイテンシを縮める。raw テレメトリ → 中間層 → 分析フロントエンド、という三層を
  設計・実装し、データサイエンティストが新しい切り口を思いついてから答えに到達するまでの
  時間を「日」から「時間」にする。Software 2.0 のデータドリブンな改善サイクルを、
  ソフトウェアスタックの側から成立させる。

key_responsibilities:
  - smartmeter-data-analysis: 数万世帯 × 3年（10^9 行オーダー）に対して、
    分割・並列集計（MapReduce 的な分解）と中間データ層の設計を行う。
    「どの粒度で中間層を作り置きするか」を、再集計コストと分析の自由度の
    トレードオフとして明示的に決め、その判断根拠を残す。
  - 中間データと分析フロントエンドの切り分けを設計する:
    どこまでを事前集計で固め、どこから先をアナリストの自由に開けるか。
    メトリクスの定義がどこに一元化されるか（semantic layer）を決め、
    同じ指標が二か所で別々に定義される状態を作らない。
  - asp-cloud: 大量の IoT テレメトリ（Timestream 系）を、DS が仮説検証に使える形と、
    Nadia（PdM）/ Dario（EM）が経営判断に使える形の両方に落とす。
    この二つは同じテーブルではない、という前提で設計する。
  - データ品質を機構で担保する: freshness / 行数 / 分布のテストと、
    壊れたときに静かに古い値を返すのではなく落ちる設計（C-4 fail loud）。
  - project-ind: Web 利用実態ログと外部ソーシャルデータの取り込みを、
    同じ三層モデルに載せる。外部データは特にスキーマ変化に対する契約を明示する。
  - DS 席の分析要求（欲しい中間層の粒度・更新頻度・許容遅延）を仕様として受け取り、
    「それは中間層で持つ / 都度計算する / そもそも取得していない」を返す。
  - コストを設計変数として扱う: ストレージ・計算・クエリの単価を把握し、
    設計案には概算コストを添える。

success_measures:
  - アナリストが新しい切り口を思いついてから最初の答えが出るまでのリードタイムが
    継続的に短くなっている（測っている）。
  - 主要メトリクスの定義が一か所にあり、ダッシュボードと分析ノートで数字が食い違わない。
  - パイプラインの失敗が静かな劣化ではなく明示的な失敗として現れる。
  - 新しい設計提案が、必ず「作り置きコスト vs 自由度 vs 概算費用」の三点で説明されている。
  - スケールの主張が実測に基づく（「Spark なら速い」ではなく、この分割でこの時間、という形）。

operating_principles:
  - 速さは中間層の置き方で決まる。エンジンの選択はその次。
  - 同じ指標が二か所で定義された時点で、その指標はもう信用できない。
  - 全部リアルタイムにするのは設計ではなく、判断の放棄。
  - 壊れたパイプラインは古い数字を返してはいけない。落ちるべき。
  - 使われていない中間テーブルは資産ではなく負債。
```

**must**: SQL と Python の実務、ELT/ETL パイプラインの設計と運用、次元/ファクトまたは medallion 的な層構造の設計経験、データテスト・監視の実装、時系列または大量イベントデータの扱い。
**strong plus**: dbt / semantic layer（MetricFlow / Cube / LookML）、Spark / EMR、Timestream / ClickHouse / Timescale / Druid、AMI・スマートメータ（Itron / Landis+Gyr / Kraken / Kaluza 系）、コスト最適化の実績。
**anti-signal**: 最初の一手が「まず基盤を刷新しましょう」／ 全ストリーム・リアルタイム化を無条件に推す／ 誰が何を意思決定するのかを聞かずに設計を始める。

### 3-3. Behavioral Design & Trust Researcher

```
mission:
  「自分の家の機器が、自分の外側で、理解していない価格ルールに従って動く」という
  本質的に不可解な体験に対して、信頼の形成・維持・回復を設計し、測定する。
  認知・感情・記憶・信頼形成の学術的フレームワークを、
  プロダクトとコミュニケーションの具体的な意思決定に翻訳する。

key_responsibilities:
  - asp-cloud: 実証開始時点で住人はダイナミックプライシングを理解していない、という前提で
    初期コミュニケーション設計を持つ。一通目で何を言い、何を言わないか。
    理解を「段階的に加えていく」経路と、「段階的に放置しても安心できる」経路の
    両方を設計する（全員を学習させようとしない）。
  - 信頼を測定可能にする: 満足度スコアではなく、行動に現れる代理指標
    （オプトアウト率、手動オーバーライド率、問い合わせ内容の分布、
    説明への到達率、不利な価格イベント後の離脱）を定義し、追跡する。
  - 手続き的公正の観点でコミュニケーションを設計する:
    価格の結果が本人に不利なときに信頼が壊れないのは、透明性と公正さの知覚があるとき。
    「なぜこの制御が起きたか」を、事後ではなく事前と事中に届ける設計を持つ。
  - 信頼が壊れる瞬間を先に列挙する（予期しない制御、不快な室温、高額請求、説明の不在）。
    その各々に対する検知と回復のコミュニケーションを用意する。
  - project-ind: 接点が Web アプリのみ、提供者が米国・利用者がインドという乖離のもとで、
    「訪問前」からの期待形成とオンボーディングを設計する。
    越境ゆえの信頼の欠損要因を特定し、Celeste（Marketing）と共同で
    サイト到達前のコミュニケーションに落とす。
  - 定性と定量を接続する: インタビュー / 日記法 / 行動ログ / 実験を組み合わせ、
    定性の発見を DS 席が検証できる仮説の形に落とす。
    「ペルソナを作った」で終わらせない。
  - 行動科学の適用に線を引く: 理解を助ける設計と、理解を迂回して行動だけ変える設計は違う。
    後者は提案しない。

success_measures:
  - 信頼が、少なくとも3つの行動指標として定義され、実際に計測されている。
  - すべてのコミュニケーション提案が、依拠する枠組み（社会的規範、手続き的公正、
    自動化への信頼、期待違反、など）と、それが外れた場合の観測結果を明示している。
  - 「信頼が壊れる瞬間」のリストが事前に存在し、実証中に起きた事象がそのリストに
    載っていたか / 載っていなかったかが振り返られている。
  - 定性の発見が、DS 席が検証できる仮説として少なくとも定期的に受け渡されている。
  - Product（Nadia）と Marketing（Celeste）の両方が、この席の出力を
    そのまま意思決定に使えている。

operating_principles:
  - 信頼は状態ではなく履歴。一度の説明ではなく、期待と結果の一致の積み重ねで作られる。
  - 全員に理解させようとしない。理解する人と、放置して安心できる人の両方に道を用意する。
  - 不利な結果そのものより、不透明さが信頼を壊す。
  - 測れない信頼は設計できない。指標にできない主張は、まだ仮説ですらない。
  - 理解を迂回して行動を変える手法は、短期には効き、関係を壊す。
```

**must**: 心理学・行動経済学・認知科学・HCI いずれかの学術的訓練（学位でなくてもよいが、枠組みを使いこなせること）／ 定性・定量の混合手法／ 発見を製品とコミュニケーションの意思決定に翻訳した実績／ 信頼・受容・行動変容のいずれかを実測した経験。
**strong plus**: エネルギー・ユーティリティ領域（Opower 系譜）、自動化への信頼 / 説明可能性、越境・多文化のユーザ調査、大規模なライフサイクル・コミュニケーション（メール / 通知）の設計と検証。
**anti-signal**: 成果物が常にペルソナとカスタマージャーニーで終わる／ 定性のみで指標を持たない／ 「ナッジで解決できます」と即答する／ UI コンポーネントの話に引き戻す。

---

## §4. Lane boundaries — 既存エージェントとの重複チェック

新席が既存の誰かの lane を踏むと、レビューで必ず止まる。先に潰しておく。

| 既存 | 何を持っている | 新席との境界 |
|---|---|---|
| `dmitri` — Growth & Reader Analyst (→ `ingrid`) | `kohuehara.xyz` の読者行動・成長分析 | **重複しない。** dmitri は自社ニュースレター、新 DS 席は外部3プロジェクト。JD に明記する。 |
| `tomas` — Organizational Performance Scientist (→ `mateo`) | ワークフォース自身の性能計測 | **重複しない。** 対象が内向き（組織）か外向き（プロダクト）か。 |
| `owen` — SDET / Verification Engineer (→ `dario`) | コードの検証 | **近接。** owen はコードの正しさ、AE 席は**データ**の正しさ（freshness / contracts / data tests）。co-flag の対象。 |
| `sneha` — Residential Consumer & Field-Evidence Analyst (→ `anjali`) | インド住宅消費者の現場証拠 | **最も近い。** sneha は *市場としてのインド世帯*（事業提案の証拠）、UX 席は *project-ind の実利用者の体験と信頼*。境界を JD に書き、相互 lateral を張る。 |
| `rohan` — DISCOM / Subsidy & Program-Economics (→ `anjali`) | 政府側の補助金・プログラム経済 | **近接。** rohan は制度側の経済、DS 席はプロダクト介入の因果効果。 |
| `amara` / `grace` / `ishaan` — Grid / Policy | 動的料金の制度・系統側 | UX 席は制度ではなく**受け手の理解と信頼**。DS 席は制度前提を所与として扱う。 |
| `celeste` — VP Marketing / `nico` | 外部コミュニケーション | UX 席の project-ind 側成果物の**共同の受け手**。lateral 必須。 |

## §5. レポートライン案

| 席 | reports_to | lateral |
|---|---|---|
| Product Data Scientist | `nadia`（Product） | `dario`, AE 席, UX 席, `rohan` |
| Analytics Platform Engineer | `dario`（Engineering） | DS 席, `nadia`, `owen` |
| Behavioral Design & Trust Researcher | `nadia`（Product） | `celeste`（Marketing）, `sneha`, DS 席 |

**根拠**: (a) 3プロジェクトとも `owner_agent: nadia`。(b) オペレータ自身が UX 席について「密に連携するのは Product メンバと Marketing メンバ」と述べており、`nadia` + `celeste` の組み合わせと一致。(c) DS を Product 側、DE を Engineering 側に置くのは市場の標準配置であり、二席の緊張（DS は自由度を、AE は作り置きを欲しがる）を組織的に健全に保つ。

**却下した代案**: 3席まとめて新しい「Delivery Pod」を作り新 VP を置く案 → C-3（single-operator scale）に照らして管理レイヤの追加は割に合わない。既存 VP の下に IC を置く形（`bruno` の前例）を踏襲する。

---

## §6. 決めてほしいこと（open questions）

1. **3席は「3プロジェクト横断の機能席」か、「asp-cloud 専任」か。** 横断なら JD は共通コア重視で書く（本メモの現状）。asp-cloud 専任なら、DS 席の must を「疎な IoT からの物理推定」に上げ、NILM を strong plus からもう一段上げられる。**これが JD の骨格を最も左右する。**
2. **DE 席のタイトル。** `Data Engineer` か `Analytics Platform Engineer` か。**後者を推奨**（§1-2 の理由：欲しいのは ingest 職人ではなく意思決定レイテンシの設計者）。
3. **UX 席のタイトル。** `Behavioral Design & Trust Researcher` を推奨。`UX Designer` にすると母集団が UI 側に、`UX Researcher` にすると汎用リサーチャに寄る。
4. **この3席の成果物の「出力形」は何か。** 既存の外部プロジェクト席は pr-autopilot / pr-review 経路に乗っている。DS / AE 席の主成果物は「分析ノート」「設計提案」で、これは既存の cadence の型に完全には収まらない。**新しい cadence を切るのか、既存の PR レビュー・レンズとして入れるのか**は、ラウンド本体の前に決めたい（`cadence-forge` の適用可否）。
5. **W-3。** 現行 cap は USD 500/mo（governance.md §2）。3席 × USD 6–7 ≒ **+18〜21/mo**。現行 cap の消費状況次第では cap 据え置きで通る可能性が高いが、ラウンド本体で実測を確認する（cap 変更は Zone A）。
6. **DS 席を1席に統合するか、2席に割るか。** §0 の表の通り、asp-cloud（物理推定・アルゴリズム調整）と smartmeter/IND（大規模探索分析）は市場では別トラック（Airbnb でいう Algorithms と Analytics）。1席で採るなら **共通コア＝実験設計** で採り、物理推定は strong plus にする、という割り切りが要る。**推奨は1席**（C-3 スケール）だが、割り切りの明示的な合意が欲しい。

---

## §7. 選考で見るシグナル（ラウンド本体で使う素案）

各席、**ワークサンプル1題 + アンチシグナル**の形で。

**DS**: 匿名化した数世帯 × 2週間の分単位電力データ + 気象を渡して、(1) 給湯器の稼働パターンを推定せよ、(2) 制御アルゴリズムの改善を検証する実験を設計せよ — 何を定数として固定するか、(3) いま取得していないが追加すべきデータポイントを3つ、期待効果順に。
→ 見るのは **物理的常識・交絡への感度・「測れないもの」への態度・コストと効果のトレードオフ**。

**AE**: 数万世帯 × 3年 × 30分粒度に対する分析基盤を口頭で設計（30分）。ストレージ形式、パーティション、中間集計の粒度の決め方、そして「アナリストが新しい切り口を思いついた時のリードタイム」。
→ アンチシグナル：**いきなりツール選定から入る／全部リアルタイム化を推す／誰が何を判断するのかを聞かない**。

**UX**: asp-cloud の実証開始前、住人は動的料金を理解していない。一通目のメールと最初の画面で「何を言い、何を言わないか」。そして **信頼が壊れる瞬間を3つ挙げ、それをどう検知・計測するか**。
→ アンチシグナル：**ペルソナ作成で止まる／定性のみで指標を持たない／ナッジ即答**。

---

## §8. Sources（as-of 2026-08-06）

- Airbnb の DS 三分割（Analytics / Inference / Algorithms）— [Prepfully: Airbnb Data Scientist Interview Guide](https://prepfully.com/interview-guides/the-ultimate-airbnb-data-scientist-interview-guide)
- Netflix の experimentation / causal inference フォーカス — [Netflix TechBlog: Experimentation is a major focus of Data Science across Netflix](https://netflixtechblog.com/experimentation-is-a-major-focus-of-data-science-across-netflix-f67923f8e985)
- ホームエネルギー DS の実像（蓄電池最適化アルゴリズムの設計・改良）— [Built In: Data Scientist (Bliq)](https://builtin.com/job/data-scientist/6215829)
- Bidgely の disaggregation と DS 体制 — [Bidgely: Disaggregation](https://www.bidgely.com/technology/disaggregation/)
- Uplight の成り立ちと Sense — [Canary Media: Sense raises $105M](https://www.canarymedia.com/articles/grid-edge/sense-raises-105m-to-bring-real-time-home-energy-data-to-the-masses)
- NILM / 低頻度スマメデータからの負荷分解 — [ScienceDirect: NILM with very low-frequency data from smart meters in Switzerland](https://www.sciencedirect.com/science/article/pii/S0378778825007327), [arXiv: NILM using Deep Neural Networks — A Review](https://arxiv.org/pdf/2306.05017)
- Data engineer と analytics engineer の職能分割・semantic layer — [dbt Labs: The analytics engineer in 2026](https://www.getdbt.com/blog/the-analytics-engineer-in-2026-system-designer-governance-owner-ai-context-provider)
- AMI / スマートグリッドのデータエンジニア職の実際 — [Glassdoor: Data Engineer, Smart Meter LLC](https://www.glassdoor.com/job-listing/data-engineer-mid-senior-level-smart-meter-llc-JV_IC1154429_KO0,30_KE31,46.htm?jl=1010108060913), [Indeed: Smart Grid Data Engineer jobs](https://www.indeed.com/q-smart-grid-data-engineer-jobs.html)
- Opower / 行動エネルギー効率と normative comparison（Cialdini の social norms）— [Oracle: Opower Reimagines the Home Energy Report](https://www.oracle.com/corporate/pressrelease/oracle-opower-home-energy-report-062220.html), [Rare Behavior Center: Opower — Leveraging Social Norms](https://behavior.rare.org/wp-content/uploads/2020/07/Social-Influences.-Opower.7.8.pdf), [ScienceDirect: The Promise of Behavioral Energy Efficiency in Times of Trouble](https://www.sciencedirect.com/science/article/abs/pii/S1040619020301615)
- Behavioral Scientist と UX Researcher の職能差 — [Connor Joyce: Similar but different — Data Science, User Experience, and Behavioral Science](https://medium.com/behavior-design-hub/similar-but-different-9d5b88c5f2f4), [Michelle Handy, PhD: A Practical Guide to Breaking into UX & Behavioral Science](https://medium.com/@michellehandy94/a-practical-guide-to-breaking-into-ux-behavioral-science-with-resources-4c602fc54b02)
- 動的料金における手続き的公正・透明性と信頼 — [ScienceDirect: Ethics, Transparency, and Consumer Trust in AI-Enabled Pricing](https://www.sciencedirect.com/science/article/pii/S2773032826000040)
- 自動化への行動的信頼（信頼性と透明性の効果）— [PMC: Reliable and transparent in-vehicle agents lead to higher behavioral trust](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10232983/)
- UX リサーチ職の学術的背景（心理学 / HCI / 認知科学）— [Research.com: How to Become a UX Researcher (2026)](https://research.com/advice/how-to-become-a-ux-researcher-education-salary-and-job-outlook)

---

## §9. Bias disclosure

このメモは Claude Code セッションが作成した**ブレスト用の下書き**であり、hire round の決定ではない。市場調査は公開 Web 検索に基づき、LinkedIn の求人本文の多くはゲスト閲覧では本文が取得できないため、**求人ページ本文そのものではなく、二次情報・企業公式・学術文献・業界解説を根拠にしている**箇所がある（§8 のリンクが実際に参照したもの）。企業のプール推定（Bidgely / Uplight / 評価コンサル各社など）は「そこに該当職能が存在する」という主張であって、採用可能性の主張ではない。
