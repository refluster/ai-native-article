# WS7 ファクトパック — 取締役会の監督: マシンのスピードで動くものを人間の速度の会議で監督する (I-9)

- 座席: levi (先回りの助言: 規則が来る前に統治の窓を見つける)、petra (自動化と説明責任)、haruto (日本の大企業の意思決定手続)
- 対象仮説: H-9.1〜H-9.4 (issue-tree.md §I-9)。与件: brief.md「追加の与件」(operator 提供の経営者ポスト = S-10.1)
- アクセス日: 2026-11-05。検索 12 回 (英 5 / 日 7)。meti.go.jp は使わず、経産省の文書は IPA のページで代替した
- 第 1 報の行は S-0.<ws>.<k>、本報の既存の内部行 (S-4.29、S-4.30、S-9.x) はそのまま引用し、再登録していない (§4 末尾の参照一覧)

## 1. 所見 (findings)

### 1-A 米国: 開示の制度と取締役会の規範 (H-9.1, H-9.4)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-7.1 | H-9.1 | **SEC Release 33-11216 (2023-07-26 採択、2023-09-05 発効)**。Form 8-K Item 1.05 は、登録会社が重大 (material) と**判断した**サイバーインシデントについて、性質・範囲・時期と重大な影響を開示させる。期限は**重大性の判断から 4 営業日**。国家安全保障・公共安全に重大なリスクがある場合だけ限定的な遅延を認める。起点は「発生」ではなく「重大性の判断」(判断は「without unreasonable delay」で行う) である。速さを求めるのは**開示**であって、社内の取締役会への報告ではない | S-7.1 | A |
| F-7.2 | H-9.1 | **Regulation S-K Item 106(c) Governance (10-K で毎年)**。(1) 取締役会の監督を説明し、該当すれば担当する委員会を特定して「describe the processes by which the board or such committee is informed about such risks」。(2) 経営陣の役割として、責任者の職位と専門性、監視の手順、そして「Whether such persons or committees report information about such risks to the board」を説明する。**直通パスを設けることを義務づける規定ではなく、報告の経路があるかどうかを開示させる規定**である (「Whether」なので、「報告していない」と開示することもできる) | S-7.1 | A |
| F-7.3 | H-9.1 | **取締役会の専門性の開示 (提案 Item 407(j)) は採用されなかった**。SEC の理由は「directors with broad-based skills in risk management and strategy often effectively oversee management's efforts without specific subject matter expertise」。米国でも**取締役会に専門家を置く義務はない**。専門性は経営陣側 (Item 106(c)(2)(i)) で開示させる | S-7.1 | A |
| F-7.4 | H-9.1 | **2025–26 年の執行**: SEC は SolarWinds と同社 CISO に対する民事訴訟を**2025-11-20 に with prejudice で取り下げた** (共同の取下げ合意。双方とも違法行為を認めていない)。2024-07 の判決で内部統制の請求の大半は棄却済みだった。**2025–26 年に SEC がサイバー開示規則を改正したことは NOT FOUND** (専用の検索はしていない)。規則は残っているが、CISO 個人を訴追する執行は後退した | S-7.3 | B |
| F-7.5 | H-9.1, H-9.4 | **NACD/ISA『Director's Handbook on Cyber-Risk Oversight』第 5 版 (© 2026)**。依頼にあった 2023 年版はこの版に置き換わっている (CISA の序文に「Since the last version of this handbook in 2023」とある)。6 原則: ①Treat Cybersecurity as a Strategic Risk ②Monitor Legal and Disclosure Implications ③Establish Board Oversight Structures and Access to Expertise ④Adopt an Enterprise Framework for Managing Cyber Risk ⑤Guide Cybersecurity Risk Measurement and Reporting ⑥Encourage Systemic Resilience and Collaboration。原則 2 の実践項目は「Confirm that the board receives **direct, unfiltered reporting from the CISO** and general counsel on top cyber risks.」 | S-7.2 | A |
| F-7.6 | H-9.1 | 同書の原則 3 は、成功の指標として「A reporting line between the board and CISO or CISO equivalent is established and maintained」、ダッシュボードを常設の議題にして「at least quarterly」で報告すること、新任取締役のオンボーディングで CISO と面談することを挙げる。原則 2 の問いには「escalation processes in place, enabling us to meet the SEC's four-day rule」がある。いずれも**規範 (ベストプラクティス) であって法的義務ではない** | S-7.2 | A |
| F-7.7 | H-9.3, H-9.4 | **「報告されていないもの」を見る規範 — operator のポストのチェックポイントに当たる箇所**。Tool J (取締役会と CISO の関係づくり): 「If the cyber risk team feels pressure to deliver only good news, boards will be blind to systemic weaknesses.」「Questions should focus on **what is not being reported** and how near-misses are used to improve processes.」。原則 5 の問いには「How does management validate the completeness of incident reporting, including near-misses and unreported low-level events?」がある。調査値: 取締役会と CISO の関係の改善を「very/extremely important」とした取締役は**上場会社 37% (n=154)・非上場 40% (n=84)** (NACD 2025 Board Practices and Oversight Survey)。注意: ポストの「別の経営幹部による取捨選択」に当たる逐語は無い。最も近い文言は「direct, unfiltered」(F-7.5) である | S-7.2 | A |
| F-7.8 | H-9.4 | **同書はエージェントを独立した監督の枠として扱っていない**。agentic AI は用語集で「act with minimal human interaction」と定義される。取締役会への問いは「How are we managing AI "identity" (i.e., ensuring AI agents are only granted protected access to authorized data sources, and nothing else)?」。内部脅威の章では「as agentic AI systems are introduced … oversight of this risk area must evolve」とある。**エージェントは ID・アクセス・内部脅威の問題として位置づけられており、エージェントが出した成果を取締役会が監督するという枠組みは無い** | S-7.2 | A |
| F-7.9 | H-9.4 | **マシンのスピード (攻撃側の実測)**。Anthropic (2025-11-13) は、AI が組織した諜報活動 (GTG-1002) について次のように報告している。AI が「80-90% of the campaign」を実行し、人間の介入は「perhaps 4-6 critical decision points per hacking campaign」。要求数は「thousands of requests, often multiple per second」で、「an attack speed that would have been, for human hackers, simply impossible to match」。標的は約 30、侵入に成功したのは「a small number of cases」。**ベンダーの自己報告で、第三者による検証はない** | S-7.4 | A |
| F-7.10 | H-9.4 | **当局の言説**: Five Eyes (CISA・NSA・ASD/ACSC・CCCS・NCSC UK/NZ) の共同声明 (iTnews 2026-06-23 の報道) は、AI が「shrinking the window between vulnerability discovery and exploitation」「increases the speed and complexity of attacks」と述べ、対応の猶予は「年」ではなく「月」の単位だとしている。**声明の一次資料は NOT FOUND**。CISA・NIST が「machine speed」と逐語で述べた文書も **NOT FOUND**。一次で確認できた CISA の発言は、NACD 第 5 版の序文 (Nick Andersen 長官代行) の「Cybersecurity must be a standing item on the agenda every quarter」だけである (S-7.2) | S-7.5, S-7.2 | B / A |

