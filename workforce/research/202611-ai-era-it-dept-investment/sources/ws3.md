# WS3 ファクトパック — 迂回コスト・経済性・費用負担

担当席: pranav (定量モデル席: すべての入力に S-ID を付す) / silas (財務アドバイザー席: 実コスト・予算)
対象仮説: H-2.3, H-3.1, H-3.2, H-3.3, H-5.2, H-5.3
アクセス日: 2026-11-04 / 検索使用数: 14 / 14

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 (A/B/C) |
|---|---|---|---|---|
| F-3.1 | H-3.1 | Microsoft/LinkedIn Work Trend Index 2024: 「78% of AI users are bringing their own AI tools to work (BYOAI)」。中小企業では 80%。母数は **AI 利用者** であり全従業員ではない。調査: 31 市場のナレッジワーカー n=31,000 (各市場 1,000)、2024-02-15〜03-28、Edelman Data & Intelligence がオンライン実施。日本を含む。 | S-3.1 | A |
| F-3.2 | H-3.1 | 同調査で「75% of knowledge workers use AI at work today」。F-3.1 と掛け合わせると全ナレッジワーカーの約 58% (0.75×0.78) が BYOAI に相当 — **これは本 WS の算術推計であり、報告書の記載値ではない**。世代別 BYOAI: Gen Z 85% / Millennials 78% / Gen X 76% / Boomers 73%。 | S-3.1 | A (元値) / C (58% は推計) |
| F-3.3 | H-5.3 | 同調査: 「59% [of leaders] worry about quantifying the productivity gains of AI」、60% が「leadership lacks a plan and vision」と懸念。価値の定量化そのものが経営の未解決課題であることを示す。 | S-3.1 | A |
| F-3.4 | H-3.1 | MIT NANDA "The GenAI Divide" (2025-07): 公式 LLM サブスクリプション購入企業は 40% に対し、「workers from over 90% of the companies we surveyed reported regular use of personal AI tools for work tasks」。**企業単位の割合** (従業員単位ではない)。標本: 公開事例 300+ のレビュー、52 組織インタビュー、業界カンファレンス 4 件で集めた上級リーダー 153 名の回答、調査期間 2025-01〜06。報告書自身が「Preliminary Findings」と明記。 | S-3.2 | B |
| F-3.5 | H-3.1 | Netskope Cloud and Threat Report 2026 (データ期間 2024-10〜2025-10、顧客のクラウドセキュリティ分析テレメトリ): 生成 AI 利用者のうち個人 (会社非管理) アカウント経由は 47% (前年 78%)、会社承認アカウントは 25%→62%。**低下傾向**である点に注意。 | S-3.3 | B |
| F-3.6 | H-3.1, H-3.2 | 同報告: 機微データを AI アプリへ送信したインシデント (データポリシー違反) は 1 組織あたり平均 223 件/月、前年比約 2 倍。上位 25% 組織では約 2,100 件/月 (二次報道値)。**Netskope 顧客組織が母集団**で、全企業代表ではない。 | S-3.3, S-3.4 | B |
| F-3.7 | H-3.1 | Cyberhaven 2025 AI Adoption & Risk Report (Q2 2025): 「34.8% of corporate data employees put into AI tools is sensitive」(前年 27.4%、2 年前 10.7%)。母数は約 700 万人の労働者の実際の利用データ (同社 DLP 製品のテレメトリ)。単位は **AI へ投入されたデータ量に占める機微データの割合** であり、「機密を貼り付けた従業員の割合」ではない。ソースコードが AI 送信データの 18.7%。 | S-3.5 | A |
| F-3.8 | H-3.1 | 同 2025 報告: 「71.7% of AI tools are high or critical risk」、「83.8% of enterprise data going to AI is going to risky AI tools」。報告書自身が大半の利用を "shadow AI – the use of AI tools unsanctioned by corporate IT departments" と定義。 | S-3.5 | A |
| F-3.9 | H-3.1 | Cyberhaven 2026 報告 (ランディングページ): 「39.7% of all AI interactions involve sensitive data」、「One-third of employees access AI tools via personal accounts」。母数「222 companies」。期間・人数はページに記載なし。単位が 2025 版 (データ量比) と 2026 版 (インタラクション比) で異なる。 | S-3.6 | A (ページ記載) |
| F-3.10 | H-3.1, H-3.2 | Gartner (2025-11 発表、IT Symposium/Xpo): サイバーセキュリティリーダー n=302 (2025-03〜05) の 69% が「従業員が禁止された公開生成 AI を使っている疑いまたは証拠がある」。**組織単位の認知率**であり利用者比率ではない。予測: 2030 年までに世界の組織の 40% 超が無許可 AI に起因するセキュリティ/コンプライアンス事故を経験。推奨: 「conduct regular audits for shadow AI activity」「incorporate GenAI risk evaluation into their SaaS assessment processes」。 | S-3.7 | B |
| F-3.11 | H-3.1 | IBM / Ponemon Cost of a Data Breach 2025: 「One in five organizations reported a breach due to shadow AI」。シャドー AI 利用が多い組織は侵害コストが平均 USD 670,000 高い。世界平均侵害コスト USD 4.44M。標本は **侵害を経験した** 600 組織、2024-03〜2025-02。「only 37% have policies to manage AI or detect shadow AI」。 | S-3.8 | A |
| F-3.12 | H-3.1 | Samsung (2023-04〜05): 技術者が社内ソースコードを ChatGPT に投入したことを受け、会社所有端末での生成 AI 利用を禁止する社内メモ (Bloomberg が閲覧、Samsung が送付を確認)。メモ記載の社内調査で 65% が ChatGPT をセキュリティリスクと回答。漏洩件数 (例: "3 件") は報道間で不一致 — 確認できず。 | S-3.9 | B |
| F-3.13 | H-3.2 | IIA "Artificial Intelligence Auditing Framework" (IIA ページ日付 2024-09-13): ガバナンス・マネジメント・内部監査を対象、Three Lines Model を利用、実務者チェックリストを含む。ウェブページ上ではシャドー AI・AI 利用棚卸し・利用量/コスト測定への言及は **NOT FOUND** (PDF 本体は未確認)。 | S-3.10 | A (ページ範囲) |
| F-3.14 | H-3.2 | 第三者観測による測定の実在: F-3.5〜F-3.9 はいずれも IT 部門の自己申告ではなく、CASB/SSE (Netskope) や DLP (Cyberhaven) の **通信・データ移動ログ** に基づく。一方、**経費精算 / SaaS 支出データ** による AI 迂回コスト測定の一次資料 (Zylo/Productiv 等) は本 WS では未確認 → NOT FOUND。 | S-3.3, S-3.5, S-3.6 | B |
| F-3.15 | H-3.3, H-5.3 | MIT NANDA: 「Just 5% of integrated AI pilots are extracting millions in value」、「only 5% of custom enterprise AI tools reach production」。報告書の注記: 「directionally accurate based on individual interviews rather than official company reporting」。「95% of organizations are getting zero return」は企業 GenAI 投資 USD 30–40B を背景とする記述。 | S-3.2 | B |
| F-3.16 | H-3.3 | MIT NANDA: 外部パートナーシップ (購入・共同開発) の導入到達率 ~67% vs 内製 ~33%。著者自身が「does not necessarily prove causation」と注記。成功組織の特徴: 「Sourced AI initiatives from frontline managers, not central labs」、「Benchmarked tools on operational outcomes, not model benchmarks」、「decentralize implementation authority but retain accountability」。 | S-3.2 | B |
| F-3.17 | H-3.3 | McKinsey State of AI 2025 (n=1,993、2025-06-25〜07-29): 約 2/3 が全社スケール未着手、企業レベル EBIT 影響ありは 39% (多くは EBIT の 5% 未満)。ハイパフォーマー (EBIT の 5% 超が AI 由来かつ "significant value") は約 6%。ワークフローを根本再設計: ハイパフォーマー 55% vs その他 20%。約 3/4 のハイパフォーマーがスケール済/中 vs その他 1/3。 | S-3.11 | B |
| F-3.18 | H-5.3 | 同: ハイパフォーマーは「defined processes to determine how and when model outputs need human validation」を持つ傾向、「tracking KPIs for AI solutions」が価値と相関。ハイパフォーマーの 1/3 超がデジタル予算の 20% 超を AI に投下。**相関分析** (31 実践の relative weights analysis) であり因果ではない。 | S-3.11 | B |
| F-3.19 | H-3.3 | BCG "Where's the Value in AI?" (2024-10-24 発表): CxO n=1,000、59 か国・20+ 業種。74% が価値の実現・スケールに苦戦。リーダー (26%) は「invest strategically in a few high-priority opportunities」で、他社の約半数の施策に集中。資源配分 70% 人・プロセス / 20% 技術・データ / 10% アルゴリズム。フィールド期間は記載なし。 | S-3.12 | A |
| F-3.20 | H-2.3 | FinOps Foundation State of FinOps 2025: n=861、クラウド支出 USD 69B 超を代表。AI 支出を管理対象とする回答者 63% (前年 31%)。SaaS は合算 65%。現在の最優先は「Workload optimization and waste reduction」、今後 12 か月はガバナンス。 | S-3.13 | A |
| F-3.21 | H-2.3 | State of FinOps 2026: n=1,192 (AI 支出設問は N=693)、「98% of respondents now manage AI spend」(2025: 63%, 2024: 31%)。「FinOps for AI emerges as the top forward-looking priority」。AI 支出のドル額は記載なし。フィールド期間記載なし。 | S-3.14 | A |
| F-3.22 | H-2.3 | Gartner (2025-03-31): 2025 年の世界 GenAI 支出予測 USD 644B (643,860M)、2024 年 USD 365B から +76.4%。約 80% がハードウェア (サーバ・スマホ・PC)。ソフトウェア約 USD 37B、サービス約 USD 28B。Lovelock: CIO は野心的な POC・内製を減らし既存ベンダの GenAI 機能へ移ると予想。**市場規模予測であり企業の予算超過データではない**。Gartner 本体ページは 403 で直接未確認。 | S-3.15 | B |
| F-3.23 | H-2.3 | 「企業の AI 予算超過・トークン費用増大」の一次定量データ: 本 WS では NOT FOUND (検索予算内で未到達)。 | — | — |
| F-3.24 | H-5.2 | FinOps Framework "Invoicing & Chargeback" capability: Showback は「always required in any FinOps practice」、Chargeback は「dependent on organizational accounting policies」で「not always required」。**「Neither type of reporting should be considered more mature than the other.」** Crawl/Walk/Run は chargeback の精度・自動化の成熟度 (見積→実消費、手作業→財務ツール統合) を定義するもので、showback→chargeback の移行段階を定義するものではない。 | S-3.16 | A |
| F-3.25 | H-5.2 | FinOps Foundation "FinOps for AI Overview" (最終更新 2026-10-28): 「Show teams their AI costs, broken down by project and workload, before charging them back」。能力表に「chargeback for shared models and platforms」、配賦は「no accepted method for multi-agent workloads」。Crawl「Fail fast. Set cost and time limits up front.」/ Walk「Fund what production use requires and no more.」/ Run「Keep costs proportionate to the value delivered.」 | S-3.17 | A |
| F-3.26 | H-5.2 | 企業の showback / chargeback 採用率 (IT 全般・AI とも) の定量データ: NOT FOUND。State of FinOps 2025/2026 ページおよび Flexera State of the Cloud 検索結果に該当統計なし。 | S-3.13, S-3.14 | — |
| F-3.27 | H-5.2, H-5.3 | 「パイロット後に第二の事業部門が自費で採用したら横展開する」を明示的な展開ゲートとする一次資料・研究: NOT FOUND。検索で得られたのはベンダ/コンサルのブログ (共有基盤は中央、ユースケースは部門負担、等) のみで引用不可 (三次資料)。 | — | — |
| F-3.28 | H-5.3 | 「測定された価値の第三者 (監査・財務) 検証」を展開ゲートとする一次資料: NOT FOUND。近接する一次記述は F-3.16 (運用成果でベンチマーク)、F-3.18 (KPI 追跡が価値と相関)、F-3.25 (Run 段階で価値比例のコスト) のみで、いずれも検証主体を第三者と指定していない。 | S-3.2, S-3.11, S-3.17 | — |

