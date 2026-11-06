# S1 論点構造化・初期仮説 (issue tree)

統括問い: **AI(エージェント)時代の企業IT部門は、どこに・どの順で先行投資すべきか。**

ツリーは MECE を「役割 (I-1) → 投資対象 (I-2〜I-7) → 意思決定 (I-8)」の3層で切る。各葉は反証可能な仮説 `H-x.y`、確認/反証の証拠、候補一次資料を持つ (G1)。熟議の到達点 D1–D9 を「day-one answer」として置き、外部証拠で判定する。

## I-1 役割の移行 — IT部門は「作る人」から「基盤・境界線の管理者」、さらに「接続面の設計者」へ移るか

- **H-1.1** 大手アドバイザリ (Gartner / Forrester / IDC / McKinsey) の 2025–2026 年の CIO 向け提言は、IT部門の役割を「AIアプリを作る」より「プラットフォーム・ガバナンス・統制基盤を整える」側に置いている。
  - 確認: CIO agenda / predictions の本文で platform, governance, guardrails が first-order の提言として現れる。反証: 「内製アプリ開発チーム拡充」が首位。
  - 候補資料: Gartner CIO & Technology Executive Survey 2026 press release, Gartner Top Strategic Technology Trends 2026 (agentic AI, AI governance platforms), McKinsey State of AI 2025, Forrester Predictions 2026.
- **H-1.2** 業務エージェントを事業部門が作る「連邦型 (federated) / 民主化」モデルは、中央集権型 CoE より採用が広がっており、中央は platform + guardrails を担う構造になっている。
  - 確認: 調査データで federated/hybrid 運用モデルが多数派。反証: 中央集権 CoE が主流で増加中。
  - 候補資料: McKinsey State of AI 2025 (operating model), Gartner AI CoE/operating model research, Deloitte State of GenAI in the Enterprise.
- **H-1.3** モデルのコモディティ化 (価格低下・性能収斂) は実測されており、差別化の源泉は「モデル」から「自社資産との接続面 (データ・ツール・ワークフロー)」へ移っている。
  - 確認: 推論コストの年率低下、オープンモデルとの性能差縮小、「context/data is the moat」型の実証。反証: フロンティア専用モデルの性能差が拡大、固有データでの fine-tune 優位が消失。
  - 候補資料: Stanford AI Index 2025 (inference cost decline), Epoch AI, a16z / Andreessen "LLMflation", Bloomberg GPT vs GPT-4 (Li et al. 2023), Microsoft Work Trend Index.

## I-2 先行投資の重心 — 「基盤 (権限・監査・シークレット・デプロイ)」が先か

- **H-2.1** エージェント固有のセキュリティ事故 (プロンプトインジェクション経由のデータ流出、過剰権限、ツール悪用) は 2025–2026 年に実例が公表されており、「権限の線・最小権限・監査ログ」は仮説ではなく現実の必要条件である。
  - 確認: OWASP Top 10 for LLM / Agentic AI, 公表インシデント (EchoLeak 等), Microsoft/Google の agent security guidance。反証: 公表事故がなく、ベンダ側の標準対策で足りる。
  - 候補資料: OWASP LLM Top 10 2025, OWASP Agentic Security Initiative, CSA, Microsoft Security blog, NIST AI 600-1.
- **H-2.2** エージェントの「権限 (identity)」「シークレット」「監査」はまだ業界標準が固まっておらず (非人間ID, agent identity, MCP 認可など)、先に敷いた企業が制度改訂に追随しやすい状態にある。
  - 確認: NHI (non-human identity) に関する標準化動向 (OAuth for agents, MCP auth spec, IETF drafts)、Gartner の AI TRiSM / agent governance 提言。反証: 既存 IAM で十分との実務合意。
  - 候補資料: MCP authorization spec, OWASP NHI Top 10, Gartner AI TRiSM, CSA Agentic AI IAM.
- **H-2.3** 「最も高機能な設計より同じ挙動をより安く」という原則は、AI 支出の実態 (トークン費用の増大、FinOps for AI の登場) から裏付けられる。
  - 確認: FinOps Foundation の AI cost 調査、企業の AI 予算超過の報告。反証: AI 支出は予算内で安定。
  - 候補資料: FinOps Foundation State of FinOps 2025/2026, Gartner GenAI spending forecast, Menlo Ventures Enterprise AI report.

## I-3 迂回コスト (シャドーAI) — 実在するか、どう測るか

- **H-3.1** 従業員の相当割合 (目安 30% 以上) が会社未承認の AI ツールを業務で使っており、機密情報の貼り付けも実測されている。
  - 確認: 複数の独立調査が同方向。反証: 未承認利用が 10% 未満。
  - 候補資料: Microsoft Work Trend Index 2024 (BYOAI 78%), Cyberhaven AI adoption & risk report, Netskope Cloud & Threat Report, Samsung 事例, Gartner shadow AI 推計, IBM Cost of a Data Breach 2025 (shadow AI 項目).