### 1-B 日本: ガイドラインとコード (H-9.1)

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-7.11 | H-9.1 | **経産省・IPA「サイバーセキュリティ経営ガイドライン Ver3.0」(2023-03)**: 経営者が認識すべき「3 原則」と、経営者が **CISO 等に指示すべき**「重要 10 項目」で構成される。指示 2「サイバーセキュリティリスク管理体制の構築」、指示 7「インシデント発生時の緊急対応体制の整備」、指示 10「…情報の収集、共有及び開示の促進」など。CISO の定義は「経営陣の一員、もしくは経営トップからその役を任命された、セキュリティ対策を実施する上での責任者」。**宛先は経営者 (執行側) で、取締役会が監督するための直通パスや直接聴取の基準は、確認できた範囲には無い** (本文 PDF は meti.go.jp のため未取得) | S-7.6 | A (見出し・定義) / B (本文) |
| F-7.12 | H-9.1 | **CISO の設置率**: 日本 **39.4%**、米国 96.2%、豪州 96.0% (NRI セキュア、2022-07〜09、計 2,877 社、うち日本 1,800 社)。日本の従業員 1 万人以上の企業でも 65.3%。**2025–26 年の経産省・IPA の実態調査 (CISO 設置率、取締役会への報告頻度) は NOT FOUND**。取締役会への報告頻度は、どの調査でも日本の数値を確認できなかった | S-7.7 | A (2022 年の値) |
| F-7.13 | H-9.1 | **CG コード 2026 年改訂 (2026-07-21、金融庁・東証)**: 原則 4-4 の解釈指針にサイバーが入った。「サイバーセキュリティリスク、…サプライチェーン途絶リスク及び技術等の情報流出リスクへの対応等も、**収益機会にもつながり得るもの**として、リスク管理体制を整備する際の考慮事項に**含まれ得る**」。金融庁の概要は、これを「解釈指針に追記」した改訂として示している (2021 年版にサイバーの文言があったかは未照合)。ただし「含まれ得る」という弱い言い方で、コンプライ・オア・エクスプレインの対象は原則のほう (解釈指針は支援の位置づけ) | S-7.11, S-7.12 | A |
| F-7.14 | H-9.1 | **同コードの直通パスと専門性**: 原則 4-14 の解釈指針は「内部監査部門がこれら [取締役会・監査役会] に対しても適切に**直接報告**を行う仕組みを構築」すべきとする。**直通パスの規定があるのは内部監査部門で、CISO についての規定は無い**。スキル・マトリックスは原則 4-13 の解釈指針で「例えば…開示するなど」と例示されるにとどまり、サイバーの専門性を求めてはいない。brief の「4-11 スキルマトリックス」は 2021 年版の番号 (補充原則 4-11①) で、2026 年版は補充原則を廃止して解釈指針に移した (2021 年版の本文は未照合) | S-7.12, S-7.11 | A |
| F-7.15 | H-9.1 | **NACD ハンドブックの日本版**: 経団連と ISA の『サイバーリスクハンドブック 取締役向けハンドブック』(2019 年ごろ。本文の参照日は 2019-09) は、米国版の**5 原則**を「日本でも当てはまる」として採用している。原則 3 は「十分な専門知識を利用できるようにしておく」「定期的に取り挙げ、十分な時間をかけて議論」。**2026 年の 6 原則版 (「direct, unfiltered」「what is not being reported」を含む) の日本語版は NOT FOUND**。日本の取締役が日本語で参照できる規範は 2 世代前のままである | S-7.13 | A |

