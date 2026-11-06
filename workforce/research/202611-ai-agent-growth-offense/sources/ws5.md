# WS5 ファクトパック — 場の形成・容量・先行投資 (H-6.1〜H-7.3)

- 座席: **silas** (財務アドバイザー: 実コスト・容量・予算) + **nico** (組織を製品として売るプロダクトマーケター: 「場」を製品として見る)
- 取得日: 2026-11-05。検索 12 回 (予算上限) + 一次文書の直接取得。gartner.com 等は規律どおり取得を試みていない。
- 第 1 報 (守り) の行は S-0.<ws>.<k> で内部証拠として引く (S-0.8.9 Stage-Gate、S-0.3.14 State of FinOps 2026、S-0.3.15 Gartner GenAI 支出予測、S-0.3.17 FinOps for AI、S-0.2.15 Epoch 価格推移、S-0.2.16 a16z LLMflation)。再調査はしていない。

## 1. 所見 (findings)

### I-6 場の形成 — 社内市場・ベンチャースタジオ・容量

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-5.1 | H-6.1 | Unilever の社内人材マーケットプレイス **FLEX Experiences** (Gloat 製)。ベンダ事例 PDF の Results 欄: 「**500k unlocked hours**」「**41% improvement in overall productivity**」「70% cross-functional assignments」「62% of opportunities are assigned to female employees」。対象 = Unilever 従業員 (同 PDF で 149,000 人)、期間 = 2019 年のパイロット (約 1,000 人) から PDF 作成時 (2021-08) まで累計。**何ではないか**: 第三者監査なし。「41% の生産性向上」の定義 (何の生産性か) は PDF に記載なし。 | S-5.1 | A (ページで確認。ただしベンダ自己申告) |
| F-5.2 | H-6.1 | 同 PDF で CEO Alan Jope 発言として引用: 「Our Internal Talent Marketplace has helped us to re-prioritize **500,000 worker hours** towards more than **3,000 business-critical projects**.」= 1 案件あたり平均 約 167 時間 (silas の割り算。案件規模分布は不明)。パンデミック初 2 か月で「700 超の案件を充足、26,000 時間超を unlock、60% 超が国境を越えた配置」。 | S-5.1 | A (ベンダ PDF 内の CEO 引用。Unilever 側の一次発言は未確認) |
| F-5.3 | H-6.1 | Gloat のブログ (2024-03-22 最終更新) では別の数字: 「90,000+ employees」「90+ countries」への展開、「直近 2 か月で 300,000+ hours」。検索要約では別資料に「~700,000 unlocked hours」もあり、**ベンダ資料間で累計時間が 500k / 700k と食い違い、期間の定義が揃っていない**。 | S-5.2 | A (90,000+/300,000+ はページで確認)、700k は C |
| F-5.4 | H-6.1 | Schneider Electric **Open Talent Market** (Gloat 製、2020-04 グローバル展開)。ベンダ事例 PDF: 「**200,000+ unlocked hours**」「**$15,000,000** savings in enhanced productivity and reduced recruitment costs」「60% adoption rate less than two months after launch」「81% of employees would recommend Gloat」「2,300 超の従業員が新しい役割を探索」「初期数週間で約 127,000 時間の hidden capacity」「7,500 人超がメンター獲得」「案件・ギグの 55% が女性応募者」。従業員 135,000 人超。**何ではないか**: USD 15M は生産性と採用費削減の合算で内訳なし。別の Gloat 資料 (検索要約) は 360,000 時間とし、数字が版で異なる。 | S-5.3 | A (PDF 本文で確認、ベンダ自己申告)。360k は C |
| F-5.5 | H-6.1 | 社内市場の「価格」レイヤ: FinOps for AI は「Show teams their AI costs … before charging them back」を推奨し、共有モデルの chargeback を扱うが、multi-agent の配賦方法は未定義 (第 1 報 S-0.3.17)。State of FinOps 2026 で 98% が AI 支出を管理対象と回答 (S-0.3.14)。→ 社内労働市場の「価格」は showback 段階が実務の上限で、**エージェント労働の社内取引価格 (内部振替価格) を設けた企業の一次事例は NOT FOUND**。 | S-0.3.17, S-0.3.14 | B (第 1 報で A 確認済みの内部証拠。「事例なし」は本 WS の探索範囲内での不在) |
| F-5.6 | H-6.1 | 二面市場の理論的裏付け (引用水準): Rochet & Tirole「Platform Competition in Two-Sided Markets」*Journal of the European Economic Association* 1(4), 2003 (OUP 掲載ページで題名・誌名を確認、巻号は URL から)。Parker/Van Alstyne/Choudary『Platform Revolution』(2016) は取得していない。 | S-5.4 | B (書誌のみ。本文の主張は検証していない) |
| F-5.7 | H-6.2 | CB Insights *State of CVC 2024* (2025-02-04): 「Global CVC-backed funding rebounded **20% YoY to $65.9B** in 2024」「deal count fell to **3,434**, the lowest level since **2018**」、平均ディール規模 **USD 27.3M** (+34% YoY)。範囲 = 世界の CVC 参加ディール、暦年 2024。→ 人間の「企業内の賭け」は **少数・大型化** の方向に動いている (回転数は落ちている)。 | S-5.5 | A |
| F-5.8 | H-6.2, H-7.3 | 社内イノベーションの kill 率の古典値: Cooper (1980) Project NewProd の抄録「of every **58** product ideas that enter the process just **two** reach commercialisation stage … and only **one** is a success」「of 100 products developed **21.9%** are killed prior to launch, **18.7%** are commercial failures and **59.4%** are successful」。範囲 = 1970 年代カナダの工業製品企業 (抄録から、詳細は有料本文)。よく引かれる「9 案に 1 つ」(PDMA) は二次でのみ確認、出典不確定。 | S-5.6 | A (抄録で確認。本文は未読) |
| F-5.9 | H-6.2 | Stage-Gate のゲート判定語彙 Go/Kill/Hold/Recycle と「次のゲートの日付」は第 1 報で確認済み、判定周期の規定はない (S-0.8.9)。→ 試行単価がトークンに下がったとき**ゲート周期を短くせよという一次の指針は NOT FOUND** (仮説の「回転数が変わる」は推論のまま)。 | S-0.8.9 | B (内部) |
| F-5.10 | H-6.3 | 予約容量の人間側の先例 (クラウド): AWS Compute Savings Plans 最大 **66%**、EC2 Instance Savings Plans 最大 **72%** (対 On-Demand、**1 年または 3 年**のコミット)。Azure Reserved VM Instances 最大 **72%** (対従量課金、3 年、M64ls SUSE Linux / East US / 2026-01 価格の例、範囲 36〜72%)。**何ではないか**: 「最大」は特定インスタンスの最良条件。平均割引ではない。 | S-5.7, S-5.8 | A |
| F-5.11 | H-6.3 | LLM 側の予約容量: Anthropic の Service tiers ページは「**Service tiers are legacy**」「**Priority Tier capacity commitments are no longer available for purchase**」と明記 (取得 2026-11-05)。既存契約の構成 = 入力 TPM・出力 TPM・期間 (**1, 3, 6, or 12 months**)・特定モデル版、目標稼働率 **99.5%**、超過分は Standard に自動フォールバック。Opus 5 系・Sonnet 5 系など最新モデルは Priority Tier 非対応。→ **LLM の「容量予約」市場はクラウドの RI/SP のように安定した商品になっておらず、ベンダが 1 年以内に形を変える**。新規の保証容量は「contact sales」の個別交渉。 | S-5.9 | A |
| F-5.12 | H-6.3 | OpenAI: priority processing はリクエスト単位で `service_tier: priority` を指定し標準単価に上乗せ (倍率はモデル別)。ヘルプセンターの検索抜粋では 2026-07-30 に「Fast mode」へ改称。Scale Tier (TPM 単位のコミット) のページは 403 で **割引率・期間は NOT FOUND**。 | S-5.10 | B (検索抜粋経由。価格倍率は未確認) |
| F-5.13 | H-6.3 | Microsoft Copilot Studio の容量パック (Microsoft Learn、2026-11-03 更新): 「Each Prepaid Capacity pack is a tenant license that includes **25,000 Copilot Credits per month**」、毎月の請求期間開始時に補充、超過は従量課金に自動切替 (無しなら「Copilot Chat is unavailable … until credits replenish」)、クレジット政策はテナントあたり最大 10。価格 **USD 200/月/パック** と「未使用分は繰り越さない」は二次資料のみ (従量 約 USD 0.01/クレジット → パックは満額消化時に約 20% 安)。2025-09-01 に単位が messages → Copilot Credits に変更 (二次)。 | S-5.11, S-5.12 | A (25,000/月・補充・超過挙動)、価格と繰越なしは C |
| F-5.14 | H-6.3 | Jevons の原典: W. S. Jevons『The Coal Question』(初版 1865、Econlib 掲載は第 2 版 1866) 第 VII 章「Of the Economy of Fuel」: 「It is wholly a confusion of ideas to suppose that the economical use of fuel is equivalent to a diminished consumption.」 | S-5.13 | A |
| F-5.15 | H-6.3 | Satya Nadella の投稿 (2025-01-27、DeepSeek R1 騒動時): 「Jevons paradox strikes again! As AI gets more efficient and accessible, we will see its use skyrocket, turning it into a commodity we just can't get enough of.」Fortune は **LinkedIn** 投稿として報じ、他紙は X とする。X 本体は 402 で取得不可。 | S-5.14 | B (Fortune 経由の逐語。原投稿未確認、媒体 X/LinkedIn の別も未確定) |
| F-5.16 | H-6.3 | 単価低下と総支出増の併存: Gartner は 2025 年の GenAI 支出を USD 643.86B (+76.4%) と予測 (第 1 報 S-0.3.15、予測であって実測ではない)。Epoch は同性能の価格が年 9〜900 倍低下 (S-0.2.15)。→ 単価は桁で下がり、支出は増える方向 — Jevons と整合するが**因果の実測ではない** (同時期の 2 系列の並置)。 | S-0.3.15, S-0.2.15 | B (内部) |
| F-5.17 | H-6.3, H-7.1 | CFO 調査 (ベンダ): Datarails「2026 CFO Sentiments Survey」n=270 (米国、従業員 1,000 人超) で **84%** が AI 予算を自部門で保有、**32%** が過去 1 年に AI 予算を 10% 以上超過。調査期間の記載なし。 | S-5.15 | C (FP&A ソフトベンダのブログ、利害あり) |

