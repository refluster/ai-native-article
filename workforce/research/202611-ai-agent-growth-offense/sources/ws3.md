# WS3 ファクトパック — 実企業の置換と組織の境界

- 座席: **bruno** (landscape) + **tomas** (組織パフォーマンス科学 — 「この有機体は動いているか、数字で」)
- 仮説: H-3.1, H-3.2, H-3.3, H-5.1, H-5.2
- アクセス日: 2026-11-05。検索 12 回 (standard のみ) + 一次 URL の直接取得 8 回 + ローカル読取 + 内部 API 2 本 (`/agents?limit=100`, `/performance`)。
- 内部集計スクリプト: scratchpad の `ws3-agg.mjs` (トークンは出力していない)。

## 1. 所見 (findings)

### I-3 労働資本と企業の境界 (H-3.1)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-3.1 | H-3.1 | Coase (1937) の命題: 企業が存在する主因は「価格メカニズムを使う費用」("there is a cost of using the price mechanism")。*Economica* N.S. 4(16), pp.386–405, 1937-11。本パックでは原典ページを取得していない (Wiley ペイウォール)。引用文は標準的な引用形に依拠 | S-3.1 | B |
| F-3.2 | H-3.1 | NBER の章 "The Coasean Singularity? Demand, Supply, and Market Design with AI Agents" (Shahidi, Rusak, Manning, Fradkin, Horton)。主張: AI エージェントはデジタル市場の取引費用を大きく下げうるが、市場レベルでは新たな摩擦による効率損失もある (gains と losses の両方)。会議版 2025-09-16。PDF は 403 で本文未確認、要旨は検索スニペット経由。**企業境界が実測で動いたという実証ではない** (理論・市場設計論) | S-3.2 | B |
| F-3.3 | H-3.1 | Brynjolfsson "The Turing Trap" (*Dædalus*, 2022 年春号, 2022-04-13): 人間を模倣・置換する AI (自動化) に偏ると、交渉力を失った側が抜け出せない均衡 ("an equilibrium in which those without power have no way to improve their outcomes") に陥る。人間を拡張する AI なら労働者は "a share of the value created" を主張できる。境界論ではなく分配論 — H-3.1 の反対側の重し | S-3.3 | A |
| F-3.4 | H-3.1 | arXiv "The Headless Firm" (2026-02) は「エージェントが取引費用を下げれば市場調整が有利になり、効率的な企業境界は縮みうる」と論じる (検索要旨のみ、本文未取得)。理論的予測であり実測なし | S-3.4 | C |
| F-3.5 | H-3.1 | **「境界がエージェント単位で日次に動かせる」ことの実企業での実測 — NOT FOUND。** 外部では理論 (F-3.2, F-3.4) のみ。内部では外部リポジトリへの「委任マージ」(R-N10) が、境界をエージェント×PR 種別単位で他社の規約側から開け閉めする実装例 (F-5.9) | — | — |
| F-3.6 | H-3.1/H-5.1 | Microsoft Work Trend Index 2025 "2025: The Year the Frontier Firm Is Born" (2025-04-23)。Edelman DXI 実施、知識労働者 n=31,000、31 市場、2025-02-06〜03-24 (うちリーダー 9,037)。"intelligence on tap" を「豊富・安価・オンデマンドな知能」と定義。**リーダーの 82% が今後 12–18 か月で "digital labor" を使い労働力の容量を拡大する見込みに自信**。人員: 削減を検討 33%、増員を検討 32%、AI を digital labor として使いつつ維持 45%。81% が 12–18 か月でエージェントを中〜大規模に統合する見込み。いずれも**意向調査であり実測ではない** | S-3.5 | A |