### 1-C 日本の 2025 年の大規模事件: 会社自身の開示 (H-9.2)

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-7.16 | H-9.2 | **アサヒグループ HD (2026-02-18「サイバー攻撃被害の再発防止策とガバナンス体制の強化について」)**: 2025-09-29 の午前 7 時ごろに障害が発生し、調査の中で暗号化されたファイルを確認した。侵入は「システム障害発生の約 10 日前」で、拠点のネットワーク機器を経由し、「パスワードの脆弱性をついて管理者権限を奪取」した。具体的な日時は「特定できない」。個人情報は 2025-11-26 時点で漏えいの可能性が合計約 191 万件、2026-02-18 時点で**漏えいを確認したのは 115,513 件** (従業員等 5,117、取引先等 110,396)。対策: サイバーを「経営上の最重要リスクの一つ」と位置づけ、「独立した組織および専任の担当役員の設置」「情報セキュリティ委員会を設置し…リスクを可視化」「取締役会スキルマトリックスの見直し」「取締役会と情報セキュリティ委員会、内部監査機能、外部専門家などとの連携」を行う。**取締役会や社長がいつ知ったか、エスカレーションの経路は記載が無い** | S-7.8 | A |
| F-7.17 | H-9.2 | **アスクル (2025-12-12「ランサムウェア攻撃の影響調査結果および安全性強化に向けた取り組みのご報告 (第 13 報)」、PR TIMES のミラーで確認)**: 2025-10-19 にランサムウェア攻撃によるシステム障害を確認した。攻撃者は「認証情報を窃取し不正に使用したと推定」され、「EDR 等の脆弱性対策ソフトを無効化」した。「セキュリティガバナンス体制の再構築」を当期 (2026 年 5 月期) 中に進める。**取締役会への報告やエスカレーションの記述は無い**。漏えいは約 74 万件、侵入口は業務委託先の認証情報とされるが、いずれも報道 (ITmedia) でしか確認できていない | S-7.9, S-7.10 | B (第 13 報) / C (74 万件・委託先) |
| F-7.18 | H-9.2 | **H-9.2 の検証結果**: 2 社の一次開示には、「取締役会に報告されていなかった」「エスカレーションがトップまで無かった」「事業レベルで完結した」という型の記述が**どれも無い**。第三者委員会の報告書は、2 社とも **NOT FOUND**。2026 年の他の事件は、検索予算の都合で **未調査**。読めるのは、事後の措置が「専任の役員」「委員会」「取締役会との連携」「スキル・マトリックスの見直し」という構造の追加だという点だけである。事前にこれらが無かったことは推測できるが、エスカレーションの失敗を示す証拠にはならない。**会社に責任があるとは推定しない** | S-7.8, S-7.9 | A (記述が無いことの確認) |

