# WS2 ファクトパック — 知的労働の as-a-service 化と価格 (H-2.1 / H-2.2 / H-2.3)

- 担当: **sofia** (市場戦略・支払意思額。誰が払い、いくら払う価値があるか) と **bruno** (景観の地図係)
- 作成日 / アクセス日: 2026-11-05
- 検索予算: 12 / 12 使用 (standard のみ)。残りは URL 指定の WebFetch で一次資料にあたった。
- アクセス制約: openai.com (API 価格ページ・ChatGPT Pro 告知) は 403 だった。API 価格は developers.openai.com で確認した。chatgpt.com/pricing は金額が描画されず取得できなかった。microsoft.com の Copilot Studio 価格ページは 503 で、Microsoft Learn で確認した。web.archive.org は取得不可。nasscom.in の PDF は curl で取得した。gartner.com は指示どおり試していない。
- 内部証拠: 第 1 報の S-2.15 (Epoch AI の推論価格下落) と S-2.16 (a16z LLMflation) は確度 A 済み。再調査せず S-0.2.15 / S-0.2.16 として引く。
- 注記: 「派生値」は本パックで計算した値であり、ベンダが表示した値ではない。計算式を併記する。

## 0. 価格表 — 労働の「単位」とその単価 (何ではないか付き)

| # | ベンダ / 製品 | 課金単位 | 単価 (USD) | 日付 (表示・発表) | その単位は何**ではない**か | S-ID | 確度 |
|---|---|---|---|---|---|---|---|
| P1 | Salesforce Agentforce (初期) | 会話 (conversation) | $2 / 会話。「standard volume discounts apply」 | 2024-09-12 発表、GA は 2024-10-25 | 解決ではない (解決しなくても課金)。会話内の作業量にも比例しない | S-2.1 | A |
| P2 | Salesforce Agentforce Flex Credits | アクション (action) = 20 credits | $500 / 100,000 credits。1 アクション = $0.10。音声アクションは 30 credits (派生値: $0.15) | 2025-05-15 発表。現行の価格ページにも掲載 (2026-11-05) | 会話でも解決でもない。アクションが発生しない対話は無料 (Salesforce blog による。二次経由)。成果とは無関係 | S-2.2, S-2.3 | A |
| P3 | Salesforce Agentforce add-ons / Agentforce 1 Editions | 人間ユーザ / 月 (PUPM) | add-on は $125 から。Agentforce 1 Editions は $550 から (1M Flex Credits / org / 年を含む) | 2025-06-17 発表 | エージェント 1 体の価格ではない。人間の席に付く「従業員向け無制限利用」の権利 | S-2.4 | A |
| P4 | Salesforce (現行の価格ページ) | ユーザ / 月 + credits | Agentforce User License $5。Agentforce Coworker User License $50。Max Edition は $550 から (2.75M Flex Credits / org / 年を含む)。会話課金 $2 も併存 | 2026-11-05 閲覧 (ページに発効日なし) | 席と従量の混成。単一の単位はない | S-2.3 | A |
| P5 | Intercom Fin AI Agent | 成果 (outcome) | $0.99 / outcome。席は $19〜132 / 月 | 2026-11-05 閲覧 | 「resolution」より広い。顧客が解決を確認した場合、追加質問がなかった場合、Procedure (handoff を含む) を完了した場合に数える。1 会話で 1 回まで | S-2.5 | A |
| P6 | Sierra | 成果 (合意した基準を満たすもの) | **価格の数字は公開されていない** | 2024-12-10 | 未解決や escalation は「in most cases」無料。routing 型は会話数で課金するブレンド | S-2.6 | A (方針), 価格は NOT FOUND |
| P7 | Cognition Devin (GA) | チーム / 月 | $500 から。席数無制限 | 2024-12-10 | ACU の記載はない (告知文には出てこない) | S-2.7 | A |
| P8 | Cognition Devin 2.0 | プラン | 「starting at $20」 | 2025-04-03 | 告知文に ACU 単価・定義の記載はない | S-2.8 | A |
| P9 | Devin (現行の価格ページ) | 席 / 月 + usage allowance | Free $0、Pro $20、Max $200、Teams $80 + $40 / dev seat、Enterprise は要相談。超過分は「at API pricing」 | 2026-11-05 閲覧 | **ACU という単位がページから消えている**。日次・週次で回復する quota 制 | S-2.9 | A |
| P10 | Microsoft Copilot Studio | Copilot Credit (2025-09-01 に「messages」から改称。数量と単価は変更なし) | 古典的回答 1、生成回答 2、エージェントアクション 5、tenant graph grounding 10、agent flow 100 アクションで 13、推論モデルは 1,000 tokens ごとに 10 credits | ms.date 2026-10-30 | 1 credit は 1 回答ではない。推論モデルの 1 メッセージの例は 141 credits、新規会話なら 461 credits | S-2.10, S-2.11 | A |
| P11 | Copilot Studio パック | credit | $200 / 25,000 credits / 月 (派生値: $0.008 / credit)。繰越しなし | 検索抜粋 (Microsoft ページ) | — | S-2.12 | B |
| P12 | Anthropic API | 100 万トークン (入力 / 出力) | フロンティア: Claude Fable 5.1 は $10 / $50。Opus 5.5 は $4 / $20。小型: Haiku 5.5 は $0.10 / $0.50 (≤100K プロンプト) | 2026-11-05 閲覧 | 作業量でも成果でもない。推論トークンも出力として課金される | S-2.13 | A |
| P13 | OpenAI API | 100 万トークン | フラッグシップ: gpt-6-astra は $10 / $50 (≤272K 入力)。小型: gpt-5-nano は $0.05 / $0.40。gpt-5-mini は $0.25 / $2.00 | 2026-11-05 閲覧 | 同上 | S-2.14 | A |
| P14 | Anthropic 消費者プラン | 人 / 月 | Pro $20 (月払い)、Max $100 (「5x Pro usage」)、Ultra $200 (「10x Pro usage every week」) | 2026-11-05 閲覧 | 労働量の保証ではない。使用量の倍率で表示 | S-2.15 | A |
| P15 | OpenAI 上位エージェント層 (報道) | エージェント / 月 | $2,000 (知識労働者向け)、$10,000 (ソフトウェア開発者)、$20,000 (PhD 級研究)。いずれも計画段階 | 2025-03-05 前後の報道 | 発売された価格ではない。投資家向けの説明の伝聞 | S-2.16 | C |
| P16 | 比較基準: 米国の人間労働 | 時間 | 顧客サービス担当者の時給中央値 $21.53 (2025-05)、年収 $44,770 | BLS OOH | 賃金のみ。福利厚生・管理費・席料などの fully-loaded cost ではない | S-2.17 | A |