### I-7 先に取りに行く投資

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-5.18 | H-7.1 | 価格低下率: a16z LLMflation「年 10 倍」(MMLU 42 相当で $60→$0.06 / 3 年) (S-0.2.16)、Epoch「年 9〜900 倍、直近が最速、持続は不明」(S-0.2.15)。METR の horizon 倍増は WS1 が扱う (本 WS では引用のみ、再検証なし)。 | S-0.2.16, S-0.2.15 | B (内部、第 1 報で確認済み) |
| F-5.19 | H-7.1 | 「来年の値下がりを予算に織り込め」という明示的ガイダンスは、**独立した CFO/CIO 団体・会計基準・調査機関からは NOT FOUND**。唯一見つかったのは GPU ベンダ: NVIDIA perspectives (2026-04-13、著者名なし・AI 生成の注記あり)「should model inference cost not as a flat line from purchase date but as a declining curve」、B200 上の GPT-OSS-120B で 2 か月でソフト最適化のみで 5 倍低下と主張。 | S-5.16 | C (ベンダ、AI 生成コンテンツの注記あり、利害あり) |
| F-5.20 | H-7.1 | 逆向きの証拠 (二次): CNBC 報道を転載した検索結果で、Glean CEO が「新モデルごとにトークン単価がほぼ倍」で年間 AI 予算が 1〜2 か月で尽きると発言。転載先の多くはスパム的ミラーで原記事は未取得。→ **フロンティア層の単価は下がらない (むしろ上がる) という反対仮説が存在**。 | (台帳外 — 原記事未取得のため非引用) | NOT FOUND (原典未確認、引用不可) |
| F-5.21 | H-7.2 | Anthropic「Demystifying evals for AI agents」(2026-01-09): 新モデル登場時に「teams without evals face weeks of testing while competitors with evals can quickly determine the model's strengths」「Once evals exist, you get baselines and regression tests for free」「costs are visible upfront while benefits accumulate later」。→ eval は**モデル更新をまたいで残り、乗り換え速度を買う資産**というベンダ一次の記述。 | S-5.17 | A |
| F-5.22 | H-7.2 | 同記事の飽和の定義: 「Eval saturation occurs when an agent passes all of the solvable tasks」「An eval at 100% tracks regressions but provides no signal for improvement」「large capability improvements appear as small increases in scores」。→ 公開ベンチは飽和で信号を失う。自社タスクの eval を持ち続け更新する必要の根拠。METR/Epoch による飽和の実測は本 WS では未取得 (**NOT FOUND**、WS1 参照)。 | S-5.17 | A |
| F-5.23 | H-7.2 | Hamel Husain 等の「evals are the moat」論考、OpenAI evals ガイドは予算内で未取得 (**NOT FOUND**)。 | — | — |
| F-5.24 | H-7.3 | VC のべき乗則: Chris Dixon「Performance Data and the 'Babe Ruth' Effect in Venture Capital」(a16z、2015-06-08) — Horsley Bridge の数百ファンド・1985 年以降のデータで「about ~**6%** of investments representing **4.5%** of dollars invested generated ~**60%** of the total returns」。二次で広く引かれる「約 7,000 件、1985–2014」「優れた VC ほど損失案件が多い」はページ本文で数値確認できず (チャートのみ)。※ brief の「2016」は誤りで正しくは 2015。 | S-5.18 | A (6%/4.5%/60%)、件数と損失率は C |
| F-5.25 | H-7.3 | 内部一次証拠: 本ワークフォースは W-3 で月額 USD 600 の上限を持ち、ペルソナ・binding の追加ごとに W-3 台帳に計上する規律 (CLAUDE.md、workforce governance §2)。→ 「容量予算の上限 + 個別の賭けの台帳化」は小規模ながら既に運用されている形。 | S-5.19 | 内部 |