### 1-D エージェント組織 (本ワークフォース) の一次証拠: 何が報告され、何が報告されないか (H-9.3, H-9.4)

| F-ID | 仮説 | 所見 | S-ID | 確度 |
|---|---|---|---|---|
| F-7.19 | H-9.3 | **ML-038 (2026-09-09〜14)**: 予算上限による発火の拒否は「logged only to CloudWatch and an invocation-local `skipped[]`, never to the agent's execution ledger, so nothing on the console, the executions API or the Track Record said "capped"」。PR ルータ nadia は 2026-09-11T15:29Z から拒否され、未ルーティングの PR **9 本が 3 日間**滞留した。同じ時点で上限を超えて止まる設定だったのは **58 体中 8 体**。発見の経緯は、operator の報告 (「pr-autopilot never merged #729」) である。**機械は止まっていたが、その停止は人間の見る面のどこにも出なかった。統治文書にあった規範 (binding と予算を同じ書き込みで) には、強制する規則が無かった** | S-4.29 | A (内部) |
| F-7.20 | H-9.4 | **修正の向き**: 最初の修正で、黙った停止を報告される停止に変えた。月で最初の拒否を台帳に `status: skipped` として 1 行記録し、`cap_reached_at` に時刻を刻み、`/performance` に `over_budget_agents` を出し、R-19 の監査を追加した。2026-09-14 の ADR-0037 で operator は「enforcement itself was the fault」と判断し、エージェント別の予算を**助言値**に変えた (止めずに計測と報告を続ける)。強制は全体上限だけに残した。**「マシンを止める」から「マシンは走らせ続け、逸脱を必ず見える面に出す」への転換** | S-4.29, S-9.5 | A (内部) |
| F-7.21 | H-9.4 | **自分の境界を書き換えられない構造 (governance §4.4)**: autopilot が自律マージできる範囲は、L0/L1 のパス一覧の外側に限られる。その一覧は L0/L1 の文書 (`docs/governance.md`) の中にあるので、autopilot は自分の境界を編集できず、マージ範囲も広げられない。一覧を空にすると L0/L1 の範囲が不明になり、すべてのマージが fail closed で止まる (全体の停止スイッチを兼ねる)。**取締役会でいう「経営陣が監督の範囲を自分で変えられない」構造の機械版** | S-4.30 | A (内部) |
| F-7.22 | H-9.3, H-9.4 | **報告されるもの**: `autopilot:needs-human` へのすべての引き渡しには理由コードが必須で、理由なし・未知のコード・自由記述のない `other` は emit 側が拒否 (exit 1) する (v1 2026-07-08〜)。R-13 の日次スイープが、48h 動きのない PR (`stale-routed`)、7 日間ルーティングされない PR (`never-routed`)、36h 放置の作者レーン (`author-stale`) を人間に上げる。週次のファネルは手で数えずに描かれる | S-7.14, S-7.15 | A (内部) |
| F-7.23 | H-9.3 | **報告されないもの (2026-05-15〜11-02、`/performance`、2026-11-05 に 2 回取得し、値は同一)**: エスカレーション **145 件**のうち、理由が **`unspecified` 33 件 (23%)**、`other` 16 件、`l0l1-path` 46 件、`merge-engine-refusal` 16 件。`unspecified` は「labelled hand-off missing its reason」の受け皿で、コード化以前の PR だと推定されるが**未検証**。ほかの盲点が 3 つある。(a) 作者レーンへの引き渡しは「never counted as an escalation」(設計どおり)。(b) 理由コードは「inadmissible」で、レビュアーの評価には使えない (配線を測る目的に限っている)。(c) 2026-08-05 に定義が変わり、前後の系列は比較できない。**人間に上がる件数は数えられているが、人間に上がらずに機械の中で止まったものは数えられていない** | S-9.3, S-7.14 | A (内部) |
| F-7.24 | H-9.3 | **人の介入の数え方**: ペルソナの設定を書き換えたときの審査は、PR ごとではなく、`AUDIT#` の記録と**週次の設定 digest** による事後審査である (W-5、ADR-0007)。Epic-020 は「Today no surface counts human interventions at all」(起票時点) と書き、digest を 1 回の接点として数えると数百件の変更を 1 件と数えてしまう、と注意している。RAL-002: GA4 の洞察ループは認証情報が無いまま「fail-soft, not fail-loud, because it is advisory」の状態で動かずにいた (2026-06-22 に解消)。**助言のためのループは、止まっても黙ったまま止まる** | S-9.2, S-7.16, S-7.17 | A (内部) |
| F-7.25 | H-9.3 | **速度の非対称 (内部)**: 2026-11-01〜05 の発火は **758 回** (課金対象 66 体)。人間は 1 人 (operator)。ML-038 では、停止から発見まで最大 3 日かかった (人の報告による)。**同じ型 (機械の速度で動き、人の速度で気づく) が攻撃側 (F-7.9) にも自社のエージェントにもある**。ただし内部の事例は 1 件で、単一の operator 規模 (C-3) である | S-9.3, S-4.29 | A (内部) |
| F-7.26 | H-9.4 | **規制の対応物**: EU AI Act Art.26(2) は、高リスク AI の導入者に、監督を「necessary competence, training and authority」を持つ自然人へ割り当てることを求める (第 1 報で A)。これは「責任者の明確化」と「権限を持つ人が直接見る」ことの法文上の対応物である。ただし対象は高リスクの AI に限られ、取締役会への報告は求めていない | S-0.6.1 | A (第 1 報) |
| F-7.27 | H-9.1〜9.4 | **与件 (S-10.1)**: 米国の取締役会向け会合に参加した日本の経営者の所感である。論点は、(1) マシンのスピードの攻撃に対する取締役会の監督、(2) 長期の存続リスクを平時のマネジメントから分けて管理すること、(3) 専門家の警鐘が取捨選択されていないか、報告されていないことを知らないままになっていないか、(4) 通用しない弁明、(5) 信頼ベースの日本型ガバナンスへの疑問、(6) 「成長のために設計されたガバナンス」。**所感であり、事実の証拠としては使わない** (問いの出典に限る) | S-10.1 | 内部 |