- **H-3.2** 迂回コストの測定は IT 部門の自己申告ではなく、第三者 (監査・財務・セキュリティ) の観測データ (SaaS 支出、DLP/CASB ログ、経費精算) で行う実務が存在する。
  - 確認: SaaS management / CASB による shadow AI 検出、内部監査の AI 監査ガイド (IIA)。反証: 測定実務が存在せず推計のみ。
  - 候補資料: IIA (Institute of Internal Auditors) AI auditing framework, ISACA, Netskope, Zylo/Productiv SaaS 管理レポート, Gartner "shadow AI" 推計.
- **H-3.3** 「一チーム一作業」から始める導入順序は、全社一斉導入より成功率が高いという証拠 (パイロット→拡大の成功要因研究) がある。
  - 確認: MIT NANDA "GenAI Divide" (95% のパイロットが成果なし、成功は特定業務・ベンダ連携型)、McKinsey の rewiring 事例。反証: 全社一斉導入の成功率が高い。
  - 候補資料: MIT NANDA State of AI in Business 2025, McKinsey State of AI 2025 (high performers), BCG "AI at Work" / "Where's the value in AI".

## I-4 境界線の設計 — 人間承認の線、提案/出荷の語彙、アクセス段階

- **H-4.1** 「エージェントは提案し、人間が承認・出荷する」(human-in-the-loop の明示的な線) は、主要な AI ガバナンス枠組みと実務 (PR レビュー、承認ワークフロー) で標準化されつつある。
  - 確認: NIST AI RMF / ISO 42001 の human oversight 要件、EU AI Act Art.14、主要ベンダの agent 設計ガイド (approval gates)。反証: 完全自律運用が標準。
  - 候補資料: EU AI Act Art.14, NIST AI RMF 1.0, ISO/IEC 42001, Anthropic/OpenAI/Microsoft agent design guidance.
- **H-4.2** データ分類 (等級) と段階的アクセス (read / summarize-draft / export) は、既存のデータ分類標準 (3〜4 等級) と DLP 実務に接続でき、新規発明ではない。
  - 確認: NIST SP 800-60 / ISO 27001 Annex A 5.12 の分類、Microsoft Purview sensitivity labels + Copilot の連携。反証: AI 向け段階アクセスは既存標準と断絶。
  - 候補資料: ISO/IEC 27001:2022 A.5.12, NIST SP 800-60, Microsoft Purview + Copilot docs, Google Workspace DLP.
- **H-4.3** 承認段階を増やしすぎると「空回り (no-op) / 確認の繰り返し」で成果が落ちる — 承認疲れ (alert fatigue / approval fatigue) の証拠が HITL 研究や DevOps 研究にある。
  - 確認: alert fatigue 研究、DORA の change approval board が遅延と相関する知見、自動化の過剰確認に関する HCI 研究。反証: 段階数と成果に相関なし。
  - 候補資料: DORA State of DevOps (heavyweight change approval), Accelerate (Forsgren et al.), alert fatigue literature, Anthropic/Microsoft の agent evaluation.

## I-5 再利用される「傭兵」 — 昇格単位、費用負担、保守

- **H-5.1** 再利用可能な単位は「エージェント個体」より「スキル / ツール / プロンプト資産」であり、企業内の再利用は内部マーケットプレイス・テンプレートライブラリの形で現れている。
  - 確認: 企業の agent/skill マーケットプレイス事例、Gartner の agent platform 提言、再利用率の公表値。反証: 個体 (ペルソナ) 単位の再利用が主流。
  - 候補資料: Gartner (agent marketplaces), Microsoft Copilot Studio agent catalog, Salesforce Agentforce, Anthropic Agent Skills, 事例記事.
- **H-5.2** AI 共通基盤の費用負担は、初期は中央予算 (showback)、成熟後に chargeback へ移る段階モデルが FinOps 実務として確立している。「二つ目の部門が自費で採用してから横展開」は chargeback 成熟段階の規律に相当する。
  - 確認: FinOps Foundation の showback→chargeback 成熟モデル、Gartner IT chargeback 研究。反証: AI では最初から chargeback が主流 / 中央予算が恒久。
  - 候補資料: FinOps Foundation Framework (Chargeback & Showback), Gartner IT financial management, TBM Council.
- **H-5.3** パイロットから全社展開を正当化する条件は「第二の部門での自費再利用」より一般に「測定された価値 (時間削減・品質) の第三者検証」であり、実務では ROI 検証ゲートが置かれる。
  - 確認: 展開ゲートの事例 (McKinsey, BCG)。反証: 自費採用を展開条件にする実例。
  - 候補資料: McKinsey "Superagency", BCG, Gartner AI scaling.
- **H-5.4** エージェントの記憶圧縮と同一性保持は未解決の研究課題であり、「個体育成」への投資は時期尚早という熟議の判断は、研究動向と整合する。
  - 確認: memory/compaction 研究、長期記憶ベンチマーク。反証: 同一性保持が実用上解決済み。
  - 候補資料: MemGPT/Letta, LongMemEval, Anthropic context management docs, Google/DeepMind の agent memory 論文.