派生比較 (推計、1 件あたり。人件費は賃金のみ): Agentforce の $2 / 会話は、BLS 中央値時給の約 5.6 分ぶん ($21.53 ÷ 60 × 5.6 ≈ $2.0)。Fin の $0.99 / outcome は約 2.8 分ぶん。Agentforce の 1 アクション $0.10 は約 17 秒ぶん。Copilot Studio の推論エージェントの例 (461 credits × $0.008 ≈ $3.69 / メッセージ) は、**1 メッセージで Agentforce の 1 会話より高くなる**。人間側の処理時間 (1 件何分か) は本パックでは NOT FOUND なので、「1 件あたり人間より安い」とはまだ言えない。

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 (A/B/C) |
|---|---|---|---|---|
| F-2.1 | H-2.1 | Salesforce は Agentforce を「pricing starts at $2 per conversation; standard volume discounts apply」として発表した (2024-09-12)。GA は 2024-10-25 (Service / Sales)。単位は会話で、解決ではない。 | S-2.1 | A |
| F-2.2 | H-2.1, H-2.2 | 2025-05-15 に Flex Credits を導入した。「$500 USD per 100,000 Credits」、「One Agentforce action consumes 20 Flex Credits ($0.10 USD)」。既存の $2 / 会話は「Thousands of organizations」が利用していた (社数の実数は出ていない)。課金単位が会話からアクション (投入側の作業) に移った。成果に近づいたのではない。 | S-2.2 | A |
| F-2.3 | H-2.2 | 2025-06-17 に席課金を追加した。Agentforce add-ons は $125 PUPM から (従業員向けは「Unmetered usage」)。Agentforce 1 Editions は $550 PUPM からで、1M Flex Credits / org / 年を含み、user license と credits を交換できる。同じ発表で、Enterprise / Unlimited Editions を 2025-08-01 から平均 6% 値上げした。 | S-2.4 | A |
| F-2.4 | H-2.2 | 現行の Salesforce 価格ページ (2026-11-05) には、会話 $2、Flex Credits $500 / 100k (アクション 20 credits、音声 30 credits)、Agentforce User License $5 / user / 月、**Agentforce Coworker User License $50 / user / 月**、Max Edition が $550 からで 2.75M credits / org / 年 (2025-06 の 1M から増量) が**併存**している。会話・アクション・席の 3 単位が同時に売られている。ページに発効日はない。 | S-2.3 | A |
| F-2.5 | H-2.1, H-2.2 | Intercom Fin は $0.99 / **outcome**。outcome は (a) 顧客が解決を確認した、(b) Fin の回答後に追加の助けを求めなかった、(c) Fin が workflow (Procedure、handoff を含む) を完了した、のいずれか。1 会話で 1 回のみ課金。(b) は「沈黙を解決とみなす」定義で、resolution と同じではない。2023 年に per-resolution で開始したという履歴は、一次資料では NOT FOUND (第三者のトラッカーのみ)。 | S-2.5 | A |
| F-2.6 | H-2.2 | Sierra (2024-12-10、Elliot Greenwald) は「gets paid only when we complete a task for you」と書いている。outcome の例は、解決した問い合わせ、解約阻止、upsell / cross-sell。基準は事前に合意する。未解決や escalation は「in most cases, there's no charge」。routing 型は会話数でのブレンド。**価格の数字は非公開**。 | S-2.6 | A |
| F-2.7 | H-2.1, H-2.2 | Devin は GA 時 (2024-12-10) に「starting at $500 a month for engineering teams」(席数無制限) だった。2.0 (2025-04-03) で「starting at $20」になった。現行の価格ページは Free / Pro $20 / Max $200 / Teams $80 + $40 / seat で、**ACU の語がない** (usage allowance は日次・週次で回復、超過は API pricing)。入口価格は 25 分の 1 に下がった (派生値: $500 → $20)。一方で単位は計算量 (ACU) から**席 + quota** に戻った。ACU の単価 ($2.25 など) と「250 ACUs」は、一次資料では NOT FOUND (第三者ブログのみで引用不可)。 | S-2.7, S-2.8, S-2.9 | A |
| F-2.8 | H-2.1 | Copilot Studio は 2025-09-01 に通貨を「messages」から Copilot Credits に改称した (「no change in the quantity per prepaid pack or to the pay-as-you-go rate」)。単価: 古典的回答 1、生成回答 2、エージェントアクション 5、tenant graph grounding 10、agent flow 100 アクションで 13。推論モデルには 1,000 tokens ごとに 10 credits が上乗せされる (キャッシュ読みは非課金)。プリペイド容量の 125% を超えるとエージェントを停止する。M365 Copilot ライセンス保持者の従業員向け利用は「No charge」。 | S-2.10, S-2.11 | A |
| F-2.9 | H-2.1 | Microsoft 自身の例では、推論モデル (Claude Opus 4.7) を使う顧客サポート 1 メッセージが **141 credits**、新規会話なら **461 credits** になる。「1 credit = 1 回答」という読みは誤り。パック単価 $200 / 25,000 (B) で換算すると約 $1.13〜$3.69 / メッセージ (派生値)。 | S-2.11, S-2.12 | A (credits) / B ($ 換算) |
| F-2.10 | H-2.1, H-2.2 | Anthropic API (2026-11-05): フロンティアの Fable 5.1 は $10 / $50 per MTok、Opus 5.5 は $4 / $20、Haiku 5.5 は $0.10 / $0.50 (≤100K)。**同じ Opus 系列**で、Opus 4 / 4.1 の $15 / $75 → Opus 4.5〜5 の $5 / $25 → Opus 5.5 の $4 / $20 と、出力単価が 3.75 分の 1 になった (派生値)。各モデルの発売日は本パックで未確認。フロンティアと小型の出力単価の比は 100 倍 ($50 / $0.50)。 | S-2.13 | A |
| F-2.11 | H-2.1 | OpenAI API (2026-11-05): gpt-6-astra は $10 / $50 per 1M tokens (≤272K 入力)、gpt-5-mini は $0.25 / $2.00、gpt-5-nano は $0.05 / $0.40。フロンティアと小型の出力単価の比は 125 倍。2 社のフロンティアの表示単価は $10 / $50 で**一致**している。 | S-2.14 | A |
| F-2.12 | H-2.1 | Claude の消費者プランは Pro $20 / 月 (月払い)、Max $100 (「5x Pro usage」)、Ultra $200 (「10x Pro usage every week」)。ChatGPT Pro の現行価格は、ページに「From … / month」とあるだけで金額を取得できず **NOT FOUND**。2024-12 の $200 という原告知は 403 で未確認。 | S-2.15, S-2.18 | A / NOT FOUND |
| F-2.13 | H-2.1 | 報道によれば、OpenAI は投資家に月 $2,000 / $10,000 / $20,000 の 3 層のエージェントを説明した。用途は高所得の知識労働者、ソフトウェア開発者、PhD 級研究。エージェントが将来の売上の 20〜25% になりうるとも説明したという (The Information、2025-03-05 前後)。発売は確認されていない。 | S-2.16 | C |
| F-2.14 | H-2.2 | a16z (2024-12-19) は「Software is becoming labor」と書き、チケットを AI が解決すると課金指標が「successful outcomes」に移ると述べる。例: Zendesk は $115 / 席 / 月、Decagon は会話課金と解決課金を併用、Cursor は席 + 従量。既存企業は「mostly stuck with per-seat or bundled options」。VC による分析で、利害がある。 | S-2.19 | A |
| F-2.15 | H-2.2 | Menlo (2025-12-09、n=495 の米国企業 AI 意思決定者、調査期間 2025-11-07〜25): 企業の生成 AI 支出は 2025 年 $37B (2024 年 $11.5B、3.2 倍。2024 年値は推論を除く)。アプリ層 $19B、インフラ層 $18B。コーディングは $4.0B で部門別 AI 支出の 55% ($550M から)。Agentforce などのエージェント基盤は $750M。「true agents」は企業展開の 16%、スタートアップ展開の 27%。**価格モデル (席・従量・成果) の内訳はページにない (NOT FOUND)**。 | S-2.20 | A |
| F-2.16 | H-2.2 | Futurum (2026-08-17、Keith Kirkpatrick、2H 2026 Enterprise Software Decision-Makers Survey、n は文書中に記載なし): コア業務ソフトでは per-seat が 5 方式中最下位の 12.6% (consumption 28.9%、outcome 22.2%)。ところが**別建ての AI 機能では per-seat が首位の 42.3%** (consumption 36.6%、outcome 21.1%)。同社の別の予測では、70% が consumption または outcome 連動を好む。Zendesk / Intercom / Decagon は pure outcome、Salesforce / Adobe / Pega / ServiceNow は hybrid と分類している。 | S-2.21 | A (文書上) / 調査の n は NOT FOUND |
| F-2.17 | H-2.2 | Gartner (2026-07、CIO Dive 経由): 2030 年までに最大 $234B の企業向けアプリ支出がエージェント AI のリスクにさらされる。SaaS 支出の約 20% が「market price adjustments」の対象になる。Brocklehurst の言葉: 「This breaks the link between user growth and revenue growth」。予測であり実測ではない。outcome-based 契約の比率についての Gartner の数値は NOT FOUND。 | S-2.22 | B |
| F-2.18 | H-2.3 | Anthropic Economic Index (2025-09-15): Claude.ai で directive (丸投げ型) の会話の比率は 2024-12 の 27% から 39% に上がり、automation 49.1% が augmentation 47% を初めて上回った。API (企業利用) では 77% が automation パターン。価格と利用の相関は**正**で、高コストのタスク類型ほど利用頻度が高い。1 社のプラットフォーム上の会話分類であり、労働市場の実測ではない。 | S-2.23 | A |
| F-2.19 | H-2.3 | NASSCOM (2025-02-24、FY2025 の推計): インドのテック産業の収入は $282.6B (ハードウェアを含む)、輸出 $224.4B、**BPM $54.6B (+4.7%)**。従業員は 5.8M で、純増 126,000 人。GenAI の PoC のうち本番に移ったのは 10〜15%。発表時点では、AI によって BPM の売上・雇用が減ったという兆候は**ない**。 | S-2.24 | A |
| F-2.20 | H-2.3 | BLS OOH: 米国の顧客サービス担当者は 2,666,000 人 (2025)、時給中央値 $21.53 (2025-05)。2025–35 年に **5% (141,800 人) 減少**する見込みで、理由は「tasks continue to be automated」と self-service。AI という語は使っていない。予測。 | S-2.17 | A |
| F-2.21 | H-2.3 | 米国とインドの BPO の時間単価を、信頼できる出典 (Everest / Deloitte / ILO) で比べたもの: **NOT FOUND**。見つかったのはベンダのブログ (US $25〜65/h、インド $6〜14/h) だけで、引用不可。BPO 市場規模の 1990〜2010 年代の推移と、「定型 → 判断」の階段を記述した BPO 文献: **NOT FOUND** (予算切れ)。 | — | NOT FOUND |
| F-2.22 | H-2.2 | 内部証拠: 第 1 報の S-0.2.15 (Epoch AI) は、推論価格の下落を年 9〜900 倍 (ベンチマーク 6 本、約 3 年) とする。S-0.2.16 (a16z) は、同一性能で年 10 倍。F-2.10 の Opus 系列の 3.75 倍は、これより**はるかに緩やか**。「同一性能の価格」と「同一ブランド階層の価格」は別物である。 | S-0.2.15, S-0.2.16 | A (第 1 報) |