### I-3 実企業の置換と反転 (H-3.2)

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-3.7 | H-3.2 | **Klarna 2024-02-27 発表**: OpenAI 製アシスタントが稼働 1 か月で 230 万会話、顧客サービスチャットの 2/3 を処理、「700 人のフルタイム担当者に相当する仕事」。解決時間 11 分→2 分未満 (9 分短縮)、再問い合わせ 25% 減、2024 年に USD 40M の利益改善見込み。**自社推計の「相当」であり、700 人の解雇ではない**。Klarna 自社ページは取得失敗 (空)、複数の報道で一致 | S-3.6, S-3.7 | B |
| F-3.8 | H-3.2 | **Klarna 2024-12-12 (Bloomberg TV)**: CEO Siemiatkowski「約 1 年前に採用を止めた。4,500 人から 3,500 人になった」、"AI can already do all of the jobs that we as humans do" という意見。減少は主に自然減 (平均在籍 5 年 ≒ 年 20% 退職)。エンジニアは採用停止の例外 (広報、ITPro)。Bloomberg 本文はペイウォール、BI/Fortune 経由 | S-3.8 | B |
| F-3.9 | H-3.2 | **Klarna F-1 (2025-03 公開)**: 期末フルタイム従業員 2022: 5,527 → 2023: 4,352 → 2024: 3,422 (各年 約 −21%)。理由として "leveraging AI in our business" を挙げる。EDGAR 原本は未取得、Banking Dive 経由 | S-3.9 | B |
| F-3.10 | H-3.2 | **Klarna 反転 2025-05-08 前後 (Bloomberg)**: CEO は AI-first でコストが支配的要因になりすぎ、結果としてサービス品質が下がった ("lower quality") と認め、人間の顧客サービス要員を「Uber 型」の柔軟なリモート雇用 (学生・地方・既存ユーザー) で採用し始めた。AI 利用は継続。Bloomberg 原文未取得、複数報道で一致 | S-3.10 | B |
| F-3.11 | H-3.2 | **Shopify 2025-04-07 前後 (Lütke の社内メモ、のち X に公開)**: 人員・資源を求める前に「チームは AI で望むことを実現できない理由を示さねばならない」("demonstrate why they cannot get what they want done using AI")。AI 利用を業績・相互評価の質問票に追加。「自律 AI エージェントが既にチームにいたらこの領域はどう見えるか」を問う。X 原文は 402/451 で取得不可、Fortune (2025-04-08) 経由 | S-3.11 | B |
| F-3.12 | H-3.2 | **Duolingo 2025-04 下旬 (von Ahn の全社メール、LinkedIn 掲載)**: 「AI が扱える仕事への契約者の利用を徐々に止める」("gradually stop using contractors to do work that AI can handle")。2025-05 の釈明投稿: "I do not see AI as replacing what our employees do"、採用は「以前と同じ速度」で継続。2025-08 (NYT) には正社員の解雇は一度もしていないと発言 (Fortune 二次)。**対象は契約者であり正社員ではない**。契約者フェーズアウト自体は撤回されていない | S-3.12, S-3.13 | B |
| F-3.13 | H-3.2 | **Salesforce 2025-02-26 Q4 決算説明**: Benioff "we're not going to hire any new engineers this year"、エンジニアリング生産性 30% 向上 (30% の初出は 2024-12 のポッドキャスト)。同年 Agentforce 営業職は採用拡大中 | S-3.14 | B |
| F-3.14 | H-3.2 | **Salesforce 2025-08-29 頃 (The Logan Bartlett Show)**: "I've reduced it from 9,000 heads to about 5,000 because I need less heads" — サポート部門 約 −4,000 人 (約 −45%)。広報: サポートエンジニア職を補充しない、「数百人」を他部門へ再配置。**「解雇 4,000」か「補充停止+再配置」かの内訳は NOT FOUND** | S-3.15 | B |
| F-3.15 | H-3.2 | **Amazon Jassy 社内メッセージ (2025-06-17)**: "In the next few years, we expect that this will reduce our total corporate workforce as we get efficiency gains from using AI extensively across the company." 併せて "fewer people doing some of the jobs ... more people doing other types of jobs"。ページ本文で確認 (日付はページに無く「本日共有」とのみ — 日付は B)。**予測であり実施済み削減の数字ではない** | S-3.16 | A |
| F-3.16 | H-3.2 | **IBM 2025-05-06 (WSJ, Krishna)**: AI エージェントが HR 職「数百人 (a couple hundred)」の仕事を代替し、その分の投資でプログラマと営業を増やし総雇用は増えた。期間・解雇か欠員不補充かは不明。総従業員 270,300 (2024 年報) 比で小規模。WSJ 原文未取得 | S-3.17 | B |
| F-3.17 | H-3.2 | 置換の公表は 6 社とも **CEO 発言・社内メモ・自社推計** が出所で、第三者監査された「AI による置換人数」は **NOT FOUND**。数字の性格が異なる: Klarna = 相当 FTE (推計) + 期末人員 (F-1)、Salesforce = 部門人員、IBM = 数百 (概数)、Amazon/Shopify/Duolingo = 方針 | — | — |

