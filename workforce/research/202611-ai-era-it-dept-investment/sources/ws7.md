# WS7 現場の言葉・行動科学 — fact pack (S3)

- 担当: clara (行動科学: 自動化への信頼・アルゴリズム回避・期待違反) × yuki (GTM: 顧客の最初の一文が与件。H-3.3「一つのチームを、そのチームの言葉で」の提案者本人なので、yuki は判定者ではなく被検証者として扱い、判定は clara が持つ)
- 対象仮説: **H-4.3** (承認段階の過多 → 空回り・承認疲れ)、**H-3.3 の現場側** (一チーム一作業から始める vs 全社一斉導入)
- 検索予算 8 件 / 使用 8 件。その他は一次資料の URL 直取得 (DORA 2019 PDF、Europe PMC REST API による抄録取得、arXiv、各社公式ページ)。アクセス日 2026-11-04。
- **転用限界の先出し (clara)**: H-4.3 の証拠の大半は臨床 (薬剤アラート、モニタアラーム)、セキュリティ SOC、ソフトウェア変更管理 (CAB) 由来であり、「AIエージェントの提案を人間が承認する」場面そのものを測ったものは、ベンダ自社内データ (Anthropic) 2 件のみ。これらは「同型の機構が働く」ことの傍証であって、エージェント承認での効果量の推定値ではない。

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 (A/B/C) |
|---|---|---|---|---|
| F-7.1 | H-4.3 | DORA 2019: CAB や上級管理者など**外部機関の承認を要する重い変更管理**のある組織の回答者は、低パフォーマーである可能性が **2.6 倍**。原文 "Survey respondents were 2.6 times more likely to be low performers if their organization had this kind of formal approval process in place." 対象: 世界のソフトウェア専門職の自己申告調査、回答者「ほぼ1,000人」(誤差 3%)、2019年。因果ではなく相関。AI エージェント承認ではない。 | S-7.1 | A |
| F-7.2 | H-4.3 | 同報告: 重い承認が変更失敗率 (安定性) を下げるという仮説を検証し **"we found no evidence to support this hypothesis"**。さらに「承認を増やすと遅くなり大きなバッチを低頻度で出す→本番影響とリスクが増す」仮説は "supported in the data"。結論 "this approach will make things worse." | S-7.1 | A |
| F-7.3 | H-4.3 | 同報告: 承認そのものの否定ではない。**明確に理解された変更プロセス**を持つ回答者は elite performer である可能性が **1.8 倍**。推奨は「外部承認から開発中のピアレビュー承認へ shift left + 自動しきい値 (例: コスト上限を超える変更は peer review 済みでも push 不可)」。職務分離は承認イベントのログで満たせる、とする。→ 段階の「数」ではなく「誰が・どこで・どれだけ明確に」が効いている、という読みが原文に近い。 | S-7.1 | A |
| F-7.4 | H-4.3 | 同報告: 大企業 (従業員 5,000 人以上) が低パフォーマーに偏る理由として "heavyweight process and controls as well as tightly coupled architectures" を挙げる (著者の解釈であり検定値ではない)。 | S-7.1 | A |
| F-7.5 | H-4.3 | Accelerate (Forsgren, Humble, Kim 2018) 書籍本文の該当記述は**本調査では未確認 (NOT FOUND on page)**。DORA 2019 は先行研究として 2014 State of DevOps (Velasquez et al.) を引用し「重い変更承認は変更失敗率と負の相関 (=改善しない)」と述べるのみ。 | S-7.1 | C |
| F-7.6 | H-4.3 | 薬剤安全アラートの override 率: 系統的レビュー (17論文採択、うち override 率データのある 8 研究) で **49%〜96%**。本文: "The most important reason for overriding was alert fatigue caused by poor signal-to-noise ratio." ただし著者は "Alert overriding may often be justified" とも書く (override = 誤りではない)。対象: CPOE を使う臨床医、2006年以前の研究。 | S-7.2 | A |
| F-7.7 | H-4.3 | **用量反応の証拠**: 米国プライマリケア臨床医 112 人、EHR データ 2010年1月〜2013年6月の後ろ向きコホート。1受診あたりリマインダーが**1件増えるごとに受容確率が 30% 低下**、同一患者の重複リマインダー比率が 5 ポイント増えるごとに **10% 低下**。薬剤アラートの約 1/4、リマインダーの約 1/3 が同一患者・同年の重複。一方、**仕事量そのもの (受診数) とは無関係**、新規アラートで時間経過による脱感作も見られず。→「確認回数・重複」が効き、「忙しさ」ではない。 | S-7.3 | A |
| F-7.8 | H-4.3 | モニタアラーム疲労の統合レビュー (2000年1月〜2011年10月の 72 論文)。抄録: 脱感作は "high false alarm rate, poor positive predictive value, lack of alarm standardization, and the number of alarming medical devices" に関連。よく引用される「誤報・臨床的に無意味なアラーム 80〜99%」は抄録には無く、本文の数値は本調査で未確認。 | S-7.4 | A (抄録) / C (80–99%) |
| F-7.9 | H-4.3 | **AI エージェント固有の証拠 (ベンダ自社内)**: Anthropic (2026-03-25) — Claude Code の手動許可プロンプトについて "in practice users accept 93% of them anyway"、"Over time that leads to approval fatigue, where people stop paying close attention to what they're approving." 母集団・期間・n は記事に記載なし。独立検証なし。 | S-7.5 | A (記述の存在) / 値はベンダ自己申告 |
| F-7.10 | H-4.3 | Anthropic (2025-10-20): "Constantly clicking 'approve' slows down development cycles and can lead to 'approval fatigue'"; サンドボックス化で "In our internal usage ... reduces permission prompts by 84%"。社内利用のみ、独立再現なし。承認の**数を減らす手段**が「境界 (サンドボックス) を先に敷く」ことである点は D3 と同型。 | S-7.6 | A (記述の存在) / 値はベンダ自己申告 |
| F-7.11 | H-4.3 | SOC アラート疲労: Vectra AI 調査として「1日 3,832 件のアラート、うち 62% が無視」(2024年) が流通。一次レポートは取得できず (403/404)、年次・割合も報道間で 62%/63%/67% と揺れる。ベンダ調査で「無視 ≠ 見逃した実攻撃」。 | S-7.7 | C |
| F-7.12 | H-4.3 | 自動化バイアス系統的レビュー (13,821 件中 74 件採択、医療中心)。自動化バイアスの媒介要因に **workload, task complexity, time constraint**、緩和要因に訓練・**利用者の説明責任の強調**・助言の画面位置・確信度表示・「推奨ではなく情報の提示」。→ 承認を形骸化させるのは段階数だけでなく、時間圧と責任の所在。 | S-7.8 | A |
| F-7.13 | H-4.3 | Parasuraman & Riley (1997) の位置づけ (2008年の Human Factors 回顧論文による): 過剰依存 (misuse) と過少依存 (disuse) の双方を問題化し、"automation requires more, not less, attention to training, interface design, and interaction design." 1997 年原論文の抄録は本調査では取得できず。 | S-7.9 | B |
| F-7.14 | H-4.3 | Lee & See (2004) 抄録: "Automation is often problematic because people fail to rely upon it appropriately." 目標は「信頼を最大化」ではなく**適切な依存 (calibrated reliance)**。概念モデル (定量値なし)。 | S-7.10 | A |
| F-7.15 | H-4.3 | Dietvorst et al. (2015) アルゴリズム回避: 5 実験。アルゴリズムが**人より優れているのを見た後でも**、誤りを一度見ると人間予測者より速く信頼を失い、劣る人間を選ぶ。→ 期待違反は「承認を増やす」圧力として働きうる (逆方向の力)。実験室の予測課題で、業務エージェントではない。 | S-7.11 | A |
| F-7.16 | H-4.3 | Vaccaro, Almaatouq, Malone (Nature Human Behaviour 2024): 100超の実験・300超の効果量のメタ分析。"on average, human-AI combinations performed significantly worse than the best of humans or AI alone"; **意思決定タスクで損失、創作タスクで利得**; 人が AI より上なら組合せで利得、AI が人より上なら損失。→「人間が最終承認すれば良くなる」は一般には成り立たない。ただし段階数の研究ではない。抄録は arXiv 版で確認 (Nature 本体はアクセス不可)。 | S-7.12 | A |
| F-7.17 | H-4.3 | Green (2022, Computer Law & Security Review 45): 人間による監督を定める **41 の政策**を調査。欠陥①「人々は期待される監督機能を果たせない」証拠、欠陥② その結果、欠陥あるアルゴリズムの利用を**正当化**してしまう。代替案は個別の人間承認ではなく制度的監督 (採用前の正当化と審査)。政府アルゴリズム対象。 | S-7.13 | A |
| F-7.18 | H-3.3 | 現場発の需要の存在: Microsoft/LinkedIn 2024 Work Trend Index — "Seventy-five percent of knowledge workers now use AI at work"、AI 利用者の **78% が自前のツールを持ち込む (BYOAI)**、AI 利用者のうち会社から研修を受けたのは 39%、リーダーの 60% が「自社に実装のビジョンと計画がない」。31 か国 31,000 人、2024-05-08 公表 (実査日の記載なし)。ベンダ調査。 | S-7.14 | A |
| F-7.19 | H-3.3 | 同: パワーユーザーは CEO から生成AIについて聞いている可能性が **61% 高く**、役割別研修を受けている可能性が **35% 高い** → 「下から」の利用者も上からの後押しと相関。純粋なボトムアップ優位の証拠ではない。 | S-7.14 | A |
| F-7.20 | H-3.3 | BCG AI at Work 2025 (2025-06-26、11 か国・地域、10,600 人超): 現場 (frontline) の定常利用は **51% で頭打ち**、管理職・リーダーは 4 分の 3 超。**強いリーダー支援で前向きな従業員比率が 15% → 55%**、その支援を受けている現場は約 4 分の 1。必要なツールがないと「半数超が代替を見つけて使う」。 | S-7.15 | A |
| F-7.21 | H-3.3 | BCG AI at Work 2026 (2026-06-03、約 12,000 人): 現場の定常利用は **74%** (2025年と同一設問かは要確認)。提言 "Invest in redesigning work end-to-end, not in more tools."; ワークフローを作り直す組織 42% (2025年 22%)。リーダーの AI 発信が明確と答える現場は 3 分の 1、言行一致を強く感じるのは 28%。 | S-7.16 | A |
| F-7.22 | H-3.3 | Gallup (米国、Gallup Panel 確率標本、2023→2025): 職場で AI を年数回以上使う比率 21% → 40%、週数回以上 11% → 19%。週数回以上はリーダー 33% vs 個人貢献者 16%。**組織が明確な AI 計画を伝えたと答えるのは 22%**、強く同意する人は「準備ができている」と感じる可能性が 3 倍、「自分の役割で使うのに抵抗がない」が 2.6 倍。米国のみ。 | S-7.17 | A |
| F-7.23 | H-3.3 | **「一チーム一作業」導入と「全社一斉」導入の成功率を直接比べた研究: NOT FOUND。** 「チーム自身の語彙でタスクを書くと採用・定着が上がる」ことを測った研究: NOT FOUND。 | — | — |
| F-7.24 | H-4.3 | **承認段階の数と no-op 比率 (空回り) の関係を AI エージェントで測った研究: NOT FOUND。** 最適な段階数 (U10) の実証値: NOT FOUND。 | — | — |