- **H-5.5** 保守 (育成・問い合わせ・改訂) の担い手が決まらない限り昇格を止める、という条件は、ソフトウェア資産の「オーナー不在」リスク (orphaned assets) の実務知見と整合する。
  - 候補資料: ITIL service ownership, SaaS/低コード市民開発ガバナンス (Gartner citizen developer), Microsoft Power Platform CoE.

## I-6 機密情報とコモディティ化 — 何が差別化の源泉か

- **H-6.1** 固有データ (proprietary data) を汎用モデルに接続 (RAG / context) することは、固有データで専用モデルを訓練するより費用対効果が高く、「接続面」が投資対象になる。
  - 確認: BloombergGPT vs GPT-4 (Li et al. 2023)、RAG vs fine-tuning 比較研究、企業の採用実態。反証: 専用モデル訓練の優位が広く確認。
  - 候補資料: Li et al. 2023 "Are ChatGPT and GPT-4 General-Purpose Solvers for Financial Text Analytics?", Ovadia et al. 2023 "Fine-Tuning or Retrieval?", Menlo Ventures.
- **H-6.2** 「公開情報だけで足りる作業」と「固有資産を開く必要がある作業」の比較は、企業内 A/B・対照実験 (例: Microsoft/BCG/Harvard の生成AI 業務実験) と同じ設計で実施でき、第三者測定の前例がある。
  - 候補資料: Dell'Acqua et al. 2023 (BCG "jagged frontier"), Brynjolfsson et al. 2023 (customer support), Noy & Zhang 2023, Microsoft の Copilot 実験.
- **H-6.3** 「働いた履歴 (組織固有の文脈・記憶)」が資産化するという見立ては、enterprise knowledge graph / institutional memory の実務動向と整合する (仮説として扱う)。
  - 候補資料: Gartner "AI-ready data", Microsoft Graph grounding, Glean 等の事例.

## I-7 制度・規制の先行投資 — 台帳・監査ログ・最小権限が制度から要求される時間軸

- **H-7.1** EU AI Act (2026-08 高リスク義務適用)、ISO/IEC 42001、NIST AI RMF、日本の AI 推進法 (2025) とガイドラインは、いずれも「記録 (ログ)・人間監督・アクセス管理・リスク分類」を要求しており、熟議の「台帳・監査ログ・最小権限」はこれらと同型である。
  - 確認: 各法規の条文 (EU AI Act Art.12 record-keeping, Art.14 human oversight, Art.9 risk management)、ISO 42001 Annex A、日本 AI 事業者ガイドライン。反証: 記録・監督要件を欠く。
  - 候補資料: EU AI Act 条文 (EUR-Lex), ISO/IEC 42001:2023, NIST AI RMF 1.0 / AI 600-1, 総務省・経産省「AI事業者ガイドライン」, 内閣府 AI 推進法 (人工知能関連技術の研究開発及び活用の推進に関する法律).
- **H-7.2** 規制対応の lead time (ギャップ分析→実装→監査) は年単位であり、「制度改訂が追いつく前に土台を敷く」先行投資には実務上の根拠がある。
  - 確認: GDPR 施行時の対応期間の実績、EU AI Act のタイムライン (2024-08 施行→2026-08 適用)。反証: 対応は数か月で済む。
  - 候補資料: EU AI Act implementation timeline (EU Commission), GDPR readiness 調査.

## I-8 意思決定への翻訳 — 誰が払い、いつ反証するか

- **H-8.1** 日本企業では AI 投資の意思決定主体・予算線が IT 部門に偏り、事業部門主導の割合が米国より低い。「最初に払うのは現場部門長」という仮置きは日本では実例が少ない可能性がある。
  - 確認: IPA「DX 動向」/ JUAS 企業IT動向調査 / 総務省 情報通信白書の AI 導入主体データ。反証: 事業部門主導が多数派。
  - 候補資料: IPA DX動向 2025, JUAS 企業IT動向調査 2025, 総務省 令和7年版 情報通信白書, 経産省 DX レポート.
- **H-8.2** 反証条件に「期限・担当・判定責任者」を付ける規律は、ステージゲート (Cooper) / OKR / 投資委員会の kill criteria として確立した実務であり、四半期単位の判定が標準的である。
  - 候補資料: Cooper Stage-Gate, Gartner "AI value realization", Lean Startup innovation accounting.

## 既定の反証条件 (熟議から継承、期限と担当は operator が決める)

| 反証条件 | 測る主体 (案) | 既定の期限 (案) |
|---|---|---|
| 基盤整備後も影のエージェント (未承認 AI 利用) が減らない | 監査 / セキュリティ (CASB・SaaS 支出) | 最初のチーム稼働から 1 四半期 |
| 最初のチームが個人契約ツールに戻る | 財務 (経費精算) | 同上 |
| 完了件数だけ増え meaningful-work ratio が上がらない | 監査 + 現場共同定義 | 同上 |
| 選べるチームが見つからない | operator | 選定フェーズ 1 か月 |
| 台帳が形骸化する (更新停止) | 監査 | 2 四半期 |
| 段階を細かくした後に no-op 比率が上がる | 第三者集計 | 1 四半期 |
| 昇格スキルが二つ目の部門で再利用されない / 再利用コスト > 基盤コスト | 財務 | 昇格から 2 四半期 |