## 2. 仮説ごとの暫定判定

- **H-2.1 (労働の単位課金は公開価格として成立している)** — 判定は**支持**、確度は**高**。F-2.1, 2.2, 2.5, 2.7, 2.8, 2.10, 2.11。会話 ($2)、アクション ($0.10)、成果 ($0.99)、credit (1〜10 / イベント + 推論トークン)、トークン ($0.05〜$50 / MTok) の 5 種類の単位が、主要 5 社の公開ページに載っている。ただし Sierra の価格と OpenAI の $20k 層は公開されていない (後者は C)。対立する説明: 単位課金は「労働の販売」ではなく従量 SaaS の延長にすぎない。Microsoft の credit が典型で、M365 ライセンス保持者には無料になり、席に吸収されている。
- **H-2.2 (単価は下がりつつ成果課金へ移行している)** — 判定は**一部支持**、確度は**中**。F-2.2, 2.3, 2.4, 2.6, 2.7, 2.10, 2.14〜2.17, 2.22。単価の低下は支持される: Opus 系列の出力単価が 3.75 分の 1、Devin の入口価格が $500 から $20、トークン単価は年 10 倍以上 (第 1 報)。ところが「成果へ移行」は直線ではない。Salesforce は会話から**アクション (投入)** に移り、その後**席**を足した。Devin は ACU から**席 + quota** に戻った。buyer は AI について per-seat を首位 (42.3%) に挙げている。pure outcome は CX 系 (Intercom, Sierra, Decagon, Zendesk) に集中している。解釈: 成果を測れる領域 (CX の解決) では outcome 課金が成立し、それ以外では予算化しやすい席への回帰が起きている。対立する説明: outcome 定義の緩さ (沈黙 = 解決) が売り手に有利に働き、buyer がそれを嫌って席を選んでいる。
- **H-2.3 (BPO との類比: 定型 → 判断の階段)** — 判定は**未検証**寄りの**一部支持**、確度は**低**。F-2.18〜2.21。directive / automation の比率の上昇 (27% → 39%、API 77%) と、高価値タスクほど利用が多い正相関は、「階段を上る」方向と整合する。一方で、BPO の歴史上の階段そのものと、時間単価の比較は NOT FOUND。インドの BPM は FY25 時点でまだ +4.7% で純増雇用もあり、「計算への裁定が地理への裁定を置き換えた」という実測はない。対立する説明: エージェントは BPO を置き換えるのではなく、BPO 事業者の道具になる (NASSCOM の「90% の大手が AI を統合」)。