## 2. 仮説ごとの暫定判定

### H-4.3 承認段階を増やしすぎると空回り・承認疲れで成果が落ちる
- **暫定判定: 一部支持 / 確度: 中**
- 根拠: F-7.1, F-7.2 (DORA: 重い外部承認は速度・安定性とも改善せず悪化と相関)、F-7.6, F-7.7 (臨床: アラートが増える・重複するほど受容が下がる用量反応)、F-7.9, F-7.10 (AI エージェント: 93% が結局承認、プロンプト削減手段としてのサンドボックス)、F-7.16, F-7.17 (人間の最終確認は自動的には品質を上げない)。異なる領域の一次・準一次資料が同じ向きを示す点は強い。
- 「一部」にとどまる理由:
  1. どの証拠も「段階数」を独立変数にしていない。DORA は承認の**種類** (外部機関 vs ピア + 自動化)、Ancker は**回数と重複**、Anthropic は**プロンプト頻度**を見ている。熟議の「段階を細かくすると no-op が増える」(反証条件) を直接測ったものは無い (F-7.24)。
  2. DORA は自己申告の横断調査で相関。逆因果 (低パフォーマーだから CAB を置く) を排除できない。
  3. 転用限界: 臨床・SOC のアラートは「止めるか通すか」の割り込みで、エージェントの提案承認とは誤報率・帰結が違う。AI 固有の 2 件はベンダ社内データ。