### I-3 one-person unicorn (H-3.3)

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-3.18 | H-3.3 | Sam Altman: 「テック CEO 仲間のグループチャットで、1 人で 10 億ドル企業が初めて生まれる年の賭けをしている」(Alexis Ohanian との対談)。日付は 2023-10 説と 2024-02-01 説で二次資料が割れる。Fortune 2024-02-04 が報道。2026-04 に Altman が「賭けに勝った」と NYT に伝えたとの報は二次のみ・未確認 | S-3.18 | C |
| F-3.19 | H-3.3 | Cursor/Anysphere: ARR USD 100M (2025-01) → 500M 超 (2025-06) → 1B (2025-11) と報道。従業員は約 150〜300 と資料で 2 倍差、1 人当たり ARR は USD 3.3M〜13M と推計幅が 4 倍。**全て二次・推計** | S-3.19 | C |
| F-3.20 | H-3.3 | Midjourney: 売上 USD 500M・従業員約 100 (USD 5M/人) とする分析あり (ブリーフの「200M+ / 約 40 人」とは別の数字)。Lovable: ARR USD 400M・正社員 146 (2026-02、約 USD 2.7M/人)。いずれも二次・自社発表未確認 | S-3.19 | C |
| F-3.21 | H-3.3 | 比較点 (実企業): Klarna の CEO 発言で売上/従業員 USD 1.1M (時期 2025 後半、二次)。**1 人当たり ARR の一般企業での再現例 — NOT FOUND。1 人で 10 億ドル企業の確認例 — NOT FOUND** | S-3.20 | C |