## 3. 矛盾・注意点

- **単位の罠 (最重要)**: 会話 ≠ アクション ≠ outcome ≠ resolution ≠ credit ≠ トークン ≠ FTE 時間。Fin の outcome には「追加の質問がなかった」が含まれる。Copilot の 1 credit は 1 回答ではなく、推論 1 メッセージは 141〜461 credits。Agentforce の「Help Agent Resolutions $2」は単位表記がない。価格表の「何ではないか」列を落として引用しないこと。
- **派生値の扱い**: 1 件あたり人間何分ぶんか、という比較は賃金のみ (fully-loaded ではない) で、人間側の処理時間も NOT FOUND。「AI は人間の 1/10」のような見出しには使えない。
- **ベンダの利害**: 価格ページと press release は売るための文書である。「Thousands of organizations」は実数ではない。a16z (S-2.19) と Menlo (S-2.20) は投資家による分析で、投資先 (Decagon, Anthropic など) がある。Futurum は ETR データとの連携を宣伝する分析会社で、調査の n が文書中にない。
- **予測と実測**: Gartner の $234B / 20% と BLS の -5% は予測。OpenAI の $20k 層は伝聞で、発売されていない。NASSCOM の FY25 は推計 (E)。
- **生存者バイアス**: 価格ページに残るのは「今売っている」単位だけで、撤回された単位 (Devin の ACU) は履歴が消える。web.archive.org に入れず、改定の日付を一次資料で辿れない (ACU の単価・Fin の単位改称日は NOT FOUND)。
- **価格低下の測り方の違い**: Epoch / a16z の「同一性能の価格」(年 10 倍超) と、ベンダの「同一ブランド階層の価格」(Opus の 3.75 倍) は桁が違う。予測 (毎年 10 倍安く) に使うときは、どちらの定義かを明記すること。
- **フロンティアの単価は下がっていない面もある**: 2 社とも最上位は $10 / $50 で、2025 年の Opus 4 ($15 / $75) と同じ桁にある。最上位の能力の価格は「下がる」より「張り付く」。下がるのは 1 段下の階層。
- **Salesforce の矛盾**: 同じ時期に「$2 / 会話」「$0.10 / アクション」「席 $5〜$550」が併存し、単一の価格体系としては読めない。