## 2. 仮説ごとの暫定判定

### H-2.3 「同じ挙動をより安く」原則は AI 支出実態から裏付けられる
- 暫定判定: **一部支持** / 確度: **中**
- 根拠: F-3.20, F-3.21 (AI 支出を管理対象とする FinOps 実務者が 31%→63%→98% と 2 年で急増、FinOps for AI が最優先の将来課題)、F-3.22 (GenAI 支出 +76.4%)。
- 限界: 「AI 支出が予算を超過している」「トークン費用が増大している」の一次定量は NOT FOUND (F-3.23)。F-3.22 は約 80% がハードウェアで、企業の推論費用の伸びを直接示さない。
- 競合説明: FinOps 管理対象化の急増は、費用超過ではなく単に「新しい費目が登場した」ことによる会計上の取り込みでも説明できる。

### H-3.1 相当割合 (≥30%) が未承認 AI を使い、機密貼り付けも実測されている
- 暫定判定: **支持** / 確度: **高**
- 根拠: 独立した 3 系統が同方向 — 従業員調査 (F-3.1: AI 利用者の 78% が BYOAI)、ネットワーク/DLP テレメトリ (F-3.5: 個人アカウント 47%、F-3.7: 投入データの 34.8% が機微、F-3.9: 従業員の 1/3 が個人アカウント)、組織調査 (F-3.4: 90%超の企業で個人ツール常用、F-3.10: 69% の組織が禁止ツール利用を認知)。被害側も F-3.11 (侵害組織の 1/5 がシャドー AI 起因、+USD 670K)。
- 注意: 30% 閾値を **従業員単位** で直接満たす値は F-3.5 (47%)・F-3.9 (1/3) と、F-3.2 の推計 (約 58%)。F-3.4・F-3.10 は組織単位。F-3.5 は個人アカウント比率が 78%→47% と **低下** しており、承認ツールの提供で迂回が減る可能性を示す (H-3 系の「迂回は供給で減る」解釈を補強しうる)。