## 2. 仮説ごとの暫定判定

- **H-9.1 (米国は制度化、日本は企業裁量)** — **一部支持・確度中**。根拠は F-7.1〜7.3、F-7.5〜7.6、F-7.11〜7.15。米国で制度化されているのは**開示** (4 営業日の 8-K、10-K の Item 106) である。直通パスと直接聴取は米国でも**規範 (NACD)** で、法的義務ではない (「Whether … report to the board」は開示事項。取締役会の専門性の開示は不採用)。日本は 2026-07 に CG コードの 4-4 の解釈指針へサイバーが入ったので、「GL と CG コードの原則にとどまる」は**古い**。それでも「含まれ得る」と弱く、直通パスの規定は内部監査部門にしか無い。差は「制度 vs 裁量」というより、**「開示が強制されているか」と「規範の世代 (日本語版は 2019 年の 5 原則)」**にある。競合する説明: 日本では適時開示規則 (東証) が一般条項で事件を拾っている可能性があるが、サイバーに特化した規定の有無は NOT FOUND (未調査)。
- **H-9.2 (日本の事件は「報告されない・事業レベルで完結」型を示す)** — **未検証・確度低**。根拠は F-7.16〜7.18。一次の開示には、エスカレーションの経路も、取締役会がいつ知ったかも書かれていない。仮説を支持する記述も否定する記述も一次には無い。第三者委員会の報告書は NOT FOUND。競合する説明: 適時開示は内部の報告経路を明かす目的の文書ではない。侵入から約 10 日間検知されなかった (アサヒ) のは技術的な検知の問題で、統治の問題とは別に説明できる。**報告書でこの仮説を事実として書いてはならない。**
- **H-9.3 (「取捨選択」の構造はエージェント組織で「自己採点」「サイレントな停止」として再現する)** — **一部支持・確度中**。根拠は F-7.19、F-7.22〜7.25 と、ws4 の F-4.26 (自己採点を最適化すると隠蔽を学ぶ、S-4.18)。「サイレントな停止」は内部の一次証拠で支持される (ML-038、`unspecified` 33)。一方で「**別の幹部が取捨選択する**」型は再現していない。内部の事例は、誰かが選んで捨てたのではなく、**報告の経路が最初から無かった** (CloudWatch にだけ出ていた)。人間の組織の故意やインセンティブの問題が、エージェント組織では**配線の欠落**の問題に置き換わる、と読むのが正確である。競合する説明: 事例は 1 件で、operator 1 人の規模。
- **H-9.4 (攻めの予算にも「報告されないものを見る」機構が要る。原理は「報告されないことが起きない構造」)** — **一部支持・確度中**。根拠は F-7.7 (NACD は「what is not being reported」、near-miss、報告の完全性の検証を求める)、F-7.20〜7.22 (内部: 黙った停止を台帳に出し、自分の境界を書き換えられない構造にし、理由コードを必須にした)、F-7.9〜7.10 (速度の差)。後半の「事後報告の速さではなく構造」は**設計仮説のまま**。外部の規範は速さ (SEC の 4 日) と完全性 (NACD) の**両方**を求めていて、どちらかを優先するという証拠は無い。さらに NACD 第 5 版も、エージェントを ID とアクセスの問題としてしか扱っていない (F-7.8)。**エージェントの成果を取締役会がどう監督するかの一次規範は NOT FOUND**。