### I-5 人間組織との同型と異質 (H-5.1, H-5.2) — 内部一次証拠

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-5.1 | H-5.1 | WTI 2025 の "agent boss" = 「エージェントを作り、委任し、管理して自分の影響を増幅する人」。"human-agent ratio" = 役割・タスクに何体のエージェントが要り、何人の人間がそれを導くかを測る**提案中の新指標**。WTI は比率の実測値を出していない | S-3.5 | A |
| F-5.2 | H-5.2 | ロスター実数 (API, 2026-11-05 取得): **エージェント 69 体、アーカイブ 0、一時停止 0**。作成日 2026-05-18〜2026-10-18 (5 か月で 69)。モデル: Sonnet 4.6 = 61、Haiku 4.5 = 6、Opus 4.7 = 2。`owner_email` は 2 種 | S-9.1 | A (内部) |
| F-5.3 | H-5.2 | 職務の結合: バインディング計 **168 本 (平均 2.43 本/体)**。分布 0 本 3 体 / 1 本 2 / 2 本 39 / 3 本 16 / 4 本 6 / 5 本 2 / 6 本 1。異なるスキル 33 種。うち `daily-research` 65 体・`feed-post` 64 体 = 168 本中 129 本 (77%) が**全員共通の 2 業務**で、職務固有の仕事は残り 39 本に集中。実行器は 168 本すべて `claude-code-routine` | S-9.1 | A (内部) |
| F-5.4 | H-5.1/H-5.2 | 管理幅: `reports_to` 上位 maya 13 / tessa 6 / elena 6 / mateo 6 / celeste 5 / anjali 5。人間側は 1 人 (operator)。**「69 エージェント : 1 人間」は組織図上の比率であり、人間が 69 体を個別に監督している実測ではない** (監督は R-N10 述語・CI・週次 digest による機械化) | S-9.1, S-9.4 | A (内部) |
| F-5.5 | H-5.2 | 予算: 各エージェントの `budget_monthly_usd_default` は USD 3〜15 (5: 18 体、6: 18、7: 16、3: 6、8: 5、4: 2、10: 2、12: 1、15: 1)、上書き 0、**合計 USD 423/月**。全体上限 W-3 は **USD 800/月** (2026-10-17 に 600→800、Client Studies Office 11 席の採用ラウンド)。**ブリーフ・CLAUDE.md の「USD 600/月」は古い** | S-9.1, S-9.2 | A (内部) |
| F-5.6 | H-5.2 | 実績 (2026-11 月初〜11-05): モデル化コスト **USD 77.2**、発火 758 回、課金対象 66 体、実測コスト 0 (計測未接続)、予算超過 2 体 (ingrid, nadia)。`/agents` 一覧の `cost_this_month_usd`・`runs_this_month`・`deliv_count_total` は 69 体すべて 0 で**一覧では未集計** — 使えない (ユニットの罠) | S-9.1, S-9.3 | A (内部) |
| F-5.7 | H-5.2 | 遊休: 直近 30 日 (2026-10-06〜11-05) の idle 判定 20 体 (うち 19 体が「担当業務の設計待ち」、1 体が出力待ち)。**69 体中 29% は共通業務以外の固有の仕事がまだ設計されていない** — 「雇ってから職務を作る」順序 | S-9.3 | A (内部) |
| F-5.8 | H-5.2 | PR 生産 (2026-05-15〜11-04): PR 計 670、+264,014/−62,876 行。autopilot によるマージ 136 (比率 0.203)、人間へのエスカレーション 145 (うち L0/L1 パス接触 46、理由不明 33、merge-engine 拒否 16)。2026-10 は PR 75・autopilot マージ 23。PR に関与した人間は `refluster` と `claude[bot]` のみ。PR 作者クレジットはエージェント 25 体・延べ 666 (共同クレジットのため総数を超える) | S-9.3 | A (内部) |
| F-5.9 | H-5.2 | 稟議に相当する線: Zone A (デザイントークン・ワークフロー・プロンプト・ルーブリック・統治文書) はエージェントが差分を提案できるが人間なしでマージ不可 (AGENTS.md §1)。自律マージは R-N10 の述語 (対象リポジトリ自身の統治文書が宣言する L0/L1 に触れない・全チェック緑・人間の CHANGES_REQUESTED なし・指名レビュアー全員の緑) を満たすときのみ、サーバ側で再検証し不明なら拒否 (fail closed) | S-9.4, S-9.2 | A (内部) |
| F-5.10 | H-5.2 | **予算での自動停止は導入後に撤回された**: 2026-09-09 にエージェント別予算超過で発火を拒否する実装が入り、PR ルータ nadia (モデル化 USD 75/月 vs 枠 USD 8)・作者レーン ren・記事パイプライン ingrid が先に止まり、未ルーティング PR 9 本が 3 日滞留 (CloudWatch WARN のみ)。2026-09-14 の ADR-0037 で「エージェント別予算は助言値 — 計測・報告するが発火は拒否しない、出力の継続性が計画値に優先」へ。強制は全体上限 (書込時拒否 + 請求アラーム) のみ。**ブリーフの「予算上限での自動停止」は現行仕様ではない** | S-9.5, S-9.2 | A (内部) |
| F-5.11 | H-5.2 | 記憶の圧縮: 実行ごとの記憶チャンクが 10 件たまると夜間に要約 (Sonnet 4.6、出力上限 2,000 トークン) へ畳み込み、要約が次回実行の「過去の記憶」になる。`## Identity-laminated facts` 節を一字一句再現しない要約は throw で拒否 (同一性の機械的保護) | S-9.6, S-9.10 | A (内部) |
| F-5.12 | H-5.2 | 同一性の変更: プロンプト・モデル・予算・バインディングは agents-api の書込経路でのみ、1 回 1 ペルソナ、書込時検証、不変の AUDIT 記録、週次 digest で事後レビュー (W-5)。スキルはファイル (SKILL.md + meta.json) で全エージェントに共有され、本文変更は version 番号の更新を伴う PR | S-9.2 | A (内部) |
| F-5.13 | H-5.2 | 採用ラウンド: `workforce/docs/hires/` に 11 本の採用ラウンド文書 (例: org-benchmark 9 名、Client Studies Office 再編 11 席)。W-3 改定表の各行が採用ラウンドと紐づく (予算=人員計画の一致) | S-9.7, S-9.2 | A (内部) |
| F-5.14 | H-5.2 | 未達の型: ROADMAP には「スキルを作ったが binding が無く一度も発火しない」(hypothesis/maya、design-note/aoi、positioning-write/yuki) が繰り返し記録され、binding の PATCH は operator の B 権限待ち。**人間 1 人が承認のボトルネック**であることの内部証拠 | S-9.8 | A (内部) |
| F-5.15 | H-5.2 | MVV の自己規定: 「人間は制度を設計し管理し、AI エージェントが実行し、学び、仕事を複利で積み上げる」。目標は「人間の引き継ぎごとにエージェントを貼る」ことではなく、エージェンシーの新しい経済 (低い実行費用・高い並列性) に合わせた仕事の再設計 | S-9.9 | A (内部) |

### 同型 / 異質 表 (H-5.2 の棚卸し)