### H-3.2 迂回コストは第三者の観測データで測る実務が存在する
- 暫定判定: **一部支持** / 確度: **中**
- 根拠: CASB/SSE・DLP のログによる測定は実在し、主要数値はそこから出ている (F-3.14, F-3.6, F-3.7)。Gartner がシャドー AI の定期監査と SaaS 評価への組込みを推奨 (F-3.10)。
- 限界: 測定しているのは「利用・データ流出リスク」であり **迂回の金額 (コスト)** ではない。経費精算・SaaS 支出データからの測定は NOT FOUND。IIA AI 監査フレームワークのウェブページにシャドー AI 測定の記述なし (F-3.13)。測定主体は監査・財務ではなくセキュリティベンダが中心。
- 競合説明: 「実務が存在する」のはセキュリティ製品の販売文脈であり、内部監査・財務部門による独立測定が標準実務とまでは言えない。

### H-3.3 「一チーム一作業」から始める順序は全社一斉より成功率が高い
- 暫定判定: **一部支持** / 確度: **低〜中**
- 根拠: 成功組織は現場マネージャー発の案件を運用成果で評価 (F-3.16)、リーダーは少数の高優先案件に集中 (F-3.19: 他社の約半数)。パイロットの大半が P&L 影響なし (F-3.15, F-3.17)。
- 限界: 「チーム単位の段階導入」と「全社一斉導入」の成功率を直接比較した研究は NOT FOUND。NANDA の 67%/33% は「購入 vs 内製」の比較であり導入順序の比較ではない。
- 競合説明: McKinsey ではハイパフォーマーは「transformative」志向でワークフローを根本再設計し、より速くスケールする (F-3.17) — 「小さく始める」より「大きく構える」ことが価値と相関するとも読める。BCG の「集中」は案件数の絞り込みであり、範囲の小ささではない。