## 4. 情報源台帳

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-2.1 | 一次 | Salesforce Agentforce announcement (Dreamforce 2024) | Salesforce | 2024-09-12 | https://www.salesforce.com/news/press-releases/2024/09/12/agentforce-announcement/ | 2026-11-05 アクセス。「starts at $2 per conversation; standard volume discounts apply」と GA 2024-10-25 を確認 |
| S-2.2 | 一次 | Salesforce Introduces New Flexible Agentforce Pricing to Accelerate the Digital Labor Revolution | Salesforce | 2025-05-15 | https://www.salesforce.com/news/press-releases/2025/05/15/agentforce-flexible-pricing-news/ | 本文で $500 / 100,000 credits、20 credits = $0.10、旧 $2 / 会話、「Thousands of organizations」を確認。PUPM の価格は「to be announced at GA」 |
| S-2.3 | 一次 | Agentforce Pricing | Salesforce | 2026-11-05 閲覧 (発効日なし) | https://www.salesforce.com/agentforce/pricing/ | Flex $500 / 100k、アクション 20 credits / 音声 30 credits、$2 / 会話、User License $5、Coworker $50、add-ons $125 / Industries $150、Max $550 から (2.75M credits) を確認 |
| S-2.4 | 一次 | Updated Product Packaging and Pricing Offer New AI Capabilities and More Ways to Scale AI Throughout Every Organization | Salesforce | 2025-06-17 | https://www.salesforce.com/news/?p=88023 | add-ons $125 PUPM、Agentforce 1 $550 PUPM (1M credits / org / 年)、2025-08-01 の平均 6% 値上げを確認 |
| S-2.5 | 一次 | Intercom Pricing | Intercom | 2026-11-05 閲覧 | https://www.intercom.com/pricing | $0.99 per outcome、outcome の 3 条件、1 会話 1 回、席 $19 (定価 $29) / $85 / $132 を確認 |
| S-2.6 | 一次 | Outcome-based pricing for AI agents | Sierra (Elliot Greenwald) | 2024-12-10 | https://sierra.ai/blog/outcome-based-pricing-for-ai-agents | outcome の例、「in most cases, there's no charge」を確認。価格の数字はなし |
| S-2.7 | 一次 | Devin is now generally available | Cognition | 2024-12-10 | https://cognition.com/blog/devin-generally-available | 「starting at $500 a month for engineering teams」、席数無制限を確認。ACU の記載なし |
| S-2.8 | 一次 | Devin 2.0 | Cognition | 2025-04-03 | https://cognition.com/blog/devin-2 | 「starting at $20」を確認。ACU 単価・定義はなし |
| S-2.9 | 一次 | Devin Pricing | Cognition | 2026-11-05 閲覧 | https://devin.ai/pricing | Free / Pro $20 / Max $200 / Teams $80 + $40 / seat、usage allowance、「at API pricing」を確認。ACU の語なし |
| S-2.10 | 一次 | Standard harness licensing - Microsoft Copilot Studio | Microsoft Learn | ms.date 2026-11-04 | https://learn.microsoft.com/en-us/microsoft-copilot-studio/billing-licensing | 2025-09-01 の messages → Copilot Credits (数量・単価は不変)、繰越しなし、M365 Copilot 保持者は無料を確認 |
| S-2.11 | 一次 | Billing rates and management - Microsoft Copilot Studio | Microsoft Learn | ms.date 2026-10-30 | https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management | 単価表 (1 / 2 / 5 / 10 / 13 per 100、推論は 10 / 1k tokens)、例 141 / 461 credits、125% で停止を確認。$ 単価の記載はなし |
| S-2.12 | 準一次 | Copilot Studio pricing (Microsoft page, search snippet) | Microsoft | 2026-11-05 検索 | https://www.microsoft.com/en-us/microsoft-365/copilot/pricing/copilot-studio | 本体は 503。検索抜粋で「25,000 Copilot Credits each, priced at $200.00/pack/month」を確認のみ → B |
| S-2.13 | 一次 | Pricing (Claude API docs) | Anthropic | 2026-11-05 閲覧 | https://platform.claude.com/docs/en/about-claude/pricing | 表で Fable 5.1 $10 / $50、Opus 5.5 $4 / $20、Opus 4.5〜5 $5 / $25、Opus 4 / 4.1 $15 / $75、Haiku 5.5 $0.10 / $0.50 (≤100K) を確認。発売日は未確認 |
| S-2.14 | 一次 | API Pricing | OpenAI (developers.openai.com) | 2026-11-05 閲覧 | https://developers.openai.com/api/docs/pricing | gpt-6-astra $10 / $50 (≤272K)、gpt-5-mini $0.25 / $2.00、gpt-5-nano $0.05 / $0.40 を確認 (WebFetch の要約経由) |
| S-2.15 | 一次 | Claude Pricing | Anthropic (claude.com) | 2026-11-05 閲覧 | https://claude.com/pricing | Pro $20 (月払い) / $17 (年払い)、Max $100 (5x)、Ultra $200 (10x / 週) を確認。API の価格も S-2.13 と一致 |
| S-2.16 | 二次 | OpenAI reportedly plans to charge up to $20,000 a month for specialized AI 'agents' (reporting The Information) | TechCrunch | 2025-03-05 | https://techcrunch.com/?p=2975942 | 検索結果の要約のみで、本文は未取得。原典の The Information は有料。$2k / $10k / $20k と 20〜25% は複数の報道で一致 → C |
| S-2.17 | 一次 | Customer Service Representatives, Occupational Outlook Handbook | U.S. Bureau of Labor Statistics | 2025-05 賃金 / 2025–35 予測 | https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm | $21.53 / h、$44,770、2,666,000 人、-5% (-141,800 人)、自動化が理由であることを確認 |
| S-2.18 | 一次 | ChatGPT Pricing | OpenAI | 2026-11-05 閲覧 | https://chatgpt.com/pricing | プラン名と「From … / month」のみ取得。金額は描画されず → NOT FOUND の根拠 |
| S-2.19 | 二次 (VC の一次分析) | AI Is Driving A Shift Towards Outcome-Based Pricing (December 2024 Enterprise Newsletter) | Andreessen Horowitz (Makarov, da Costa, Pinero) | 2024-12-19 | https://a16z.com/newsletter/december-2024-enterprise-newsletter-ai-is-driving-a-shift-towards-outcome-based-pricing/ | 「Software is becoming labor」、Zendesk $115 / 席、Decagon と Cursor の例を確認。投資家の利害あり |
| S-2.20 | 二次 (VC 調査、自社公表) | 2025: The State of Generative AI in the Enterprise | Menlo Ventures | 2025-12-09 | https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/ | $37B / $11.5B、$19B / $18B、コーディング $4.0B (55%)、エージェント基盤 $750M、true agents 16% / 27%、n=495、2025-11-07〜25 を確認。価格モデルの記述はない |
| S-2.21 | 準一次 (アナリスト) | The Pricing Split: Why Core Software and AI Can't Share One Commercial Model (AIOKK202608) | The Futurum Group (Keith Kirkpatrick) | 2026-08-17 | https://futurumgroup.com/wp-content/uploads/2026/08/The-Pricing-Split-Why-Core-Software-and-AI-Cant-Share-One-Commercial-Model_AIOKK202608.pdf | PDF の本文で 12.6 / 28.9 / 22.2%、42.3 / 36.6 / 21.1%、70% を確認。調査の n は記載なし |
| S-2.22 | 二次 | Agentic AI could disrupt $234B in SaaS spending: Gartner | CIO Dive (Paige Gross) | 2026-07-06 | https://www.ciodive.com/news/agentic-ai-disrupt-234-billion-saas-spending/824530/ | $234B / 2030、約 20%、Brocklehurst の引用を確認。Gartner の原文 (2026-07-01) は未取得 → B |
| S-2.23 | 一次 | Anthropic Economic Index: Uneven geographic and enterprise AI adoption | Anthropic | 2025-09-15 | https://www.anthropic.com/research/economic-index-geography | 27% → 39%、automation 49.1% / augmentation 47%、API 77%、価格と利用の正相関を確認 |
| S-2.24 | 一次 | Nasscom Strategic Review 2025 press release | Nasscom | 2025-02-24 | https://nasscom.in/sites/default/files/media_pdf/Nasscom%20SR%20Press%20release.pdf | PDF (2 頁) で $282.6B、BPM $54.6B、輸出 $224.4B、5.8M 人、純増 126,000 人、PoC の 10〜15% を確認。+4.7% は検索抜粋で確認 |
| S-0.2.15 | 内部 | LLM inference prices have fallen rapidly but unequally across tasks (Epoch AI) — 第 1 報 S-2.15 | Epoch AI | 2025-03-12 | https://epoch.ai/data-insights/llm-inference-price-trends | 第 1 報で A。再調査していない |
| S-0.2.16 | 内部 | Welcome to LLMflation (a16z) — 第 1 報 S-2.16 | Andreessen Horowitz | 2024-11-12 | https://a16z.com/llmflation-llm-inference-cost/ | 第 1 報で確認済み。再調査していない |
