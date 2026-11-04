# WS6 制度・規制 — fact pack (S3)

- 担当: levi (proactive product counsel) × tessa (policy & government affairs)
- 対象仮説: H-7.1, H-7.2
- アクセス日: 2026-11-04。検索 7 回 / 予算 10 回。条文は可能な限り一次テキスト (欧州委員会 AI Act Service Desk の統合版、EU 官報のスペイン語版 PDF、e-Gov 法令 API、総務省・PPC・NIST の公式 PDF) で直接確認した。
- 取得できなかったもの: EUR-Lex は自動アクセスを弾く (HTTP 202 のチャレンジ応答)。iso.org と meti.go.jp は 403。このため ISO/IEC 42001 の Annex A は二次情報しか使えず、確度 C とした。

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-6.1 | H-7.1 | EU AI Act Art.9(1): 高リスク AI システムには、リスク管理システムを「established, implemented, documented and maintained」することが要る。Art.9(2): ライフサイクル全体で回す「continuous iterative process」で、定期的な見直しを前提とする。**提供者 (provider) の義務で、対象は高リスク AI のみ**。汎用の社内エージェント全般にかかるものではない | S-6.1 | A |
| F-6.2 | H-7.1 | Art.12(1)「High-risk AI systems shall technically allow for the automatic recording of events (logs) over the lifetime of the system.」Art.12(2): ログの目的はリスク状況の特定、市販後監視 (Art.72)、導入者による運用監視 (Art.26(5)) の 3 つ。**システムが技術的にログを取れることを求める設計要件**で、ログを保管する義務は別条にある (F-6.4) | S-6.1 | A |
| F-6.3 | H-7.1 | Art.14(1): 使用中に自然人が「effectively overseen」できるよう設計する。Art.14(3): 監督措置はリスク・**自律性の水準**・利用文脈に比例させる。Art.14(4)(d)(e): 出力を「disregard, override or reverse」できること、「‘stop’ button or a similar procedure」で安全に停止できること。Art.14(4)(b) は自動化バイアスにも触れる | S-6.1 | A |
| F-6.4 | H-7.1 | Art.26 (導入者=deployer の義務): (1) 使用説明書に従うための技術的・組織的措置、(2) 監督を「necessary competence, training and authority」を持つ自然人に割り当てる、(5) 運用を監視し、リスクがあれば提供者と当局に通知して使用を停止する、(6) 自動生成ログを「of at least six months」保管する。提供者側のログ保管 (Art.19(1)) も最低 6 か月。**企業 IT 部門が導入者になる場合、権限ある人への監督割当とログ 6 か月保管が直接の義務になる** | S-6.1 | A |
| F-6.5 | H-7.1 | Digital Omnibus on AI (Regulation (EU) 2026/1744) を反映した欧州委員会の統合版 (2026-07-27 時点) では、Art.9・12・14・19・26 に AMENDED / NEW の印がない。**オムニバスは適用日を動かしたが、記録・監督・リスク管理の中身は変えていない** (印の有無による判定で、全文の突合はしていない) | S-6.1, S-6.3 | A |
| F-6.6 | H-7.2 | Art.113 (改正後) の適用日: 禁止 (Chapter I–II) は 2025-02-02、GPAI・ガバナンス (Chapter V, VII 等) は 2025-08-02、全般は 2026-08-02、**Annex III の高リスクは 2027-12-02**、**Annex I (規制製品組込み) の高リスクは 2028-08-02**。新しい禁止 (Art.5(1)(ba)(bb) ほか) は 2026-12-02。欧州委員会のタイムラインでも、2026-08-02 に Art.50 透明性義務の適用と執行開始を確認した | S-6.1, S-6.2 | A |
| F-6.7 | H-7.2 | Digital Omnibus on AI は「Reglamento (UE) 2026/1744 … de 8 de julio de 2026」として、2026-07-24 付の EU 官報 L シリーズに掲載された。発効は公布の 3 日後 (=2026-07-27)。Art.113 の改正で、高リスク (Ch.III Sec.1–3) を 2027-12-02 (Annex III) と 2028-08-02 (Annex I) へ延期した。**延期は提案ではなく発効済みの法である (2026-11 時点)**。なお 2026-09-29 付の訂正 (Berichtigung) があるとする二次情報があるが、内容は未確認 | S-6.3 | A |
| F-6.8 | H-7.2 | AI Act の発効から適用までの期間 (lead time、月数は計算値): 発効 2024-08-01 から禁止まで 6 か月、GPAI まで 12 か月、Annex III 高リスクまで当初 24 か月 (2026-08-02)、改正後 **約 40 か月** (2027-12-02)。Annex I は当初 36 か月 (2027-08-02) で、改正後 48 か月 (2028-08-02)。当初の Annex I 日付は、改正前 Art.113(c) の記憶とオムニバス前文の説明による | S-6.1, S-6.2, S-6.3 | A (当初 Annex I 日付は B) |
| F-6.9 | H-7.2 | 延期の理由として、欧州委員会 FAQ は「delay of standards and other support tools」を挙げる。高リスク規則の時期を標準と支援ツールの整備に合わせた。**規制当局自身が、整合規格なしの 24 か月では準備が足りないと認めた形**である | S-6.4 | A |
| F-6.10 | H-7.2 | GDPR: 2016-05-24 発効、2018-05-25 適用 (**24 か月**)。欧州委員会の公式ページで確認 | S-6.5 | A |
| F-6.11 | H-7.2 | IBM Institute for Business Value「The end of the beginning」: GDPR 準備の責任者 **n=1,500**、15 業種、34 か国、調査期間 **2018 年 2–4 月**。期限 (2018-05) までに「fully compliant」になると答えたのは **36%** にとどまる。24 か月の猶予があっても約 3 分の 2 が完全準拠を見込めなかったことになる。**自己申告の見込みで、実測の準拠率ではない。IBM は GDPR 対応サービスの売り手** | S-6.6 | A |
| F-6.12 | H-7.2 | 他の GDPR 準備調査 (McDermott/Ponemon 48% が期限に間に合わない、CompTIA 13% が完全準拠、など) は二次報道でしか確認できず、数値の幅が大きい。一次資料は未取得 | S-6.12 | C |
| F-6.13 | H-7.1 | ISO/IEC 42001:2023 の Annex A: 二次情報では 9 つの管理目的 (A.2–A.10) と 38 の管理策からなり、A.6.2.8「AI system recording of event logs」があるとされる。**ISO 公式ページは 403 で、本文も有償のため一次確認できなかった**。管理策の番号と文言は未検証 | S-6.11 | C |
| F-6.14 | H-7.1 | NIST AI RMF 1.0 (NIST AI 100-1、2023-01-26 公開、任意利用) の Core は GOVERN / MAP / MEASURE / MANAGE の 4 機能。GOVERN 1.6「Mechanisms are in place to inventory AI systems」(=台帳)、GOVERN 2.1 は役割・責任の文書化、MAP 3.5「Processes for human oversight are defined, assessed, and documented」、MANAGE 4.1 は導入後の監視計画、MANAGE 4.3 はインシデントの伝達。NIST の公式ページによると、AI RMF 1.0 は White House AI Action Plan に基づき改訂中 | S-6.7 | A |
| F-6.15 | H-7.1 | NIST AI 600-1 (GenAI Profile、2024-07): GenAI に固有のリスクまたは悪化するリスクとして 12 項目を定義する (Confabulation、Data Privacy、Information Security、Human-AI Configuration、Value Chain and Component Integration など)。GAI のプラグインや第三者入力は「inconsistent or insufficient access control」になりがちで、「logging, recording, and analyzing GAI incidents」が情報共有を助けるとする。**任意のプロファイルで、義務ではない** | S-6.8 | A |
| F-6.16 | H-7.1 | 日本の人工知能関連技術の研究開発及び活用の推進に関する法律 (令和七年法律第五十三号): 2025-06-04 に公布・一部施行、2025-09-01 に全面施行。活用事業者の責務 (第7条) は、活用に「努める」ことと国の施策に「協力しなければならない」こと。国は「国際的な規範の趣旨に即した指針の整備」(第13条) と、権利侵害事案の分析・指導・助言 (第16条) を行う。**確認した条文の範囲に、事業者へのログ記録・人間監督・アクセス管理の直接義務はない**。推進法であって規制法ではない | S-6.9, S-6.10 | A |
| F-6.17 | H-7.1 | 国会での「成立」日 (2025-05) は一次資料で確認できなかった (内閣府ページに記載があるのは公布と施行の日付のみ) | S-6.10 | NOT FOUND |
| F-6.18 | H-7.1 | 総務省・経産省「AI事業者ガイドライン」の版の履歴: 第1.0版 2024-04-19、第1.01版 2024-11-22、第1.1版 2025-03-28、**第1.2版 2026-03-31** (最新)。ほかにチャットボットを 2026-03-26、「活用の手引き (案)」を 2026-03-31 に公表 | S-6.13 | A |
| F-6.19 | H-7.1 | 第1.2版 本編 (共通の指針・透明性) は、検証可能性のために「開発過程、利用時の入出力等、AI の学習プロセス、推論過程、判断根拠等のログを記録・保存する」とし、記録方法・頻度・保存期間を事故原因の究明や損害賠償の立証上の重要性から検討するよう求める。公平性の項では「適切なタイミングで人間の判断を介在させる」としたうえで、自動化バイアスへの対策も挙げる。**保存期間の数値は示しておらず、あくまで任意 (自主的取組) の指針** | S-6.14 | A |
| F-6.20 | H-7.1 | 第1.2版 (令和7年度更新) で、AI エージェントの定義 (「特定の目標を達成するために、環境を感知し自律的に行動する AI システム」) を追加した。エージェント固有の留意事項として「人間の判断を介在させる仕組みの構築や最小権限設定」、「エージェントによる意図しない操作を防ぐために、適切な権限設定が重要」、データ最小化を明記している。**熟議の「最小権限・人間承認の線」(D3/D7) と最も直接に一致する日本の公的文書** | S-6.14, S-6.15 | A |
| F-6.21 | H-7.1 | 個人情報保護委員会「生成 AI サービスの利用に関する注意喚起等」(2023-06-02): 個人情報取扱事業者が個人データを含むプロンプトを本人同意なしに入力し、それが「応答結果の出力以外の目的で取り扱われる場合」は個人情報保護法違反となる可能性がある。このため、提供事業者が機械学習に利用しないことを「十分に確認すること」を求める。同日、OpenAI にも注意喚起を行った。**D7 の「外部へ出す」段階の判定基準として使える** | S-6.16 | A |
| F-6.22 | H-7.1 | 経産省の AI セーフティ関連 (AISI 評価観点ガイド等): meti.go.jp が 403 で、一次確認できなかった | — | NOT FOUND |
| F-6.23 | H-7.1 | EU AI Act に「最小権限 (least privilege)」やアクセス管理を明示的に求める条文があるか: 今回は Art.15 (cybersecurity) を取得しておらず、未確認。Art.9・12・14・26 には該当する文言がない | S-6.1 | NOT FOUND |