### H-5.2 費用負担は showback → chargeback の段階モデルが確立、「第二部門の自費採用」は chargeback 成熟段階に相当
- 暫定判定: **一部支持** / 確度: **中** (前半) ・ 後半は **未検証**
- 根拠: FinOps for AI が明示的に「chargeback の前に showback」を推奨 (F-3.25)、共有モデル/プラットフォームの chargeback を能力として列挙。
- 反証寄り: FinOps Framework 本体は「Neither type of reporting should be considered more mature than the other」(F-3.24) と、showback→chargeback を **成熟段階として扱うことを否定**。Chargeback は会計方針次第で不要な組織もある。採用率データは NOT FOUND (F-3.26)。「第二部門の自費採用」を chargeback 成熟と同一視する根拠は NOT FOUND (F-3.27)。
- 競合説明: 熟議の「段階モデル」は FinOps for AI の推奨順序とは整合するが、FinOps 成熟度モデルの定義とは一致しない。

### H-5.3 展開の正当化は「自費再利用」より「測定価値の第三者検証」であり、ROI 検証ゲートが置かれる
- 暫定判定: **一部支持** (前半: 自費再利用ゲートの不在) / **未検証** (後半: 第三者検証ゲート) — 確度: **低**
- 根拠: 自費採用を展開条件にする実例は NOT FOUND (F-3.27) — 反証側の証拠が見つからないことは仮説前半と整合。価値測定と展開の相関は F-3.16, F-3.18, F-3.25。
- 限界: 第三者による価値検証を展開ゲートとして制度化した一次資料は NOT FOUND (F-3.28)。F-3.3 のとおり 59% のリーダーが価値の定量化自体に不安を持ち、ROI 検証ゲートが一般的に機能しているとは言いにくい。