## 2. 仮説ごとの暫定判定

| 仮説 | 暫定判定 | 確度 | F-IDs | 競合する説明・留保 |
|---|---|---|---|---|
| **H-6.1** 社内労働力市場を作るのは IT 部門の仕事になりうる | **一部支持** | 中 | F-5.1〜5.6 | 人間の社内マーケットプレイスは**実在し規模も大きい** (Unilever 500k 時間/3,000 案件、Schneider 200k+ 時間/USD 15M)。ただし所有者は **HR** であって IT ではなく、数字は全てベンダ自己申告で食い違いあり。「価格」レイヤは showback 止まりで、エージェント労働の内部振替価格の事例は NOT FOUND。IT が担うのは市場の基盤 (カタログ・計量・容量) で、需給の設計は HR/経営企画と分担する、という形が妥当かもしれない (推測)。 |
| **H-6.2** ベンチャースタジオ型、試行単価が下がると回転数が変わる | **未検証** (前半は一部支持) | 低 | F-5.7〜5.9 | 人間の CVC は 2024 年に**件数減・大型化** (3,434 件、2018 年来最少、平均 USD 27.3M) — 「多数の小さな賭け」とは逆向き。Cooper の 58→2→1 は「多く試して少数が残る」構造を示す。だが「トークン単価で回転数が上がる」実測は NOT FOUND。人間の賭けが少数大型化するのは試行単価が高いから、という説明と、単に金利環境・選別強化 (CB Insights の解釈) という説明が競合する。 |
| **H-6.3** 容量計画が IT 部門の新しい人員計画になる | **一部支持** | 中 | F-5.10〜5.17 | 商品としての容量は存在する (Copilot 25,000 クレジット/月/パック、OpenAI priority、Anthropic Priority Tier 既存契約)。だが**Anthropic は Priority Tier の新規販売を停止し最新モデルは対象外** — クラウド RI/SP (最大 66〜72%、1〜3 年) のような安定した予約市場ではない。「人員計画」の類比は、期間が 1〜12 か月と短く、モデル版に紐づき、商品自体が改廃される点で異質。Jevons は原典・Nadella 発言とも確認、支出増との並置は因果ではない。 |
| **H-7.1** 価格低下が確実な範囲で「今は赤字でも来年黒字」を先に買うのは合理 | **一部支持** | 低 | F-5.18〜5.20 | 年 10 倍級の低下は固定性能について複数ソースで支持。しかし**低下を予算に織り込む独立のガイダンスは NOT FOUND**、唯一の推奨は GPU ベンダ (C)。フロンティア層では単価据え置き/上昇の反対証言 (原典未確認)。「現行モデル 50% → 次世代 90%」を積むパイプライン実務の一次事例も NOT FOUND。合理性は「固定性能の仕事」に限られ、最先端を常に使う仕事には当てはまらない可能性。 |
| **H-7.2** 先行投資に値するのはモデルが変わっても残るもの (eval 等) | **支持** (eval について) | 中 | F-5.21〜5.23 | Anthropic 一次が「eval があれば新モデルの評価が速い」「価値は複利で蓄積」と明記。ただしモデルベンダは eval 普及で自社モデルの採用が速まる利害がある。データ・API・承認設計については本 WS では新規証拠なし (第 1 報参照)。 |
| **H-7.3** 賭けの規律 = ポートフォリオ + kill 条件 + 四半期判定 | **一部支持** | 中 | F-5.8, 5.9, 5.24, 5.25 | 両先例 (VC のべき乗則: 6% の案件が 60% のリターン、Stage-Gate の Go/Kill) は確認。「四半期」という周期は一次では規定なし。VC のべき乗則は**市場の外部株式の話**で、社内プロジェクトの分布が同じべき乗になる証拠はない (Cooper の分布は二値で異なる)。 |