- 競合する説明 (clara):
  - **段階数ではなく信号対雑音比**。van der Sijs は override の主因を "poor signal-to-noise ratio" とし、Ancker も重複が効くと示す。承認が多くても一件ごとの情報価値が高ければ疲労は起きにくい可能性。
  - **段階数ではなく明確さ**。DORA で「明確な変更プロセス」は正の効果 (1.8 倍、F-7.3)。段階が多くても手順が明確なら悪化しない可能性。
  - **逆方向の力**: 期待違反とアルゴリズム回避 (F-7.15) は、エージェントが一度失敗すると組織が承認を**追加する**方向に動くことを予測する。DORA の "Organizations often respond to problems ... by introducing additional process" と同じ循環。承認疲れと過剰承認の追加は自己強化ループになりうる。
  - **減らしすぎのリスク**: 自動化バイアス (F-7.12, F-7.14) は、確認を減らすと過剰依存が増えることを示す。目標は「最少」ではなく「較正された依存」。
- 実務への含意 (判定ではなく読み): DORA と Anthropic の処方は同型で、「人の承認を増やす」より「境界 (自動しきい値・サンドボックス・ログ) を先に敷き、人の承認は少数の高リスク判断 (Zone-A・お金・マージ) に寄せる」。これは熟議 D3 と整合する。