## 3. 矛盾・注意点

1. **「シャドー AI」の定義と単位が報告ごとに異なる。** WTI = AI 利用者のうち自前ツール持込 (従業員自己申告)。Netskope = 生成 AI 利用者のうち個人アカウント経由 (通信観測)。Cyberhaven 2025 = AI 投入データ量のうち機微データの比率、2026 = インタラクションのうちの比率。NANDA・Gartner = 組織単位。これらを一つの「シャドー AI 率」として合算・比較しないこと。
2. **時系列の向きが逆。** Netskope の個人アカウント比率は 78%→47% に低下、Cyberhaven の機微データ比率は 10.7%→27.4%→34.8%→39.7% に上昇。「迂回が増えている」とも「減っている」とも単独データからは言えない。
3. **ベンダ利益相反。** Netskope (SSE)・Cyberhaven (DLP) は検出製品の販売者で、母集団は自社顧客 (既に懸念を持つ組織) に偏る。IBM の侵害調査は侵害経験組織のみ (n=600) で、全組織の侵害率ではない。
4. **MIT NANDA の 95% は方法論批判がある。** 母数は 52 組織インタビュー + 153 名のカンファレンス調査で「Preliminary」、成功定義は組織ごとに異なると報告書自身が注記。本文の公式掲載先 (NANDA) ではなく報道機関のミラー PDF で確認したため確度 B とした。
5. **McKinsey / BCG の「ハイパフォーマー」特性は相関。** 自己申告の EBIT 帰属で層別しており、因果 (この実践をすれば成果が出る) を示さない。
6. **FinOps 内部の記述の不一致。** Framework 本体 (F-3.24) は showback と chargeback の間に成熟度の上下を置かないが、FinOps for AI (F-3.25) は「先に showback」を推奨。熟議の「段階モデル」を引用する際はどちらを指すか明記が必要。
7. **Gartner 一次ページは 403 で直接未確認。** USD 644B と 69%/n=302 は配信プレスリリース・業界紙経由 (確度 B)。
8. **F-3.2 の約 58% は本 WS の算術推計** (75%×78%)。WTI 報告書の記載値ではないため、本文で使う場合は推計と明示すること。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 (一次/準一次/二次/内部) | 題名 | 発行者 | 日付 | URL | 検証メモ (何を実際にページで確認したか) |
|---|---|---|---|---|---|---|
| S-3.1 | 一次 | 2024 Work Trend Index Annual Report: AI at Work Is Here. Now Comes the Hard Part | Microsoft & LinkedIn | 2024-05-08 | https://www.microsoft.com/en-us/worklab/work-trend-index/ai-at-work-is-here-now-comes-the-hard-part | 78% BYOAI (AI 利用者母数)、75% AI 利用、n=31,000/31 市場、2024-02-15〜03-28、Edelman 実施、世代別値、リーダー懸念 59%/60% をページで確認 |
| S-3.2 | 準一次 | The GenAI Divide: State of AI in Business 2025 (Preliminary Findings) | MIT NANDA (Challapally, Pease, Raskar, Chari) | 2025-07 | https://www.artificialintelligence-news.com/wp-content/uploads/2025/08/ai_report_2025.pdf | ミラー PDF 全文を取得しテキスト確認: 方法論 (300+/52/153、2025-01〜06)、95%/5%、40% vs 90%超、67%/33% と因果否定の注記、成功組織の 4 特性、Research Limitations の文言 |
| S-3.3 | 二次 | Nearly half of workers use personal accounts for generative AI (Netskope Cloud and Threat Report 2026 報道) | CIO Dive | 2026-01-06 | https://www.ciodive.com/news/shadow-ai-security-risks-netskope/808880/ | 47% (前年 78%)、承認アカウント 25%→62%、223 件/月・前年比 2 倍、データ期間 2024-10〜2025-10 を記事で確認。Netskope 一次ページ (https://www.netskope.com/resources/cloud-and-threat-reports/cloud-and-threat-report-2026) は本文取得不可 |
| S-3.4 | 二次 | Average organization now reporting over 200 GenAI-related data policy violations each month | TechRadar Pro | 2026-01 | https://www.techradar.com/pro/security/average-organization-now-reporting-over-200-genai-related-data-policy-violations-each-month | 検索結果スニペットで 223 件/月・上位 25% 約 2,100 件/月を確認 (記事本文は未取得) |
| S-3.5 | 一次 | AI Adoption and Risk Report Q2 2025 | Cyberhaven Labs | 2025 (Q2) | https://info.cyberhaven.com/hubfs/Content%20PDF/Cyberhaven%20Labs%20-%202025%20AI%20Adoption%20&%20Risk%20Report.pdf | PDF を取得しテキスト確認: 7M 労働者、34.8%/27.4%/10.7%、71.7% 高リスク、83.8%、shadow AI の定義文 |
| S-3.6 | 一次 | AI Adoption & Risk Report 2026 (landing page) | Cyberhaven | 2026 | https://www.cyberhaven.com/resources/report/ai-adoption-risk-report-2026 | ページで 39.7%、1/3 個人アカウント、222 社を確認。PDF 本体はゲートで未確認 |
| S-3.7 | 二次 | Gartner: 40% of Firms to Be Hit By Shadow AI Security Incidents | Infosecurity Magazine | 2025-11-20 | https://www.infosecurity-magazine.com/news/gartner-40-firms-hit-shadow-ai/ | 69%、2030 年 40% 超予測、監査・SaaS 評価推奨の引用を記事で確認。n=302・2025-03〜05 は検索結果に表示された Gartner プレスリリース配信文で確認 (記事本文には記載なし) |
| S-3.8 | 一次 | IBM Report: 13% Of Organizations Reported Breaches Of AI Models Or Applications, 97% Of Which Reported Lacking Proper AI Access Controls (Cost of a Data Breach 2025) | IBM Newsroom / Ponemon Institute | 2025-07-30 | https://newsroom.ibm.com/2025-07-30-ibm-report-13-of-organizations-reported-breaches-of-ai-models-or-applications,-97-of-which-reported-lacking-proper-ai-access-controls | 1/5 がシャドー AI 起因侵害、+USD 670,000、37% 方針あり、USD 4.44M、n=600、2024-03〜2025-02 をページで確認 |
| S-3.9 | 二次 | Samsung bans ChatGPT workplace use (Bloomberg 配信) | The Japan Times | 2023-05-02 | https://www.japantimes.co.jp/news/2023/05/02/business/tech/samsung-bans-chatgpt-workplace-use | 検索結果で社内メモ・Samsung による送付確認・会社端末での禁止・社内調査 65% を確認。漏洩件数は報道間不一致 |
| S-3.10 | 一次 | The IIA's Updated AI Auditing Framework | The Institute of Internal Auditors | 2024-09-13 (ページ日付) | https://www.theiia.org/en/content/tools/professional/2023/the-iias-updated-ai-auditing-framework | ページで対象範囲 (governance, management, internal audit)、Three Lines Model、チェックリストを確認。シャドー AI・棚卸し・コスト測定の記述はページ上になし。PDF 未確認 |
| S-3.11 | 一次 | The state of AI in 2025: Agents, innovation, and transformation | McKinsey & Company (QuantumBlack) | 2025-11 | https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai | McKinsey 本体は 503。同一レポート PDF のミラー (https://www.rivista.ai/wp-content/uploads/2025/11/1762726272547.pdf) でテキスト確認: n=1,993、2025-06-25〜07-29、約 2/3 未スケール、39% EBIT、6% ハイパフォーマー定義、55% vs 20%、人間検証プロセス、KPI、20% 超予算、3/4 vs 1/3 |
| S-3.12 | 一次 | AI Adoption in 2024: 74% of Companies Struggle to Achieve and Scale Value | Boston Consulting Group | 2024-10-24 | https://www.bcg.com/press/24october2024-ai-adoption-in-2024-74-of-companies-struggle-to-achieve-and-scale-value | 74%、26% リーダー (4%+22%)、n=1,000 CxO・59 か国、少数案件集中・約半数の施策、70/20/10 をページで確認。フィールド期間記載なし |
| S-3.13 | 一次 | State of FinOps 2025 | FinOps Foundation | 2025 | https://data.finops.org/2025-report/ | n=861、USD 69B 超、AI 支出管理 63% (前年 31%)、SaaS 65%、優先順位をページで確認。chargeback/showback 採用率の記載なし |
| S-3.14 | 一次 | State of FinOps 2026 | FinOps Foundation | 2026 | https://data.finops.org/ | n=1,192 (AI 設問 N=693)、98% AI 支出管理、FinOps for AI 最優先、USD 83B 超をページで確認。chargeback/showback 記載なし |
| S-3.15 | 一次 (直接未確認) | Gartner Forecasts Worldwide GenAI Spending to Reach $644 Billion in 2025 | Gartner | 2025-03-31 | https://www.gartner.com/en/newsroom/press-releases/2025-03-31-gartner-forecasts-worldwide-genai-spending-to-reach-644-billion-in-2025 | gartner.com・businesswire.com とも 403。検索結果に表示された同リリース本文の抜粋で USD 643,860M / 364,964M / +76.4%、Lovelock の POC 縮小発言を確認。ハードウェア約 80% は二次要約経由 |
| S-3.16 | 一次 | FinOps Framework Capability: Invoicing & Chargeback | FinOps Foundation | 2026-11-04 アクセス時点 | https://www.finops.org/framework/capabilities/invoicing-chargeback/ | showback 常時必要、chargeback は会計方針依存、「Neither type ... more mature」の一文、Crawl/Walk/Run の記述をページで確認 |
| S-3.17 | 一次 | FinOps for AI Overview | FinOps Foundation (Working Group) | 2026-10-28 (最終更新) | https://www.finops.org/wg/finops-for-ai-overview/ | 「Show teams their AI costs ... before charging them back」、共有モデルの chargeback、multi-agent 配賦方法なし、Crawl/Walk/Run の各一文をページで確認 |