| 人間組織の概念 | 本ワークフォースでの対応 | 判定 | 根拠 F-ID |
|---|---|---|---|
| 稟議・決裁権限 | Zone A = 人間なしでマージ不可。§8.1 の A/B 権限表 | **同型** | F-5.9 |
| 職務分掌・職務記述書 | バインディング (agent × skill × project)、`jd`、`reports_to` | **同型** (ただし 77% は全員共通の業務) | F-5.3, F-5.4 |
| 採用ラウンド・人員計画 | `hires/` の採用ラウンド文書 ↔ W-3 上限の改定 | **同型** (予算と人員計画が同じ表) | F-5.5, F-5.13 |
| 実績 (track record)・評価 | EXEC 実績行、`/performance` の PR 作者クレジット、遊休判定 | **同型** | F-5.7, F-5.8 |
| 管理幅 | maya の直属 13。人間は 1 人 | **一部同型** — 組織図はあるが監督は機械化 | F-5.4 |
| 人事異動・人格の変更 | agents-api 書込 1 回 1 ペルソナ + 監査 | **一部同型** (人事記録に近いが、人格そのものを書き換えられる) | F-5.12 |
| 記憶 (経験の蓄積) | 10 実行ごとの要約・2,000 トークン上限・同一性の節の機械的保護 | **異質** — 人間に「記憶を予算内に畳み、同一性を検査する」対応物はない | F-5.11 |
| 技能の伝承 | SKILL.md をファイルで共有、全員が同じ版を同時に使う | **異質** — 研修なしの瞬時伝播、版番号つき | F-5.12 |
| 人件費の予算管理 | エージェント別 USD 3〜15/月の予算 (助言値)、全体 USD 800 の強制 | **異質** — 給与でなく 1 発火ごとのモデル化コスト。自動停止は試して撤回 | F-5.5, F-5.10 |
| 人員比 | 69 エージェント : 1 人間 (所有者メール 2) | **異質** — WTI の "human-agent ratio" を実例で上回る | F-5.2, F-5.1 |
| 雇用の順序 | 雇ってから職務を設計 (29% が設計待ち)、遊休でも費用ほぼ 0 | **異質** — 遊休人員の費用が人間組織と桁違い | F-5.7 |
| 他社との境界 | R-N10: 相手側の規約が委任した PR 種別だけマージ可 | **異質寄り** — 外注契約に似るが、権限が機械検証される述語 | F-5.9, F-3.5 |

## 2. 仮説ごとの暫定判定

- **H-3.1** (労働の計算資本化で Coase の境界が動く) — **一部支持 / 確度 低**。理論 (F-3.1, F-3.2, F-3.4) と意向調査 (F-3.6: 82% が digital labor で容量拡大へ) はあるが、「境界がエージェント単位で日次に動く」ことの実企業での実測は NOT FOUND (F-3.5)。内部の R-N10 (F-5.9) は境界を PR 種別単位で開閉する実装例 1 件。競合説明: 境界を動かしているのは取引費用でなく、単なる人員削減圧力・金利・IPO 準備 (Klarna) かもしれない。Turing Trap (F-3.3) は「境界を動かせる」ことと「動かして得をする人」が別だと指摘する。
- **H-3.2** (置換の公表と反転) — **支持 / 確度 中**。6 社の公表を確認 (F-3.7〜F-3.16)、Klarna の反転 (F-3.10) と IBM の「置換して総雇用は増」(F-3.16) が非直線性を示す。確度が「高」でないのは、一次が Amazon のみページで確認、他は報道経由 (B) で、置換人数の第三者検証が無いため (F-3.17)。競合説明: Klarna の減少は採用停止+自然減 (F-3.8) で、AI がなくても成立した可能性。Salesforce・Duolingo は「補充停止・契約者」で、正社員の置換と同じではない。
- **H-3.3** (one-person unicorn は事例段階) — **一部支持 / 確度 低**。1 人当たり ARR の高い企業は報道されている (F-3.19, F-3.20) が全て C、従業員数の推計が 2 倍ずれる。1 人で 10 億ドルの確認例も一般企業での再現例も NOT FOUND (F-3.21)。「事例段階で一般化の証拠は無い」という仮説の後半はむしろ支持。競合説明: 高い 1 人当たり売上はモデル API の再販 (原価は他社の計算資源) で、労働代替の生産性ではない。
- **H-5.1** (管理幅 → 人間 1 人あたりのエージェント数、WTI の agent boss) — **支持 / 確度 中**。WTI が概念と指標を提案していることを一次で確認 (F-5.1, F-3.6)。ただし WTI は比率を測っておらず、提案に留まる。内部で 69:1 (F-5.2, F-5.4) だが、監督は人間の注意ではなく機械述語と事後 digest によるので、「管理幅」の意味自体が変わっている。
- **H-5.2** (本ワークフォースは 1 人が 69 体を運営する実例、同型と異質を棚卸しできる) — **支持 / 確度 高** (内部一次)。69 体・168 バインディング・USD 423 計画 / 800 上限・11 月 5 日間で USD 77.2・PR 670 本 (autopilot 20.3%) を実測 (F-5.2〜F-5.8)。**仮説文の 2 点は訂正が必要**: (1) 上限は USD 600 ではなく 800 (F-5.5)、(2) 「予算上限での自動停止」は 2026-09 に試して 5 日で撤回され、現行は助言値 (F-5.10) — この撤回自体が「異質さ (止めても気づかれない、遊休費用ほぼ 0) が新しい故障モードを生む」証拠として使える。競合説明: 1 人 operator が全 Zone A を持つので、69:1 は「承認待ちの列が 1 本」(F-5.14) でもあり、規模の効率なのか単一障害点なのか未分離。