### H-3.3 (現場側) 一チームの自分の作業から始める方が全社一斉導入より成功する
- **暫定判定: 未検証 (方向は一部支持) / 確度: 低**
- 根拠: F-7.18 (BYOAI 78%: 現場がすでに自前で使っている=「迂回コスト」の需要は実在)、F-7.20, F-7.21 (ツール配布より業務の作り直し。ツールが無ければ半数超が代替を使う)。
- 未検証とする理由: 導入順序を比べた研究は見つからず (F-7.23)。yuki の「そのチームの言葉で」の部分も、語彙の効果を測った証拠は無い。
- 競合する説明 / 反対方向の証拠:
  - **上からの支援がむしろ強い予測因子**。BCG はリーダー支援で前向き比率が 15% → 55% (F-7.20)、Gallup は明確な計画の伝達で準備度 3 倍 (F-7.22)、WTI のパワーユーザーは CEO 発信と相関 (F-7.19)。「全社基盤から売らない」と「経営の明確な後押しが要る」は両立しうるが、「下からだけで足りる」は支持されない。
  - 利用率はリーダー > 現場 (Gallup 33% vs 16%、BCG 4分の3超 vs 51%)。「最初の一チーム」が現場の場合、そもそも利用が浅い層から始めることになる。
- clara の注: 期待違反の観点からは「小さく始める」ことに理論上の利点がある (失敗の可視範囲が狭く、アルゴリズム回避の連鎖が全社に広がらない)。ただしこれは推論で、本調査では証拠を見つけていない。

## 3. 矛盾・注意点