## 3. 矛盾・注意点

- **版のずれ**: 依頼は NACD の 2023 年版だったが、現行は 2026 年の第 5 版である。「direct, unfiltered」と「what is not being reported」は第 5 版で確認した。2023 年版に同じ文言があるかは**未照合**。
- **規範と法の取り違え**: 「米国の取締役会は CISO から直接聞く」は NACD の規範で、SEC の義務ではない。SEC は「聞いているかどうか」を開示させるだけである。報告書では区別して書く。
- **日本の制度は動いている**: CG コードの 2026-07-21 改訂で、H-9.1 の前提の一部 (「原則にとどまる」) は古くなった。番号も変わっている (スキル・マトリックスは旧 4-11① から新 4-13 の解釈指針へ)。
- **事件の開示は統治の証拠にならない**: 会社の開示は復旧と再発防止のための文書である。ポストの「通用しない弁明」を日本の特定の会社に当てはめる一次の根拠は無い。責任の推定はしない。
- **ベンダーの利害**: GTG-1002 (F-7.9) は、AI ベンダー自身が自社モデルの悪用を報告したものである。80〜90% と 4〜6 回は自己申告で、第三者は検証していない。
- **内部の数字の罠**: `unspecified` 33 の時期の内訳は未検証で、コード化前の PR が多いと推定している。理由コードの系列は 2026-08-05 に定義が変わっている。作者レーンへの引き渡しは件数に入らない。「145 件中 23% が理由不明」を「いま 23% が黙って上がっている」と読んではならない。
- **規模の外挿**: 内部の証拠は、operator 1 人と 69 体の組織のものである。数十人の取締役会と数千体のエージェントの組み合わせへの外挿は検証されていない。
- **生存者バイアス**: 開示されるのは重大と判断された事件だけである。黙って止まって見つからなかった事例は、定義上どの資料にも出てこない (ML-038 も operator が気づいたから記録された)。

### 比較表: 米国の取締役会 vs 日本 vs エージェント組織

| 観点 | 米国の取締役会 | 日本 (上場大企業) | エージェント組織 (本ワークフォース) |
|---|---|---|---|
| **責任者の明確化** | 開示義務: 責任を持つ職位と専門性 (Item 106(c)(2)(i))。CISO の設置率 96.2% (2022) [F-7.2, F-7.12] | GL は経営者が CISO 等に指示する形。CISO の設置率 39.4% (1 万人以上で 65.3%)。アサヒは事後に「専任の担当役員」を置いた [F-7.11, F-7.12, F-7.16] | binding ごとに担当ペルソナがあり、人間は operator 1 人。ML-038 では「止まった」ことの責任者 (見る人) がいなかった [F-7.19, F-7.25] |
| **取締役会への直通パス** | 規範: CISO との報告ラインを「established and maintained」(NACD)。法は経路の有無を開示させるだけ [F-7.2, F-7.6] | CG コード 2026 の直通報告の規定は内部監査部門だけ。CISO の規定は無い [F-7.14] | `needs-human` ラベルと理由コードが必須、日次スイープ、週次 digest。L0/L1 は必ず人間へ [F-7.21, F-7.22] |
| **専門家を直接聴取する基準** | 取締役会の専門性の開示は不採用。「broad-based skills」で足りるとした。規範は「direct, unfiltered」 [F-7.3, F-7.5] | スキル・マトリックスは例示にとどまり、サイバーの専門性は求めていない。経団連版は「専門知識を利用できる」(2019 年) [F-7.14, F-7.15] | 聴取の基準は「どの述語が発火したか」(R-N10、理由コード)。人間が見るかどうかは機械が判定する [F-7.21, F-7.22] |
| **報告されないものを見る機構** | NACD: 「what is not being reported」、near-miss、報告の完全性を検証する問い (規範) [F-7.7] | 一次の規範に該当する文言は NOT FOUND。日本語版は 2 世代前 [F-7.15] | 黙った停止を台帳と `/performance` に出す (ML-038 の後)。ただし `unspecified` 33、作者レーンは件数外、助言のためのループは黙って止まる [F-7.20, F-7.23, F-7.24] |
| **平時からの分離管理** | 常設の議題として四半期ごとのダッシュボード。4 日ルールに向けたエスカレーション手順 (規範) [F-7.6] | CG コード 2026: 「収益機会にもつながり得る」リスクとして整備に「含まれ得る」。アサヒは事後に「経営上の最重要リスク」と位置づけ、委員会を置いた [F-7.13, F-7.16] | 全体上限 (W-3) だけは強制で、エージェント別の予算は助言値 (平時の流れを止めない)。統治の境界は L0/L1 として、日常の自律マージから構造的に分けている [F-7.20, F-7.21] |