## 3. 矛盾・注意点

- **生存者バイアス・発言の性格**: メモや CEO 発言は「AI-first を宣言した会社」の発言のみ。宣言せず静かに戻した会社は記録に残らない。Klarna は宣言と反転の両方が公表された珍しい例。
- **相当 FTE vs 実人員**: Klarna の「700 人相当」は会話量からの換算 (推計)、F-1 の 5,527→3,422 は期末人員 (実測)。両者を足したり因果で結んだりしない。2022-05 の約 700 人の解雇とは別の話 (報道の見出しが混同を誘う)。
- **採用停止 ≠ 置換**: Klarna・Salesforce・IBM の減少はいずれも「補充しない」の比重が大きく、解雇数は開示されていない。
- **予測 vs 実測**: Amazon (今後数年で減る見込み)・Shopify/Duolingo (方針)・WTI (意向 82%) は予測。実測は Klarna F-1 と Salesforce の部門人員のみ (いずれも B)。
- **ベンダの利害**: WTI は Microsoft (Copilot/エージェントの売り手) の調査。Salesforce の 4,000 人削減発言は Agentforce の販売文脈。Klarna は 2025 年の IPO 前に効率を訴える動機があった。
- **単位の罠 (内部)**: `/agents` 一覧のコスト・実行数・成果物数は全員 0 で未集計 — `/performance` の `budget` (モデル化コスト) を使う。モデル化コストは推計 (実測コスト 0 = 計測未接続)。PR 作者クレジットは共同クレジットで、合計が PR 総数を超える。`refluster` 651 件は git 上の作成者がオペレータ名義になる経路を含む可能性があり、「人間が 651 本書いた」とは読まない。
- **69:1 の読み方**: 所有者メールは 2 種、`claude[bot]` も人間扱いで集計されている。「人間 1 人」は統治上の主体の数であり、作業時間の計測ではない。
- **one-person unicorn の数字**: Cursor の従業員数は資料で 2 倍差、Midjourney はブリーフ記載 (USD 200M+ / 約 40 人) と今回見つけた分析 (USD 500M / 約 100 人) が別物。どちらも C で、予測の根拠にはしない。
- **ブリーフの古い前提**: W-3 = USD 600 (現 800)、「月予算 USD 6」(実際は 3〜15 の分布、6 は最頻値の 1 つ)、「自動停止」(撤回済み)。報告書本文に書く前に訂正すること。