## 3. 矛盾・注意点

- **ベンダの利害**: 社内マーケットプレイスの数字 (F-5.1〜5.4) は全て Gloat の販促資料。同じ顧客で版ごとに累計時間が違う (Unilever 500k/700k、Schneider 200k/360k)。「41% の生産性向上」は定義不明。報告では「ベンダ申告」と必ず併記。価格ページ (AWS/Azure の「最大 72%」) は最良条件の例で平均ではない。
- **生存者バイアス**: Unilever・Schneider は成功事例として選ばれた顧客。導入して失敗した社内マーケットプレイスの公開事例は探していない (予算外)。
- **予測 vs 実測**: Gartner の USD 644B は予測 (第 1 報でも 403、抜粋経由)。Jevons の「単価↓・支出↑」は 2 系列の並置で、弾力性の推定ではない。
- **単位の罠**: Copilot は 2025-09 に messages → Copilot Credits へ単位変更 (二次)。Anthropic Priority Tier は cache read 0.1、1h cache write 2.0、US-only 1.1 で消費換算 — 「TPM」は名目トークンではない。クラウド RI の「%割引」と LLM 容量の「優先度/稼働率保証」は買っているもの自体が違う (前者は単価、後者は可用性)。
- **商品の改廃速度**: Anthropic Priority Tier の新規販売停止、OpenAI priority の改称 (2026-07-30、抜粋) — 容量契約の形が 1 年以内に変わる。予約を「人員計画」と見るなら、契約期間を短く、モデル版に縛られる前提で設計する必要がある。
- **日付の訂正**: a16z の Babe Ruth 記事は 2015-06-08 (Chris Dixon)、brief の「2016」は誤り。Nadella 投稿の媒体は Fortune によれば LinkedIn。
- **NOT FOUND 一覧**: エージェント労働の社内振替価格の一次事例 / トークン化でゲート周期を短縮した一次事例 / OpenAI Scale Tier の割引率・期間 / 独立した CFO・CIO の「来年の値下がりを予算化」ガイダンス / 「現行 50%→次世代 90%」パイプラインの一次事例 / Hamel Husain・OpenAI evals ガイド / METR・Epoch の飽和実測 (WS1) / Horsley Bridge の件数・損失率の一次 / Gloat 以外の Unilever 一次発表 / Platform Revolution 本文 / Glean CEO 発言の CNBC 原記事 / Nadella 原投稿。