## 2. 仮説ごとの暫定判定

**H-7.1 (各制度は記録・人間監督・アクセス管理・リスク分類を要求しており、熟議の台帳・監査ログ・最小権限と同型である)**

- 暫定判定: **一部支持**。確度は**高**。
- 支持する点 (根拠 F-6.1〜6.4, 6.14, 6.15, 6.19, 6.20): 「ログ」「人間監督」「リスク管理」「台帳 (inventory)」の 4 要素は、EU AI Act (拘束力あり)、NIST AI RMF / 600-1 (任意)、AI事業者ガイドライン第1.2版 (任意) の 3 系統で独立して一致する。最小権限は、日本ガイドライン第1.2版が AI エージェントについて明記している。
- 留保する点:
  - (a) **拘束力の非対称**。法的義務は EU AI Act の高リスク区分に限られる。日本の AI 推進法には事業者への直接義務がない (F-6.16)。社内の業務エージェントの多くは Annex III に入らない。ただし雇用・人事評価などは Annex III の領域に入りうる (本 WS では Annex III 本文を取得していない)。
  - (b) **ISO/IEC 42001 は一次未確認** (F-6.13)。
  - (c) AI Act でアクセス管理を明示した条文は未確認 (F-6.23)。
  - (d) 「三段階アクセス台帳」という段階の設計はどの制度にもない。制度が求めるのは記録・監督・リスク比例の原則までで、段階の数は事業者が決める。