## 4. 情報源台帳

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-3.1 | 一次 (未取得) | The Nature of the Firm | R. H. Coase, *Economica* N.S. 4(16):386–405 | 1937-11 | https://doi.org/10.1111/j.1468-0335.1937.tb00002.x | 書誌と引用文は標準的な引用形。Wiley 本文は今回取得していない → B |
| S-3.2 | 準一次 | The Coasean Singularity? Demand, Supply, and Market Design with AI Agents | NBER (Shahidi, Rusak, Manning, Fradkin, Horton) | 2025-09-16 (会議版) | https://www.nber.org/system/files/chapters/c15309/c15309.pdf | PDF 403。題名・著者・要旨は検索スニペット経由 → B |
| S-3.3 | 一次 | The Turing Trap: The Promise & Peril of Human-Like Artificial Intelligence | E. Brynjolfsson, *Dædalus* (American Academy of Arts & Sciences) | 2022-04-13 (2022 年春号) | https://www.amacad.org/publication/daedalus/turing-trap-promise-peril-human-artificial-intelligence | ページで定義文と拡張/自動化の主張を確認 |
| S-3.4 | 準一次 (未取得) | The Headless Firm: How AI Reshapes Enterprise Boundaries | arXiv 2602.21401 | 2026-02 | https://arxiv.org/html/2602.21401v1 | 検索要旨のみ、本文未読 → C |
| S-3.5 | 一次 (ベンダ) | 2025: The Year the Frontier Firm Is Born (Work Trend Index 2025) | Microsoft WorkLab | 2025-04-23 | https://www.microsoft.com/en-us/worklab/work-trend-index/2025-the-year-the-frontier-firm-is-born | n=31,000/31 市場/2025-02-06〜03-24/リーダー 9,037、82%/33%/32%/45%/81%、agent boss・human-agent ratio・intelligence on tap の定義をページで確認 |
| S-3.6 | 二次 | Klarna's AI bot is doing the work of 700 employees. What will happen to their jobs? | Euronews | 2024-02-28 | https://www.euronews.com/next/2024/02/28/klarnas-ai-bot-is-doing-the-work-of-700-employees-what-will-happen-to-their-jobs | 2024-02-27 発表の報道。Klarna 自社プレスページは取得結果が空 |
| S-3.7 | 二次 | Klarna's AI does the work of 700 people. What's that really mean? | American Banker | 2024-02 | https://americanbanker.com/payments/news/klarnas-ai-does-the-work-of-700-people-whats-that-really-mean | 230 万会話・2/3・USD 40M の数値の照合に使用 (スニペット) |
| S-3.8 | 二次 | Klarna Stopped All Hiring a Year Ago to Replace Workers With AI | Bloomberg (Fortune 再掲・Business Insider 引用) | 2024-12-12 | https://fortune.com/2024/12/12/klarna-stopped-all-hiring-replace-workers-with-ai | 4,500→3,500、"AI can already do all of the jobs" は BI の引用経由。Bloomberg 原文ペイウォール |
| S-3.9 | 二次 (一次の要約) | Klarna IPO filing: AI and workforce | Banking Dive | 2025-03-17 | https://www.bankingdive.com/news/klarna-buy-now-pay-later-bnpl-ai-workforce-ipo/742703/ | F-1 の 5,527/4,352/3,422 と "leveraging AI" の引用をページで確認。EDGAR 原本未取得 → B |
| S-3.10 | 二次 | Klarna Focuses on Human-Powered Customer Service | PYMNTS | 2025-05 | https://pymnts.com/bnpl/2025/klarna-focuses-on-human-powered-customer-service | Bloomberg 2025-05-08 インタビューの報道。"lower quality" と Uber 型雇用は複数報道で一致 |
| S-3.11 | 二次 | Shopify CEO says no new hires unless AI can't do the job | Fortune | 2025-04-08 | https://fortune.com/2025/04/08/shopify-ceo-ai-automation-no-new-hires-tech-jobs/ | "demonstrate why they cannot get what they want done using AI" をページで確認。X 原文 (x.com/tobi/status/1909251946235437514) は 402/451 |
| S-3.12 | 二次 | 'Continuing to Hire': Duolingo's CEO Clarifies AI Stance After Backlash — Read the Memo | Entrepreneur | 2025-05-23 | https://www.entrepreneur.com/business-news/duolingo-ceo-clarifies-ai-stance-after-backlash-read-memo/492141 | 4 月メモの契約者の一文と 5 月の釈明 2 文をページで確認。LinkedIn 原文未取得 |
| S-3.13 | 二次 | Duolingo CEO admits controversial AI memo did not give enough context | Fortune | 2025-08-18 | https://fortune.com/2025/08/18/duolingo-ceo-admits-controversial-ai-memo-did-not-give-enough-context-insists-company-never-laid-off-full-time-employees | NYT インタビューの要約 (スニペット) |
| S-3.14 | 二次 | No new engineer hires this year as AI coding tools boost productivity, says Salesforce | The Register | 2025-02-27 | https://www.theregister.com/2025/02/27/salesforce_misses_revenue_guidance/ | 決算説明の文字起こしで "not going to hire any new engineers this year"・30% (スニペット) |
| S-3.15 | 二次 | Salesforce sacrifices 4,000 support jobs on the altar of AI | The Register | 2025-09-02 | https://www.theregister.com/2025/09/02/salesforce_4000_jobs_ai | "9,000 heads to about 5,000 because I need less heads"、再配置「数百人」をページで確認 |
| S-3.16 | 一次 | Message from CEO Andy Jassy: Some thoughts on Generative AI | Amazon (aboutamazon.com) | 2025-06-17 | https://www.aboutamazon.com/news/company-news/amazon-ceo-andy-jassy-on-generative-ai | 2 文をページで確認。日付はページに無く (「本日共有」)、2025-06-17 は報道で確定 |
| S-3.17 | 二次 | IBM CEO says replacing HR staff with AI led to more hiring | People Matters (WSJ 2025-05-06 の報道) | 2025-05 | https://www.peoplematters.in/news/leadership/ibm-ceo-says-replacing-hr-staff-with-ai-led-to-more-hiring-45453 | 「数百」の HR 置換と総雇用増。WSJ 原文未取得 |
| S-3.18 | 二次 | Sam Altman one-person unicorn | Fortune | 2024-02-04 | https://fortune.com/2024/02/04/sam-altman-one-person-unicorn-silicon-valley-founder-myth/amp | 賭けの発言。日付は二次で割れる。2026-04 の「勝った」報は未確認 |
| S-3.19 | 二次 | Anysphere / Cursor (company) | Wikipedia (各報道の集約) | 2026-11 閲覧 | https://en.wikipedia.org/wiki/Anysphere | ARR マイルストーンと従業員数の幅。Midjourney・Lovable は分析ブログのスニペットのみで台帳外 (引用不可の三次) — 本文の数値は「二次で報道」の参考扱い |
| S-3.20 | 二次 | Klarna on track to reach $1 million in revenue per employee | Finextra | 2025 | https://www.finextra.com/newsarticle/46006/klarna-on-track-to-reach-1-million-in-revenue-per-employee | 1 人当たり売上の経営発言 (スニペット) |
| S-9.1 | 内部 | agents-api `GET /agents?limit=100` | 本ワークフォース | 2026-11-05 取得 | https://workforce-api.kohuehara.xyz/agents?limit=100 | 69 体を集計 (`ws3-agg.mjs`)。cost/runs/deliv 欄は一覧で 0 |
| S-9.2 | 内部 | workforce/docs/governance.md (W-3, W-5, R-N10, §8.1) | 本ワークフォース | 2026-11-05 時点 | workforce/docs/governance.md | W-3 改定表 (600→800 は 2026-10-17)、ADR-0037 の助言値化 |
| S-9.3 | 内部 | agents-api `GET /performance` | 本ワークフォース | 2026-11-05T05:32Z 生成 | https://workforce-api.kohuehara.xyz/performance | budget (77.2/758/66/800/超過 2)、pr_summary、idle (20) |
| S-9.4 | 内部 | AGENTS.md (Zone モデル) | 本リポジトリ | 2026-11-05 時点 | AGENTS.md | Zone A の承認線、§3 機械/人間の決定表 |
| S-9.5 | 内部 | ADR-0037 The per-agent budget is advisory | 本ワークフォース | 2026-09-14 | workforce/docs/adr/adr-0037-advisory-per-agent-budget.md | 自動停止の導入 (09-09) と撤回の経緯、nadia USD 75 vs 8 |
| S-9.6 | 内部 | lambdas/shared/memory-compaction.ts (ADR-0019) | 本ワークフォース | 2026-11-05 時点 | workforce/lambdas/shared/memory-compaction.ts | 閾値 10、Sonnet 4.6、2,000 トークン、同一性の節の検査 |
| S-9.7 | 内部 | workforce/docs/hires/ (採用ラウンド文書 11 本) | 本ワークフォース | 2026-11-05 時点 | workforce/docs/hires/ | ファイル数を確認 |
| S-9.8 | 内部 | workforce/ROADMAP.md | 本ワークフォース | 2026-11-05 時点 | workforce/ROADMAP.md | Phase 4 の「作ったが binding 未接続」照合メモ 3 件 |
| S-9.9 | 内部 | workforce/docs/mvv.md | 本ワークフォース | 2026-06-14 更新 | workforce/docs/mvv.md | Mission / Vision の文言 |
| S-9.10 | 内部 | workforce/docs/adr/README.md | 本ワークフォース | 2026-11-05 時点 | workforce/docs/adr/README.md | ADR 索引 (0019/0021 記憶、0037 予算) で採否状態を確認 |