- **DORA の「承認」は CAB = 外部機関**。ピアレビューは推奨側。「人間承認を減らせ」と読むのは誤読。DORA 自身が職務分離 (承認者 ≠ 作成者) は維持し、ログで監査可能にせよと言う。
- **override は誤りではない**。van der Sijs は override の多くが正当でありうると明記。「96% override = 96% 見落とし」ではない。同様に SOC の「無視」も見逃した攻撃を意味しない。
- **Anthropic の 93% / 84% は自社製品の宣伝文脈**。承認疲れを課題にすると自社の自動化機能 (サンドボックス、auto mode) の正当化になる利害がある。数値の母集団・期間は非公開。
- **SOC 調査はセキュリティベンダの自社調査** (Vectra)。アラート疲労を大きく見せる利害がある。割合と年次が報道間で揺れており (62/63/67%)、一次未確認のため C。
- **Vaccaro et al. は「人間+AI が平均で最良単体に劣る」**であって「人間の承認を外せ」ではない。AI が人より劣るタスクでは組合せが利得になる。どちらが上かはタスクごとに違う。
- **BCG 2025 → 2026 の現場利用 51% → 74%** は年次も標本も違う。同一設問の時系列と断定しない。
- **WTI の 75% は「AI を職場で使う」知識労働者**で、生成 AI に限定した言い回しではない。BYOAI の 78% の分母は AI 利用者。
- **Accelerate (2018) の数値は本調査では未確認**。DORA 2019 経由の記述に限定した。
- 転用限界 (再掲): H-4.3 の外部証拠は臨床・SOC・ソフトウェア変更管理。AI エージェント承認での効果量は推定できない。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 (一次/準一次/二次/内部) | 題名 | 発行者 | 日付 | URL | 検証メモ (何を実際にページで確認したか) |
|---|---|---|---|---|---|---|
| S-7.1 | 一次 | Accelerate: State of DevOps 2019 | DORA / Google Cloud | 2019 | https://services.google.com/fh/files/misc/state-of-devops-2019.pdf | PDF を取得して全文テキスト化。Change Management 節 (pp.48–51) で 2.6 倍、変更失敗率で "no evidence"、明確なプロセスで 1.8 倍、shift-left の推奨を逐語確認。回答者ほぼ1,000人を確認。2014年報告の引用を確認。 |
| S-7.2 | 準一次 | Overriding of Drug Safety Alerts in Computerized Physician Order Entry (van der Sijs, Aarts, Vulto, Berg), JAMIA 13(2):138–147 | JAMIA / PMC | 2006 | https://pmc.ncbi.nlm.nih.gov/articles/PMC1447540 | PMC 全文で抄録 (17論文、49%–96%)、本文の "alert fatigue caused by poor signal-to-noise ratio"、Discussion の「8研究で 49–96%」を確認。 |
| S-7.3 | 準一次 | Effects of workload, work complexity, and repeated alerts on alert fatigue in a clinical decision support system (Ancker et al.), BMC Med Inform Decis Mak, doi:10.1186/s12911-017-0430-8 | BMC / Europe PMC (PMID 28395667) | 2017-04 | https://europepmc.org/article/MED/28395667 | Europe PMC REST API で抄録全文を取得。n=112、2010-01〜2013-06、30%/10% 低下、仕事量と無関係、脱感作なしを確認。 |
| S-7.4 | 準一次 | Monitor alarm fatigue: an integrative review (Cvach), Biomed Instrum Technol 46(4):268–277, doi:10.2345/0899-8205-46.4.268 | AAMI / Europe PMC (PMID 22839984) | 2012-07 | https://europepmc.org/article/MED/22839984 | Europe PMC で抄録取得。72 論文・期間・5 テーマ・脱感作の要因を確認。80–99% は抄録に無く未確認。 |
| S-7.5 | 一次 (ベンダ) | Claude Code auto mode (engineering blog) | Anthropic | 2026-03-25 | https://www.anthropic.com/engineering/claude-code-auto-mode | ページで "users accept 93% of them anyway" と approval fatigue の文を確認。母集団・n の記載なし。 |
| S-7.6 | 一次 (ベンダ) | Beyond permission prompts: making Claude Code more secure and autonomous (sandboxing) | Anthropic | 2025-10-20 | https://www.anthropic.com/engineering/claude-code-sandboxing | ページで approval fatigue の文と "reduces permission prompts by 84%" (社内利用) を確認。 |
| S-7.7 | 二次 | MSSP market news: survey shows 62% of SOC alerts are ignored (Vectra AI 調査の報道) | MSSP Alert | 2024 | https://www.msspalert.com/news/mssp-market-news-survey-shows-62-of-soc-alerts-are-ignored | 検索結果の要約のみ。ページ取得は 403、Vectra の一次ページは 404。数値は未確認 (C)。 |
| S-7.8 | 準一次 | Automation bias: a systematic review of frequency, effect mediators, and mitigators (Goddard, Roudsari, Wyatt), JAMIA, doi:10.1136/amiajnl-2011-000089 | JAMIA / Europe PMC (PMID 21685142) | 2012-01 | https://europepmc.org/article/MED/21685142 | Europe PMC で抄録取得。13,821 件中 74 件、媒介要因 (workload, complexity, time constraint)、緩和要因 (accountability 等) を確認。 |
| S-7.9 | 準一次 | Review of a pivotal Human Factors article: "Humans and automation: use, misuse, disuse, abuse", Human Factors, doi:10.1518/001872008x288547 | HFES / Europe PMC (PMID 18689046) | 2008-06 | https://europepmc.org/article/MED/18689046 | Parasuraman & Riley (1997) の回顧論文の抄録を確認 ("more, not less, attention")。1997 年原論文 (doi:10.1518/001872097778543886) は Europe PMC で 0 件、未確認。 |
| S-7.10 | 準一次 | Trust in automation: designing for appropriate reliance (Lee & See), Human Factors 46(1):50–80, doi:10.1518/hfes.46.1.50_30392 | HFES / Europe PMC (PMID 15151155) | 2004 | https://europepmc.org/article/MED/15151155 | Europe PMC で抄録全文を確認。定量値なしの概念モデル。 |
| S-7.11 | 準一次 | Algorithm aversion: people erroneously avoid algorithms after seeing them err (Dietvorst, Simmons, Massey), J Exp Psychol Gen, doi:10.1037/xge0000033 | APA / Europe PMC (PMID 25401381) | 2015-02 | https://europepmc.org/article/MED/25401381 | Europe PMC で抄録確認 (5 実験、優れたアルゴリズムでも誤り後に回避)。 |
| S-7.12 | 準一次 | When combinations of humans and AI are useful: a systematic review and meta-analysis (Vaccaro, Almaatouq, Malone), Nat Hum Behav, doi:10.1038/s41562-024-02024-1 | Nature Human Behaviour / arXiv 2405.06087 | 2024 (オンライン 2024-10-28) | https://arxiv.org/abs/2405.06087v2 | arXiv 抄録で 100超の研究・300超の効果量、平均で最良単体に劣る、意思決定で損失・創作で利得を確認。Nature 本体はログインへのリダイレクトで未取得。Hedges g の値は未確認。 |
| S-7.13 | 準一次 | The flaws of policies requiring human oversight of government algorithms (Green), Computer Law & Security Review 45, doi:10.1016/j.clsr.2022.105681 | Elsevier / arXiv 2109.05067 | 2022 | https://arxiv.org/abs/2109.05067 | arXiv 抄録で 41 政策・2 つの欠陥・制度的監督の提案・journal ref を確認。 |
| S-7.14 | 一次 (ベンダ) | Microsoft and LinkedIn release the 2024 Work Trend Index on the state of AI at work | Microsoft | 2024-05-08 | https://news.microsoft.com/source/2024/05/08/microsoft-and-linkedin-release-the-2024-work-trend-index-on-the-state-of-ai-at-work/ | プレスリリースで 75%、78% BYOAI、39% 研修、60% 計画なし、31,000 人・31 か国、パワーユーザー 61%/35% を確認。実査日の記載なし。 |
| S-7.15 | 一次 (コンサル) | AI at Work 2025: Momentum Builds, but Gaps Remain | BCG | 2025-06-26 | https://www.bcg.com/publications/2025/ai-at-work-momentum-builds-but-gaps-remain | ページで 10,600 人超・11 か国、現場 51%、15%→55%、約 4 分の 1、「半数超が代替を使う」を確認。 |
| S-7.16 | 一次 (コンサル) | AI at Work 2026: Why Strategy Matters More Than Tools | BCG | 2026-06-03 | https://www.bcg.com/publications/2026/ai-at-work-why-strategy-matters-more-than-tools | ページで約 12,000 人、現場 74%、42% vs 22%、3 分の 1、28% を確認。実査日・設問の同一性は未確認。 |
| S-7.17 | 一次 | AI Use at Work Has Nearly Doubled in Two Years | Gallup | 2025 | https://www.gallup.com/workplace/691643/work-nearly-doubled-two-years.aspx | ページで 21%→40%、11%→19%、リーダー 33% vs 個人貢献者 16%、明確な計画 22%、3 倍/2.6 倍、Gallup Panel の確率標本を確認。 |