## 4. 情報源台帳

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-5.1 | 準一次 (ベンダ事例) | How Unilever Uses AI to Retain, Engage and Develop Employees (Case Study: Unilever) | Gloat | PDF 作成 2021-08-15 (更新 2023-07-04) | https://gloat.com/wp-content/uploads/How-Unilever-Uses-AI-to-Retain-Engage-and-Develop-Employees.pdf | PDF をテキスト化して Results 欄 (500k / 41% / 70% / 62%)、Jope 引用 (500,000 時間・3,000 案件)、26,000 時間・700 案件を確認。取得 2026-11-05 |
| S-5.2 | 準一次 (ベンダブログ) | Unilever, the consumer goods giant, implements AI to retain, develop, and engage talent | Gloat | 2024-03-22 (最終更新) | https://gloat.com/case-studies/unilever/ | 90,000+ 従業員、90+ か国、直近 2 か月 300,000+ 時間、Jeroen Wels 引用を確認。700k は別資料 (検索要約) で未確認 |
| S-5.3 | 準一次 (ベンダ事例) | Schneider Electric Gloat Case Study | Gloat | PDF 作成 2021-09-03 | https://gloat.com/wp-content/uploads/Schneider-Electric-Gloat-Case-Study.pdf | PDF テキスト化で 200,000+ 時間、USD 15M、60%、81%、2,300、127,000、7,500、55%、135,000 人を確認。360k は別資料 (未確認) |
| S-5.4 | 一次 (学術、書誌のみ) | Platform Competition in Two-Sided Markets (Rochet & Tirole) | Journal of the European Economic Association (OUP) | 2003 | https://academic.oup.com/jeea/article/1/4/990/2280902 | 題名・誌名をページで確認。巻号は URL、著者・年は既知の書誌。抄録は未取得 |
| S-5.5 | 一次 (調査会社) | State of CVC 2024 / Corporate venture capital trends 2024 | CB Insights | 2025-02-04 | https://www.cbinsights.com/research/report/corporate-venture-capital-trends-2024 | USD 65.9B (+20%)、3,434 件 (2018 年来最少)、平均 USD 27.3M (+34%) をページで確認 |
| S-5.6 | 一次 (学術、抄録) | Project NewProd: Factors in New Product Success (R. G. Cooper) | European Journal of Marketing 14(5/6): 277–292, Emerald | 1980-05-01 | https://www.emerald.com/insight/content/doi/10.1108/EUM0000000004906/full/html | 抄録で 58→2→1、21.9/18.7/59.4%、失敗率 30–60% を確認。本文は有料で未読 |
| S-5.7 | 一次 (価格ページ) | Compute Savings Plans pricing | Amazon Web Services | 取得 2026-11-05 | https://aws.amazon.com/savingsplans/compute-pricing/ | 「up to 66%」(Compute SP)、「up to 72%」(EC2 Instance SP)、1 年/3 年を確認 |
| S-5.8 | 一次 (価格ページ) | Azure Reserved Virtual Machine Instances | Microsoft Azure | 取得 2026-11-05 (2026-01 価格例) | https://azure.microsoft.com/en-us/pricing/reserved-vm-instances/ | 「up to 72%」、脚注の例 (M64ls SUSE、East US、3 年) と 36–72% の範囲を確認 |
| S-5.9 | 一次 (ドキュメント) | Service tiers | Anthropic (Claude Platform docs) | 取得 2026-11-05 | https://platform.claude.com/docs/en/api/service-tiers | 「Service tiers are legacy」「no longer available for purchase」、1/3/6/12 か月、99.5%、消費換算、非対応モデル一覧を確認 |
| S-5.10 | 一次 (直接未確認) | Priority processing (guide) / Priority processing FAQ | OpenAI | 取得 2026-11-05 | https://developers.openai.com/api/docs/guides/priority-processing | ガイドは 404、ヘルプ記事 (help.openai.com/en/articles/11647665) と Scale Tier ページ (openai.com/api/scale-tier/、403) は未取得。service_tier 指定・上乗せ課金・Fast mode 改称は検索抜粋のみ |
| S-5.11 | 一次 (ドキュメント) | Use Capacity Packs vs Pay-as-you-go Billing for Microsoft Copilot Chat | Microsoft Learn | 2026-11-03 (更新) | https://learn.microsoft.com/en-us/microsoft-365/copilot/pay-as-you-go/copilot-capacity-packs | 25,000 Copilot Credits/月/パック、月初補充、超過時の挙動、政策上限 10 を確認。価格の記載なし |
| S-5.12 | 二次 | Copilot Studio Pay-As-You-Go | Licensing School | 2024-12-16 | https://www.licensingschool.co.uk/licensing-blog/2024/12/16/copilot-studio-pay-as-you-go/ | 検索要約経由で USD 200/パック・従量約 USD 0.01・繰越なしの記述 (未取得)。ライセンス専門の解説で C |
| S-5.13 | 一次 (原典) | The Coal Question (W. S. Jevons), Ch. VII "Of the Economy of Fuel" | Macmillan (Econlib 掲載、第 2 版 1866、初版 1865) | 1865/1866 | https://www.econlib.org/library/YPDBooks/Jevons/jvnCQ7.html | 第 VII 章で該当文を逐語確認 |
| S-5.14 | 二次 (報道) | Satya Nadella believes Chinese AI startup DeepSeek could be a win for tech… | Fortune | 2025-01-27 | https://fortune.com/2025/01/27/microsoft-ceo-satya-nadella-deepseek-optimism-jevons-paradox/ | 投稿全文の逐語を記事で確認 (LinkedIn と記載)。x.com/satyanadella/status/1883753899255046301 は 402 |
| S-5.15 | 二次 (ベンダ調査) | AI token costs (2026 CFO Sentiments Survey 引用) | Datarails | 2026 (日付記載なし) | https://www.datarails.com/blog/ai-token-costs/ | n=270、84%、32% をページで確認。調査期間不明、FP&A ベンダで利害あり |
| S-5.16 | 二次 (ベンダ、AI 生成注記) | CFO budget framework: AI inference cost forecasting | NVIDIA (perspectives) | 2026-04-13 | https://perspectives.nvidia.com/cfo-budget-framework-ai-inference-cost-forecasting/ | 「declining curve」の一文、B200 で 5 倍低下の主張を確認。著者名なし・AI 生成の注記 |
| S-5.17 | 一次 (ベンダ技術記事) | Demystifying evals for AI agents | Anthropic (Engineering) | 2026-01-09 | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | 新モデル評価の速度、baselines/regression、複利、飽和の定義 4 文を確認 |
| S-5.18 | 二次 (VC の一次分析、LP データ) | Performance Data and the "Babe Ruth" Effect in Venture Capital (Chris Dixon) | Andreessen Horowitz | 2015-06-08 | https://a16z.com/performance-data-and-the-babe-ruth-effect-in-venture-capital/ | 「~6% … 4.5% of dollars … ~60% of the total returns」、1985 年以降・数百ファンドを確認。件数・損失率の数値は本文になし |
| S-5.19 | 内部 | CLAUDE.md / workforce/docs/governance.md §2 (W-3 cost ceiling USD 600/month) | ai-native-article repo | 2026-09-05 (survey) | (repo) /home/user/ai-native-article/CLAUDE.md | W-3 上限と binding ごとの予算行の規律を確認 |
| S-0.2.15 | 内部 (第 1 報) | LLM inference prices have fallen rapidly but unequally across tasks | Epoch AI | 2025-03-12 | https://epoch.ai/data-insights/llm-inference-price-trends | 第 1 報 S-2.15 (A 相当で確認済み) |
| S-0.2.16 | 内部 (第 1 報) | Welcome to LLMflation | a16z | 2024-11-12 | https://a16z.com/llmflation-llm-inference-cost/ | 第 1 報 S-2.16 |
| S-0.3.14 | 内部 (第 1 報) | State of FinOps 2026 | FinOps Foundation | 2026 | https://data.finops.org/ | 第 1 報 S-3.14 (98%) |
| S-0.3.15 | 内部 (第 1 報) | Gartner Forecasts Worldwide GenAI Spending to Reach $644 Billion in 2025 | Gartner | 2025-03-31 | https://www.gartner.com/en/newsroom/press-releases/2025-03-31-gartner-forecasts-worldwide-genai-spending-to-reach-644-billion-in-2025 | 第 1 報 S-3.15 (直接未確認、抜粋経由) |
| S-0.3.17 | 内部 (第 1 報) | FinOps for AI Overview | FinOps Foundation | 2026-10-28 | https://www.finops.org/wg/finops-for-ai-overview/ | 第 1 報 S-3.17 |
| S-0.8.9 | 内部 (第 1 報) | The Stage-Gate Model: An Overview | Stage-Gate International | 取得 2026-11-04 | https://www.stage-gate.com/blog/the-stage-gate-model-an-overview/ | 第 1 報 S-8.9 |
