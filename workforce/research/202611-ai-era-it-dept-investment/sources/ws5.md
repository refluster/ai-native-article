# WS5 ファクトパック — データ・知識資産とコモディティ化 (H-6.1 / H-6.2 / H-6.3)

担当: tobias (データエンジニアリング・分析) · tariq (知識体系: 版の置換・矛盾台帳) · linnea (定数と変数の分離・交絡の命名)
アクセス日: 2026-11-04 · 検索使用: 8 / 10 · 一次文書は arXiv / NBER / 出版社版 PDF をテキスト抽出して本文で確認

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-5.1 | H-6.1 | BloombergGPT は 50B パラメータ、金融データ 363B トークン + 汎用 345B トークンで訓練された金融特化モデル (2023-03 公開、v3 2023-12)。著者自身は「金融タスクで既存モデルを上回り、汎用ベンチマークを犠牲にしない」と報告。比較対象は当時の同規模オープンモデル (GPT-NeoX, OPT-66B, BLOOM-176B) で、GPT-4 ではない。 | S-5.1 | A |
| F-5.2 | H-6.1 | Li et al. (J.P. Morgan AI Research + Queen's Univ., EMNLP 2023 Industry, v2 2023-10-10) は 5 タスク・8 公開データセットで ChatGPT/GPT-4 を BloombergGPT・ファインチューニング済み小型モデルと比較。結論: 「both models perform better on financial NLP tasks than BloombergGPT, which was specifically trained on financial corpora」(§5)。著者は理由を「the larger model size」の可能性とする。 | S-5.2 | A |
| F-5.3 | H-6.1 | Li et al. の数値 (BloombergGPT の値は同論文で再実行せず Wu et al. 2023 からの転記): FiQA SA weighted F1 — GPT-4(5-shot) 88.11 vs BloombergGPT(5) 75.07 vs fine-tuned RoBERTa-large 87.09。Headline weighted F1 — GPT-4(5) 86.00 vs BloombergGPT 82.20 vs fine-tuned BERT 95.36。ConvFinQA accuracy — GPT-4(0) 76.48, ChatGPT(0) 59.86 vs BloombergGPT 43.41。Financial PhraseBank (50% agreement) F1 — GPT-4(5) 0.86 vs BloombergGPT 0.51。 | S-5.2 | A |
| F-5.4 | H-6.1 (反証側) | 同論文で GPT-4 が負けた領域: NER (FIN3) entity F1 — GPT-4(20-shot) 56.71 < BloombergGPT(20) 60.82、ドメイン内訓練 CRF(FIN5) 82.70 が最高。著者: 「for tasks like NER and RE, LLMs are less effective than fine-tuned models」「For more complicated tasks such as structured prediction, the pretraining plus fine-tuning paradigm is still a leading option」。つまり「汎用モデル優位」はタスク依存で、構造化抽出では専用訓練が勝つ。 | S-5.2 | A |
| F-5.5 | H-6.1 | Li et al. は BloombergGPT 社内ベンチマーク (Bloomberg-internal) を評価していない。比較は公開ベンチマークのみ。訓練費用・推論費用の比較も無い — 「費用対効果」の直接証拠ではない。 | S-5.2, S-5.1 | A |
| F-5.6 | H-6.1 | Ovadia et al. (Microsoft Israel, arXiv 2312.05934 v3 2024-01-30): Llama2-7B / Mistral-7B / Orca2-7B、MMLU 5 科目 + 2023-08〜11 の米国 current events 多肢選択 (GPT-4 生成 + 人手検証)。知識源は全て Wikipedia。結論: 「RAG is a more reliable choice for knowledge injection」、RAG は「consistently outperforms」教師なしファインチューニング。 | S-5.3 | A |
| F-5.7 | H-6.1 | Ovadia et al. Table 2 (current events, accuracy): Mistral-7B base 0.481 → +RAG 0.875 / FT-reg 0.504 / FT-par(言い換え増強) 0.588 / FT-reg+RAG 0.810。Llama2-7B base 0.353 → +RAG 0.585 / FT-reg 0.219 (劣化) / FT-par 0.392。Orca2-7B base 0.456 → +RAG 0.876 / FT-reg 0.511 / FT-par 0.566。新規事実の FT は言い換え数に単調増加で改善 (§6)。 | S-5.3 | A |
| F-5.8 | H-6.1 | Ovadia et al. の限界 (§8 自認): 教師なし FT のみ (instruction-tuning / RL 系は未検証)、7B 3 モデルのみ、知識源は Wikipedia のみ、ハイパラ依存。企業固有データ・費用比較は対象外。 | S-5.3 | A |
| F-5.9 | H-6.1 | Menlo Ventures「2024: The State of Generative AI in the Enterprise」: RAG 採用 51% (前年 31%)、production モデルのうち fine-tuned は 9%、agentic 12%。調査: 米国 IT 意思決定者 n=600、従業員 50 人以上、2024-09-24〜10-08。VC (投資先利害あり) の調査で、「採用率」であり効果・費用の測定ではない。 | S-5.4 | A |
| F-5.10 | H-6.1 | Gartner による RAG vs fine-tuning の企業採用比率データ: NOT FOUND (公開プレスリリースで確認できず)。 | — | — |
| F-5.11 | H-6.1 | 「固有データ接続 (RAG) が専用モデル訓練より費用対効果が高い」ことを費用 (USD) と性能の両方で直接比較した一次研究: NOT FOUND。 | — | — |
| F-5.12 | H-6.2 | Dell'Acqua et al. (Organization Science, 2026-03-11 掲載, CC-BY; 2023 HBS WP の確定版): BCG コンサルタント n=758 (個人貢献者の約 7%)、事前登録、3 条件 (AI なし / GPT-4 / GPT-4+プロンプト講習) にランダム割付、ベースライン課題あり。GPT-4 は 2023-04 末版・既定システムプロンプト。frontier 内 18 課題: 「12.2% more tasks」「25.1% more quickly」+ 品質有意向上。 | S-5.5 | A |
| F-5.13 | H-6.2 | 同論文 frontier 外課題 (表計算データ + 「company insiders」のインタビュー資料から正解を導く戦略ケース): 正答率 対照 約 84.5% vs AI 条件 60% / 70.6% (平均 19 percentage points 低下)。抄録では「19% less likely」と表記 — 抄録と本文で単位表記が異なる。品質「40%」は主要指標の一本値としては本文で確認できず (品質向上は指標ごとに 17〜25% 程度、例: GPT+overview で coherence +25.1%、GPT スコア +19%)。 | S-5.5 | A |
| F-5.14 | H-6.2 | Brynjolfsson, Li & Raymond (NBER w31161 2023-04, 改訂 2023-11; QJE 140(2) 2025): Fortune 500 企業ソフト会社のカスタマーサポート、エージェント 5,179 人・300 万チャット、導入 2020-11〜2021-02 の段階的展開 (staggered rollout, 差の差 / Sun-Abraham 推定)。解決件数/時 +14% (平均)、低スキル・新人 +34%、熟練者は効果僅少。主に Philippines 拠点 (89% が米国外)。 | S-5.6 | A |
| F-5.15 | H-6.2 / H-6.3 | 同研究の AI は GPT 系に「labeled 顧客対応ログ」で追加訓練 (トップ performer ラベル付き) し、出力に「data firm's internal documentation」へのリンクを含む — すなわち**固有資産を開いた**ツール。ただし「公開情報のみ版」との比較腕は無い (AI あり/なしのみ)。 | S-5.6 | A |
| F-5.16 | H-6.2 | Noy & Zhang (Science 2023-07, DOI 10.1126/science.adh2586): 大卒専門職 n=453、事前登録オンライン実験、職種別インセンティブ付き執筆課題、半数に ChatGPT。時間 −40%、品質 +18%。WP 版 (2023-03-02, n=444) は時間 −0.8 SD・品質 +0.4 SD、時間 −10 分 (37%)。出力の事実確認はしていない。公開ツールのみで固有資産なし。 | S-5.7 (WP 本文確認), S-5.8 (Science 版数値) | A (WP) / B (Science 版の 40%・18%・n=453) |
| F-5.17 | H-6.2 | Dillon, Jaffe, Immorlica, Stanton (NBER w33795, 2025-05, 改訂 2025-11): Microsoft 365 Copilot (メール・会議・文書アプリ統合) を 66 社・7,137 人の知識労働者に個人単位でランダム付与、6 か月。後半に利用した処遇群 80% でメール時間 週 2 時間減、タスク量・構成の変化は検出されず。著者 3 名は当時 Microsoft 所属 (利害関係)。 | S-5.9 | A |
| F-5.18 | H-6.2 | 「公開情報のみ AI」vs「固有資産 (社内データ) を開いた AI」を同一課題・ランダム割付で比較した第三者測定の公開前例: NOT FOUND。既存 4 実験はいずれも「AI あり vs なし」設計。 | — | — |
| F-5.19 | H-6.2 / H-6.3 | Microsoft Learn「What is Microsoft Copilot?」(更新 2026-10-28): ライセンス階層自体が「web data only」(Copilot Chat Basic / M365 Copilot Basic) と「web data and work data (Microsoft Graph and Work IQ)」(Premium) に分かれ、Premium では Work IQ を on/off 可能 (off では「aren't grounded in Microsoft Graph and Work IQ」)。全階層「Access scoped by user permissions」。→ 公開 vs 固有の比較腕を製品設定だけで作れる素地はある (実験結果ではない)。 | S-5.10 | A |
| F-5.20 | H-6.3 | 同ページ: Premium は「organizational data (emails, files, meetings, calendars, teams, or organizational relationships)」を Microsoft Graph・semantic indexing で自動グラウンディング。SharePoint Advanced Management で「oversharing」削減と非アクティブサイト整理が「improve the quality of the responses」と記載 — ベンダー自身が「固有文脈の整備 = 応答品質」と位置づけ。 | S-5.10 | A |
| F-5.21 | H-6.3 | Gartner プレスリリース (2025-02-26, Roxane Edjlali): 「organizations will abandon 60% of AI projects unsupported by AI-ready data」through 2026 (予測)。根拠調査: 63% の組織が AI 向けの適切なデータ管理実践を持たない/不明 (調査の n・期間はページ未確認)。 | S-5.11 | B (ページ 403、検索スニペット経由) |
| F-5.22 | H-6.3 | 「働いた履歴 (組織固有の記憶) が資産化し、競争優位を生む」ことを効果量で示した独立研究: NOT FOUND。整合的な材料はベンダー文書 (F-5.19/5.20) と予測 (F-5.21)、および固有ログで訓練した支援ツールの効果 (F-5.15) に限られる。 | — | — |

## 2. 仮説ごとの暫定判定

- **H-6.1 (固有データは訓練より接続が費用対効果で勝る)**: **一部支持 · 確度 中**。F-5.2/5.3 (汎用大型モデルが金融特化 50B を大半の公開タスクで上回る)、F-5.6/5.7 (知識注入では RAG > 教師なし FT)、F-5.9 (企業採用は RAG 51% vs FT 9%) が方向として整合。ただし (a) 費用の直接比較は NOT FOUND (F-5.11)、(b) 構造化抽出 (NER/RE) では fine-tuned 小型モデルが勝つ (F-5.4)、(c) 最も成功した現場実験の一つ (F-5.15) は固有ログで**訓練**したツール。競合説明: 「規模 (パラメータ数・汎用訓練量) が効いただけでドメインデータの価値は否定されていない」(Li et al. 自身の解釈)、「RAG 優位は Wikipedia・7B・教師なし FT という条件の産物」。
- **H-6.2 (公開のみ vs 固有資産開放の比較は既存実験設計で実施可能、第三者測定の前例あり)**: **一部支持 · 確度 中**。設計の雛形 (事前登録 RCT F-5.12、段階展開 DiD F-5.14、オンライン RCT F-5.16、企業横断 RCT F-5.17) は複数の一次資料で確立。製品側にも比較腕を作れる設定がある (F-5.19)。しかし「公開 vs 固有」を処置変数にした前例は NOT FOUND (F-5.18) — 「前例がある」部分は不支持。
- **H-6.3 (働いた履歴の資産化は enterprise KG / institutional memory の実務動向と整合)**: **一部支持 · 確度 低**。整合する材料はベンダー文書 (F-5.19/5.20) とアナリスト予測 (F-5.21, B) で、独立した効果測定は NOT FOUND (F-5.22)。F-5.15 は間接的支持 (固有ログ + 社内文書で新人 +34%)。競合説明: 「データ整備の重要性」は記憶の資産化ではなく単なるデータ品質・権限衛生の問題として説明できる。

## 3. 矛盾・注意点 (linnea: 定数と変数、交絡)

1. **BloombergGPT 比較の交絡** — 変数が 1 つではない: モデル規模 (50B vs GPT-4 非公開・桁違いと推定)、RLHF の有無、評価時期、BloombergGPT 値は再実行でなく論文転記 (プロンプト差)。「ドメインデータは無価値」とは読めない。しかも Li et al. の著者は J.P. Morgan (Bloomberg の顧客/競合関係) で、評価は公開ベンチのみ。社内ベンチ (BloombergGPT の本来の用途) は比較外。
2. **Ovadia の「fine-tuning」は教師なし継続学習のみ** — 企業で言う LoRA/SFT とは異なる。RAG 側は質問と知識チャンクが 1 対 1 対応 (current events は GPT-4 がチャンクから設問生成) で RAG に有利な構造と著者自身が認める (§5)。
3. **Dell'Acqua の単位の揺れ** — 抄録「19% less likely」vs 本文「19 percentage points」(84.5% → 平均 約 65%)。相対では約 23% 減。引用時は本文の pp 表記を使い、「40% quality」は出典本文で確認できない二次流通値として使わない。版も 2023 WP と 2026 Org Sci で異なる。
4. **frontier 外課題は「社内インタビューに埋もれた手掛かり」** — 固有文脈を要する課題で AI 群が悪化した事例として読めるが、ケースは架空企業であり、AI に資料を読ませる方法も自由。「固有資産を開けば改善した」かは未検証 (開いた腕が無い)。
5. **Brynjolfsson の AI は固有データで訓練済み** — 「AI vs なし」の効果に「汎用 LLM の効果」と「固有ログ・社内文書の効果」が混在し分離不能。H-6.1 (訓練より接続) にはむしろ反例寄り。比較基準も 2020–21 年の GPT 系で、現行モデルとは定数が違う。
6. **Microsoft 関係者による研究** — Ovadia (Microsoft Israel)、Dillon 他 (著者 3 名 Microsoft)、Copilot 文書 (Microsoft)。製品を売る側の資料が H-6.2/6.3 の支持側に偏る。
7. **Menlo / Gartner は採用率・予測であり効果量ではない** — Menlo は VC (AI 投資先の利害)、母集団は米国のみ。Gartner の 60% は「予測」で検証済み事実ではない。「AI-ready data」の定義は Gartner 独自で、他社調査の「データ品質」と同一視しない。
8. **期間の定数** — 4 実験のモデルは 2020–2024 年世代。2026 年時点の frontier は移動しており、効果量の外挿は不可。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-5.1 | 準一次 | BloombergGPT: A Large Language Model for Finance (Wu et al.) | arXiv (Bloomberg / JHU) | 2023-03-30 (v3 2023-12-21) | https://arxiv.org/abs/2303.17564 | 抄録ページで 50B パラメータ、363B 金融 + 345B 汎用トークン、版履歴を確認。 |
| S-5.2 | 準一次 | Are ChatGPT and GPT-4 General-Purpose Solvers for Financial Text Analytics? A Study on Several Typical Tasks (Li et al.) | arXiv / EMNLP 2023 Industry | 2023-05-10 (v2 2023-10-10) | https://arxiv.org/abs/2305.05862 | v2 PDF をテキスト抽出し Table 2/3/5/6/8 の数値と §5 Discussions の引用文を確認。BloombergGPT 値は転記である旨 (Table 2 注) も確認。 |
| S-5.3 | 準一次 | Fine-Tuning or Retrieval? Comparing Knowledge Injection in LLMs (Ovadia et al.) | arXiv (Microsoft) | 2023-12-10 (v3 2024-01-30) | https://arxiv.org/abs/2312.05934 | v3 PDF をテキスト抽出し Table 2 数値、§5 結果、§7 結論、§8 限界、Wikipedia 知識源を確認。 |
| S-5.4 | 二次 (VC 調査、自社公表) | 2024: The State of Generative AI in the Enterprise | Menlo Ventures | 2024-11 | https://menlovc.com/2024-the-state-of-generative-ai-in-the-enterprise/ | ページ上で RAG 51% (前年 31%)、fine-tuned 9%、agentic 12%、n=600 米国 IT 意思決定者・50 人以上・2024-09-24〜10-08 を確認。 |
| S-5.5 | 準一次 | Navigating the Jagged Technological Frontier: Field Experimental Evidence of the Effects of AI on Knowledge Worker Productivity and Quality (Dell'Acqua et al.) | Organization Science (INFORMS), DOI 10.1287/orsc.2025.21838 | 2026-03-11 (Articles in Advance) | https://pubsonline.informs.org/doi/10.1287/orsc.2025.21838 | 出版社 URL は 403。CC-BY 4.0 の出版社版 PDF (INFORMS ヘッダ付き) の再配布コピー https://digital-fluency.pages.dev/research/foundational/dell-acqua-et-al-2026-navigating-the-jagged-technological-frontier.pdf を抽出し、抄録、n=758、12.2%/25.1%、84.5% vs 60%/70.6% (19 pp)、2023-04 末 GPT-4、限界節を確認。 |
| S-5.6 | 準一次 | Generative AI at Work (Brynjolfsson, Li, Raymond), NBER WP 31161 | NBER / QJE 140(2) | 2023-04 (改訂 2023-11; QJE 2025) | https://www.nber.org/papers/w31161 | NBER ページで抄録・14%・34%・n=5,179 を確認。WP PDF 本文で 300 万チャット、2020-11〜2021-02 展開、AI System Design 節 (labeled 対話での追加訓練、社内文書リンク)、Philippines 拠点を確認。 |
| S-5.7 | 準一次 | Experimental Evidence on the Productivity Effects of Generative Artificial Intelligence (Noy & Zhang), working paper | MIT Economics | 2023-03-02 | https://economics.mit.edu/sites/default/files/inline-files/Noy_Zhang_1.pdf | PDF 本文で n=444、時間 −0.8 SD・品質 +0.4 SD、−10 分 (37%)、事前登録 AEARCTR-0010882 を確認。 |
| S-5.8 | 準一次 | Experimental evidence on the productivity effects of generative artificial intelligence (Science 掲載版の紹介ページ) | Stanford Digital Economy Lab (SCALE) | 2023-07 | https://scale.stanford.edu/publications/experimental-evidence-productivity-effects-generative-artificial-intelligence | Science 本体 (science.org) は 403。Stanford ページで n=453、時間 −40%、品質 +18%、Science 2023-07 を確認 (Science 本文は未確認)。 |
| S-5.9 | 準一次 | Shifting Work Patterns with Generative AI (Dillon, Jaffe, Immorlica, Stanton), NBER WP 33795 | NBER | 2025-05 (改訂 2025-11) | https://www.nber.org/papers/w33795 | NBER ページで 66 社・7,137 人・6 か月・個人単位ランダム化・メール週 2 時間減・タスク構成変化なしを確認。arXiv 旧版は 56 社・約 6,000 人 (版差、検索結果で把握)。 |
| S-5.10 | 一次 | What is Microsoft Copilot? (Microsoft Learn) | Microsoft | 2026-10-28 (ms.date) | https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-overview | ページ本文でライセンス別グラウンディング (web only vs Microsoft Graph + Work IQ)、Work IQ on/off、「Access scoped by user permissions」、SAM による oversharing 削減と応答品質の記述を確認。 |
| S-5.11 | 一次 (ページ未到達) | Lack of AI-Ready Data Puts AI Projects at Risk (press release) | Gartner | 2025-02-26 | https://www.gartner.com/en/newsroom/press-releases/2025-02-26-lack-of-ai-ready-data-puts-ai-projects-at-risk | WebFetch は 403。60% 予測と 63% 調査値は検索結果スニペット (Gartner URL 上のタイトル・要約) と複数二次報道で一致を確認したのみ → 確度 B。調査 n・期間は未確認。 |