## 4. 情報源台帳

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-7.1 | 一次 | Cybersecurity Risk Management, Strategy, Governance, and Incident Disclosure (Release No. 33-11216) | U.S. SEC | 2023-07-26 (発効 2023-09-05) | https://www.sec.gov/files/rules/final/2023/33-11216.pdf | PDF をテキスト化した。Item 1.05、Item 106(c) の規則本文、407(j) を採用しなかった理由の段落、発効日を逐語で確認 |
| S-7.2 | 一次 | Director's Handbook on Cyber-Risk Oversight (Fifth Edition) | NACD / Internet Security Alliance | © 2026 (2026-04 の公表と報道) | https://www.nacdonline.org/globalassets/public-pdfs/2026_directors-handbook-cyber-risk_print.pdf | PDF (26 ページ) をテキスト化した。6 原則の題、原則 2・3・5 の項目、Tool J、AI の用語集と問い、CISA の序文、調査値 37/40% を確認。2023 年版は未取得 |
| S-7.3 | 二次 | SEC and SolarWinds Litigation Dismissed Following Joint Stipulation | Winston & Strawn | 2025-11 | https://www.winston.com/en/blogs-and-podcasts/capital-markets-and-securities-law-watch/sec-and-solarwinds-litigation-dismissed-following-joint-stipulation | 検索の要約で、2025-11-20、with prejudice、違法行為の不認定を確認。裁判所の記録 (一次) は未取得 |
| S-7.4 | 一次 (ベンダ) | Disrupting the first reported AI-orchestrated cyber espionage campaign | Anthropic | 2025-11-13 | https://www.anthropic.com/news/disrupting-AI-espionage | ページで 80-90%、4-6、thousands of requests、約 30、small number を確認 |
| S-7.5 | 二次 | "Must act now" to counter AI-borne cyber attacks, 'Five Eyes' says | iTnews (Juha Saarinen) | 2026-06-23 | https://www.itnews.com.au/news/must-act-now-to-counter-ai-borne-cyber-attacks-five-eyes-says-626815 | 記事で発出機関と 2 つの引用を確認。声明の一次資料へのリンクは記事に無く、検索でも NOT FOUND |
| S-7.6 | 一次 | サイバーセキュリティ経営ガイドライン — 実践のプラクティス・ナビ (はじめに) | IPA | 2026-04-28 公開 | https://www.ipa.go.jp/security/economics/practices_navi/intro.html | 重要 10 項目の見出しと CISO の定義を確認。GL Ver3.0 の本文 (経産省) は未取得 |
| S-7.7 | 準一次 | 情報セキュリティ実態調査 2022 (ニュースリリース) | NRI セキュアテクノロジーズ / 野村総合研究所 | 2022-12-13 | https://www.nri.com/jp/news/newsrelease/20221213_2.html | 39.4 / 96.2 / 96.0%、65.3%、2,877 社、調査期間を確認。取締役会への報告の値は無い |
| S-7.8 | 一次 | サイバー攻撃被害の再発防止策とガバナンス体制の強化について | アサヒグループホールディングス | 2026-02-18 | https://www.asahigroup-holdings.com/en/newsroom/detail/20260218-0101.html | 本文 (日本語) で、約 10 日前、管理者権限、ガバナンスの 4 施策、漏えい件数を確認。取締役会への報告時期の記載は無い |
| S-7.9 | 準一次 | ランサムウェア攻撃の影響調査結果および安全性強化に向けた取り組みのご報告 (第 13 報) | アスクル (PR TIMES 配信、ネットショップ担当者フォーラムに転載) | 2025-12-12 | https://netshop.impress.co.jp/r/prtimes/items/000000500.000021550 | ミラーで 10-19、認証情報の推定、EDR の無効化、ガバナンス体制の再構築を確認。件数は画像のため読めず。原本は https://prtimes.jp/main/html/rd/p/000000500.000021550.html |
| S-7.10 | 二次 | アスクル、個人情報 74 万件漏えい 攻撃手法や初動対応を時系列順にまとめたレポートも公開 | ITmedia NEWS | 2025-12-12 | https://www.itmedia.co.jp/news/article/2512/12/1251212106/ | 検索結果の要約だけ (74 万件、委託先の認証情報)。記事は未取得 |
| S-7.11 | 一次 | コーポレートガバナンス・コードの改訂 (2026 年) の概要 | 金融庁 | 2026-07-21 | https://www.fsa.go.jp/news/r7/singi/20260721/04.pdf | 1 ページの PDF をテキスト化し、サイバーの「解釈指針に追記」と、補充原則から解釈指針への再編を確認 |
| S-7.12 | 一次 | コーポレートガバナンス・コード (2026 年 7 月 21 日) | 東京証券取引所 | 2026-07-21 | https://www.jpx.co.jp/equities/listing/cg/tvdivq0000008jdy-att/nlsgeu000005lnul.pdf | PDF をテキスト化し、原則 4-4 の解釈指針 (サイバー)、4-13 (スキル・マトリックス)、4-14 (内部監査の直接報告) を逐語で確認。旧版と同じ URL に 2026 年版が置かれていた |
| S-7.13 | 一次 | サイバーリスクハンドブック 取締役向けハンドブック (日本版) | 日本経済団体連合会 / Internet Security Alliance | 2019 (本文の参照日 2019-09 から推定) | https://www.keidanren.or.jp/policy/cybersecurity/CyberRiskHandbook.pdf | PDF をテキスト化し、5 原則の採用文を逐語で確認。発行日は奥付から取れず推定 |
| S-7.14 | 内部 | PR escalation-reason taxonomy v3.2 | 本ワークフォース workforce/docs/pr-escalation-reasons.md | 2026-10-26 | workforce/docs/pr-escalation-reasons.md | 理由コードの必須化 (emit で exit 1)、`unspecified` の受け皿、作者レーンは件数外、「inadmissible」、2026-08-05 の系列の境界を確認 |
| S-7.15 | 内部 | Governance mechanisms (R-13 terminal-state sweep) | 本リポジトリ docs/governance-mechanisms.md | 2026-11-05 時点 | docs/governance-mechanisms.md | 日次スイープの対象 (stale / never-routed / 未ラベルの引き渡し) を確認。同文書は content-insights を「inert」と書いたままで、RAL-002 の解消を反映していない |
| S-7.16 | 内部 | Epic-020 human leverage metric | 本ワークフォース workforce/docs/epics/epic-020-human-leverage-metric.md | 2026-11-05 時点 | workforce/docs/epics/epic-020-human-leverage-metric.md | 「Today no surface counts human interventions at all」(起票時点) と、digest を 1 接点と数える罠を確認 |
| S-7.17 | 内部 | Risk-acceptance ledger RAL-002 | 本リポジトリ docs/risk-acceptance-ledger.md | 2026-06-22 解消 | docs/risk-acceptance-ledger.md | 「fail-soft, not fail-loud, because it is advisory」と解消日を確認 |
| S-10.1 | 内部 | operator が共有した経営者のポスト (米国の取締役会向け会合の所感) | 匿名 (operator 提供) | 2026-11-05 共有 | (URL なし) | マシンのスピードの攻撃に取締役会はどう監督するか、平時との分離、報告されないもの、責任者・直通パス・直接聴取の基準、「成長のために設計されたガバナンス」を問う所感。brief.md「追加の与件」に要旨 |

**既存の台帳行 (再登録しない、参照のみ)**: S-0.6.1 (第 1 報 S-6.1、EU AI Act Art.26)、S-4.18 (ws4、CoT 監視、F-4.26 経由)、S-4.29 (ML-038)、S-4.30 (governance §4.4)、S-9.2 (workforce governance W-5 / 週次 digest)、S-9.3 (`/performance`。2026-11-05T21:45Z に再取得し、pr_summary の値は ws3 と同一: 145 / 33 / 46 / 136)、S-9.5 (ADR-0037)。