- 競合する解釈: 熟議の設計は規制と「同型」なのではなく、一般的なセキュリティ・内部統制のベストプラクティス (ログ保管、職務分掌) を AI に当てはめたものにすぎない、とも読める。その場合、規制は投資の根拠ではなく、説明の言葉として使う道具になる。

**H-7.2 (規制対応の lead time は年単位であり、制度改訂前に土台を敷く先行投資には実務上の根拠がある)**

- 暫定判定: **一部支持**。確度は**中**。
- 支持する点 (根拠 F-6.8〜6.11): 立法者が置いた猶予は、GDPR が 24 か月、AI Act の高リスクが当初 24 か月で、改正後は約 40 か月 (Annex III) と 48 か月 (Annex I)。GDPR では 24 か月の猶予があっても、期限直前に完全準拠を見込む企業は 36% にとどまった (n=1,500、自己申告)。欧州委員会は、標準の遅れを理由に高リスク適用を延期した (F-6.9)。
- 留保する点:
  - (a) GDPR の数値は自己申告の見込みで、売り手 (IBM) による調査。
  - (b) 「ギャップ分析→実装→監査」に実際に要した期間の実測は NOT FOUND。
  - (c) 期限そのものが動いた (オムニバス)。「制度に先回りして敷く」ことは、時期を外すリスクと表裏になる。ただし F-6.5 のとおり記録・監督の要件本体は変わっていない。日付ではなく、変わらない要件 (ログ、監督、リスク管理) に投資するなら、先行投資の根拠はむしろ強まる。
- 競合する解釈: 延期は「急がなくてよい」という信号として働く。延期が繰り返される前提に立てば、待ってから対応する方が合理的になる、とも読める。

## 3. 矛盾・注意点

- **「2026-08 高リスク適用」という前提は古い**。issue-tree と brief はこの日付を前提にしている。2026-07-27 発効の Regulation (EU) 2026/1744 で、Annex III の高リスクは 2027-12-02、Annex I の高リスクは 2028-08-02 に移った。2026-08-02 に始まったのは、透明性 (Art.50) と GPAI などの執行である。レポートではこの前提を必ず訂正すること。
- **provider と deployer の区別**: Art.9 と Art.12 は提供者がシステムに作り込む要件である。企業 IT 部門が主に負うのは、導入者として Art.26 の監督割当とログ 6 か月保管 (F-6.4)。ただし自社でエージェントを作って使えば、提供者にもなりうる。
- **「ログ」の意味の違い**: AI Act のログは、システムの事象記録 (自動生成ログ) を指す。熟議の「監査ログ」には、権限変更や承認の記録も含まれる。日本ガイドラインのログは、学習過程や判断根拠まで含む広い概念である。三者は同じ語で、範囲が違う。
- **日本は拘束力の弱い法 (soft law) で構成されている**: AI 推進法は推進法である。ガイドラインは自主的取組で、PPC の注意喚起は既存の個人情報保護法の解釈を示したもの。「制度改訂の日に段階を動かす」(D7) を日本で引き起こすのは、新法ではなくガイドラインの改版 (年 1 回程度: 2024-04、2024-11、2025-03、2026-03) である可能性が高い。
- **売り手のバイアス**: GDPR の準備調査は、IBM、Ponemon (McDermott 委託)、セキュリティ企業など、対応サービスの売り手によるものが多い。準備不足が大きめに出やすい。
- **ISO 42001 の二次情報は互いに食い違う**: 二次情報の間で管理策番号が A.6.2.8 と A.6.2.10 に割れている。本文 (有償) を確認するまで番号は引用しないこと。
- NIST AI RMF 1.0 は改訂中である (S-6.7)。2026 年後半に版が変わる可能性がある。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-6.1 | 一次 | AI Act Explorer — Article 9, 12, 14, 19, 26, 113 (EUR-Lex consolidated version as at 27 July 2026) | European Commission, DG CONNECT (AI Act Service Desk) | 統合版 2026-07-27 / アクセス 2026-11-04 | https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-12 (同様に article-9, -14, -19, -26, -113) | 各条の本文を取得し、引用文を確認した。Art.113 には AMENDED / NEW の印がある。Art.9・12・14・19・26 には印がない |
| S-6.2 | 一次 | Timeline for the Implementation of the EU AI Act | European Commission (AI Act Service Desk) | アクセス 2026-11-04 | https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act | 2024-08-01 発効から 2028-08-02 までのマイルストーンと、オムニバス反映の注記を確認した |
| S-6.3 | 一次 | Reglamento (UE) 2026/1744 de 8 de julio de 2026 (Ómnibus digital sobre IA), DO L 24.7.2026 | 欧州議会・理事会 (EU 官報、BOE ミラー) | 2026-07-24 | https://www.boe.es/doue/2026/1744/L00001-00041.pdf | 表題、日付、「2 de diciembre de 2027」「2 de agosto de 2028」、発効 (公布 3 日後) の条文を PDF で確認した。スペイン語版 |
| S-6.4 | 一次 | AI Act Service Desk FAQ — Digital Omnibus | European Commission | アクセス 2026-11-04 | https://ai-act-service-desk.ec.europa.eu/en/faq | 延期の理由「delay of standards and other support tools」を確認した (提案段階の書きぶりが残っている) |
| S-6.5 | 一次 | Legal framework of EU data protection | European Commission | アクセス 2026-11-04 | https://commission.europa.eu/law/law-topic/data-protection/legal-framework-eu-data-protection_en | 「entered into force on 24 May 2016 and applies since 25 May 2018」を確認した |
| S-6.6 | 一次 (企業の自社調査) | The end of the beginning: Unleashing the transformational power of GDPR | IBM Institute for Business Value | 2018-05 | https://www.ibm.com/downloads/cas/JEMXN6LV | PDF で n=1,500、15 業種、34 か国、2018 年 2–4 月、「only 36 percent … fully compliant by the enforcement date」を確認した |
| S-6.7 | 一次 | Artificial Intelligence Risk Management Framework (AI RMF 1.0), NIST AI 100-1 / AI RMF 公式ページ | NIST | 2023-01-26 (ページのアクセス 2026-11-04) | https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf ; https://www.nist.gov/itl/ai-risk-management-framework | PDF で 4 機能と GOVERN 1.6、2.1、MAP 3.5、MANAGE 4.1/4.3 の文言を確認した。公式ページで改訂中の記載を確認した |
| S-6.8 | 一次 | Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1) | NIST | 2024-07 | https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf | 12 リスクの一覧と、access control / logging の記述を PDF で確認した |
| S-6.9 | 一次 | 人工知能関連技術の研究開発及び活用の推進に関する法律 (令和七年法律第五十三号) | e-Gov 法令検索 (デジタル庁) | 公布 2025-06-04 | https://laws.e-gov.go.jp/law/507AC0000000053 (API: /api/2/law_data/507AC0000000053) | API の全文 JSON で、第1条・第3条・第7条・第13条・第16条と公布日を確認した |
| S-6.10 | 一次 | 人工知能関連技術の研究開発及び活用の推進に関する法律 (AI法) | 内閣府 | アクセス 2026-11-04 | https://www8.cao.go.jp/cstp/ai/ai_act/ai_act.html | 「令和7年6月4日に…公布・一部施行され、9月1日に…全面施行」を確認した。成立日の記載はない |
| S-6.11 | 二次 | ISO/IEC 42001 Annex A controls (A.6.2.8 AI system recording of event logs) の解説各種 | isms.online ほかコンサルティング各社 | アクセス 2026-11-04 | https://www.isms.online/iso-42001/annex-a-controls/a-6-ai-system-life-cycle/a-6-2-8-ai-system-recording-of-event-logs/ | 検索結果の要約のみで、ページ本文は取得していない。iso.org/standard/42001 は 403 |
| S-6.12 | 二次 | GDPR readiness 調査の報道 (McDermott/Ponemon, CompTIA 等) | Law.com Legaltech News, BetaNews ほか | 2018-04〜05 | https://law.com/legaltechnews/2018/05/21/most-u-s-and-eu-companies-not-ready-for-new-data-privacy-law-survey-says-397-8136 | 検索結果の要約のみ。一次報告は取得していない |
| S-6.13 | 一次 | 「AI事業者ガイドライン」掲載ページ | 総務省 | アクセス 2026-11-04 | https://www.soumu.go.jp/main_sosiki/kenkyu/ai_network/02ryutsu20_04000019.html | 第1.0版から第1.2版までの公表日と、チャットボット・手引きの公表日を確認した |
| S-6.14 | 一次 | AI事業者ガイドライン (第1.2版) 本編 | 総務省・経済産業省 | 2026-03-31 | https://www.soumu.go.jp/main_content/001064279.pdf | 表紙の日付、AI エージェントの定義、ログの記録・保存、人間の判断の介在、アクセス制御の記述を PDF で確認した |
| S-6.15 | 一次 | AI事業者ガイドラインの令和7年度更新内容 | 総務省・経済産業省 | 2026-03-31 | https://www.soumu.go.jp/main_content/001064301.pdf | 「人間の判断を介在させる仕組みの構築や最小権限設定」と、エージェントの「適切な権限設定が重要」を確認した |
| S-6.16 | 一次 | 生成AIサービスの利用に関する注意喚起等 (別添1) | 個人情報保護委員会 | 2023-06-02 | https://www.ppc.go.jp/files/pdf/230602_alert_generative_AI_service.pdf | 日付と、(1)①②・(2)① の文言を PDF で確認した |
