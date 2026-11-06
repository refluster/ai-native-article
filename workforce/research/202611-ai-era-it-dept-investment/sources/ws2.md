# WS2 ファクトパック — アドバイザリ・市場景観 (H-1.1 / H-1.2 / H-1.3)

- 担当: bruno (agent-native 景観の地図係。比較対象を本調査の軸上に置くだけで、戦略判断はしない)
- 作成日 / アクセス日: 2026-11-04
- 検索予算: 12 / 12 使用 (standard のみ)。以後は URL 指定の WebFetch で一次資料にあたった。
- アクセス制約: gartner.com (press release / articles)、businesswire.com はこのセッションから HTTP 403。mckinsey.com / mckinsey.com.br は 503。そのため Gartner と Forrester の数値は、ページ本文を確認できたものを除き **確度 B**。McKinsey 2025年3月版は PDF のミラー (jsdelivr 上のコピー) で本文と図表を確認した。発行元ドメインで確認していないので、こちらも **B** とした。

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-2.1 | H-1.1 | Gartner の予測。「2027年末までに agentic AI プロジェクトの40%超が中止される」。理由は「escalating costs, unclear business value」(Reuters 経由の引用)。二次報道の一部は inadequate risk controls も理由に挙げる。2025-06-25 の予測であり、実測値ではない。調査 n なし。 | S-2.2, S-2.3 | B |
| F-2.2 | H-1.1 | 同じ release による "agent washing" の推定。「agentic AI ベンダー数千社のうち本物は約130社」。グローバルなベンダー市場に関する推定で、企業側のデータではない。 | S-2.3 | B |
| F-2.3 | H-1.1 | 同じ release の2028年予測。日常業務の意思決定の15%以上が agentic AI により自律的に行われる (2024年は0%)。エンタープライズ向けソフトウェアの33%が agentic AI を含む (2024年は1%未満)。 | S-2.3 | B |
| F-2.4 | H-1.1 | Gartner Top Strategic Technology Trends 2026 (2025年10月、Orlando IT Symposium で発表)。「AI governance platforms」という名称のトレンドは2026年版に**無い** (2025年版の項目)。最も近いのは **AI Security Platforms** で、「centralize visibility and control across third-party and custom AI applications」と説明され、2028年までに企業の50%超が利用するという予測が付く。security, trust and governance はテーマ群の一つ。gartner.com 本文は 403 で、検索抜粋からの確認にとどまる。 | S-2.4, S-2.5 | B |
| F-2.5 | H-1.1 | Gartner 2026 CIO and Technology Executive Survey (n=2,501、2025-05-01〜06-30 に実施)。CIO の94%が24か月以内に計画と成果の大きな変更を予想する。デジタル施策のうち事業目標を達成・超過したのは48%。生産性向上の圧力を受ける CIO は57%、コスト削減の圧力は52%。Gartner 寄稿記事にはプラットフォーム / ガバナンス / ガードレールへの言及が**無い**。 | S-2.6 | B |
| F-2.6 | H-1.1 | **NOT FOUND**: Gartner 2026 CIO Agenda press release で CIO が挙げた技術優先度の順位、および agentic AI を「展開済み / 計画中」とする比率の一次確認。17% / 64% という数字は二次ブログ (引用不可) にしか無かったため採用しない。 | — | — |
| F-2.7 | H-1.1 | Evanta (Gartner C-level Communities) の Leadership Perspective Survey (CIO 1,400人、2026年5月)。2026年の CIO 機能別優先度の首位は「**Operationalizing AI**」で、2024年の4位から上がった。サイバーセキュリティは過去4年首位だったが、今回 AI に抜かれた。「Evolving IT Strategy, Governance and Operating Models」は上位5位以内だが、上位3位には入らない。上の Gartner CIO Survey とは**別の調査**。 | S-2.7 | A |
| F-2.8 | H-1.1 | Forrester 2026 Technology & Security Predictions (2025-10-28)。企業は計画中の AI 支出の **25% を2027年へ繰り延べる**。主因は財務部門による決裁の関門。AI の価値を P&L の変化に結び付けられる企業は3分の1未満。CIO の4分の1が「business-led AI failures」の尻拭いを求められる。少なくとも1社のグローバル CIO が "tech debt bankruptcy" を宣言する。Forrester 自身の release 本文は 403 で、検索抜粋と配信文から確認した。 | S-2.8, S-2.9 | B |
| F-2.9 | H-1.1 | IDC FutureScape 2026 (2025-10-23)。2030年までに G1000 の**最大20%**が、AI エージェントの統制・ガバナンス不備を原因とする訴訟・多額の罰金・**CIO 解任**に直面する。2026年に G2000 の職務の40%が AI エージェントとの協働を含むようになる。AI-ready データの無い企業は2027年に15%の生産性損失を被る。2030年に45%の組織が AI エージェントを大規模にオーケストレーションする。いずれも予測であり、実測値ではない。 | S-2.10 | A |
| F-2.10 | H-1.1 | IDC APJ excerpt (2025-11-14)。CIO 像は「Tomorrow's CIOs aren't just technology stewards, they're business architects」とされ、"CIO 3.0: Orchestrator" と位置付けられる。2027年までに A1000 の CIO の50%が「enterprise AI value playbooks」(ROI モデル) の作成を任される。2026年にアジアの組織の40%が複雑性と断片化したツールにより AI 目標を逃し、CIO は「unified platforms and workflows」への投資を増やす。CIO の役割はガードレール提供者にとどまらず、**事業アーキテクト兼統合者**として描かれている。 | S-2.11 | A |
| F-2.11 | H-1.1 / H-1.2 | IDC APJ excerpt。AI 資金の意思決定者 (APJ、IDC 調査) は CIO/CTO が63.5%、CAIO が53.0%、LoB が43.1%、CFO が42.3%、CPO が38.9% (複数回答とみられる)。事業部門 (LoB) は「Champion」と位置付けられている。 | S-2.11 | A |
| F-2.12 | H-1.2 | McKinsey "The state of AI: How organizations are rewiring to capture value" (2025年3月、調査 2024-07-16〜31、n=1,491、AI 利用企業 n=1,229)。中央集権度の分布は「完全集中 / ハイブリッド / 完全分散」の順に次のとおり。**リスク・コンプライアンス 57/30/13**、データガバナンス 46/39/15、AI 戦略 36/48/16、AI 製品ロードマップ 35/44/21、技術人材 29/49/22、**AI ソリューションの導入 (業務変更・チェンジマネジメント) 23/54/23**。本文は「Risk and data governance are two of the most centralized elements … whereas tech talent is often hybrid」。グローバル・全役職層が対象で、agentic AI 固有の数字ではない。 | S-2.1 | B |
| F-2.13 | H-1.1 / H-1.2 | 同じ McKinsey 資料。AI 利用企業の28%で CEO が AI ガバナンスを統括し (売上5億ドル以上の企業では比率が下がる)、17%で取締役会が統括する。平均すると2人の責任者による共同所有。CEO による監督は、生成 AI 由来の EBIT と最も相関する要素の一つ。**CIO / IT 部門がガバナンスを所有する比率は本文に記載が無い**。 | S-2.1 | B |
| F-2.14 | H-1.3 | 同じ McKinsey 資料。テストした25の属性のうち、生成 AI による EBIT 効果への影響が最大なのは**ワークフロー再設計**。生成 AI 利用企業のうち、少なくとも一部のワークフローを根本から再設計したのは21%。 | S-2.1 | B |
| F-2.15 | H-1.1 / H-1.2 | McKinsey "The state of AI in 2025: Agents, innovation, and transformation" (2025年11月、調査 2025年6〜7月、n≈1,993)。88% が少なくとも1機能で AI を定常利用 (2024年は78%)。62% が AI エージェントを少なくとも実験中で、23% はどこかでスケール中。どの機能をとっても、エージェントをスケールしている回答者は10%以下。企業全体で EBIT 効果があると答えたのは39%。high performer (EBIT の5%以上を AI に帰属) は約6%。mckinsey.com は 503 で、二次報道 (idm.net.au) と検索抜粋から確認した。 | S-2.12 | B |
| F-2.16 | H-1.2 | **NOT FOUND**: McKinsey 2025年11月版の中央 / ハイブリッド / 分散の内訳と、2024年からの**推移** (連邦型が「広がっている」ことを示す時系列データ)。Gartner の AI CoE / operating model の比率も同様に見つからなかった。 | — | — |
| F-2.17 | H-1.2 | IDC APJ excerpt。APJ の組織の**73%が agentic AI を中央で管理している、または管理する予定** (IDC APJ Agentic AI Survey, April [2025])。2030年までに APJ の組織の55%が AI エージェントのオーケストレーションを中央で管理する。2027年までに AI アプリ・サービスの50%が POC を越えられず、APJ の CEO は「AI centers of excellence (COEs) to centralize strategy and governance」を立ち上げる。APJ 限定であり、グローバルの数字ではない。 | S-2.11 | A |
| F-2.18 | H-1.2 | Deloitte "State of AI in the Enterprise" (2026年版、n=3,235、IT 部門と事業部門のリーダー、24か国、2025年8〜9月)。agentic AI について「mature governance model」があるのは**21%**。2027年までに74%が AI エージェントを少なくとも「moderately」使う見込み。推奨されているのは「IT, legal, compliance, and business unit leaders」の**横断ガバナンス構造**。中央 IT が基盤を持つか、事業部門が作るかの分担は明示されていない。 | S-2.13 | A |
| F-2.19 | H-1.3 | Stanford AI Index 2025。GPT-3.5 水準の性能 (MMLU 64.8%) を持つシステムの推論コストは、2022年11月から2024年10月の間に**280分の1以下**に下がった (100万トークンあたり $20 → $0.07。参照モデルは Gemini-1.5-Flash-8B)。ハードウェアのコストは年30%低下し、エネルギー効率は年40%改善した。「固定性能あたりの価格」であり、フロンティアモデルの価格ではない。 | S-2.14 | A |
| F-2.20 | H-1.3 | Stanford AI Index 2025。オープンウェイトとクローズドの性能差は、一部のベンチマークで1年のうちに **8% → 1.7%** に縮まった。上位1位と10位のスコア差は **11.9% → 5.4%**、上位2モデルの差は0.7%。米中モデル間の差は MMLU / HumanEval で2023年の二桁から2024年にはほぼ同等まで縮んだ。 | S-2.14 | A |
| F-2.21 | H-1.3 | Epoch AI (2025-03-12)。一定のベンチマーク到達点に必要な LLM 推論価格は、到達点に応じて**年 9倍〜900倍**のペースで低下した (6ベンチマーク、過去約3年)。最も速い低下は直近1年に集中しており、持続するかは「less clear」とされる。中央値はページ前半では確認できず **NOT FOUND** (二次資料の「中央値50倍」は採用しない)。 | S-2.15 | A |
| F-2.22 | H-1.3 | a16z, Guido Appenzeller "Welcome to LLMflation" (2024-11-12)。「For an LLM of equivalent performance, the cost is decreasing by 10x every year」。MMLU 42 の水準は GPT-3 (2021年11月) で 100万トークンあたり $60 だったが、Llama 3.2 3B (Together.ai) では $0.06 になり、3年で1,000分の1。MMLU 83 の水準は GPT-4 (2023年3月) 以降に約62分の1。著者自身が「very hard to predict」と留保し、MMLU 汚染の可能性も認めている。VC の投稿であり、ポートフォリオ利害がある。 | S-2.16 | A |
| F-2.23 | H-1.3 | IDC APJ excerpt「Data as the Moat」。2028年までに A1000 の CEO の40%が業界データと自社固有データを統合し、「powerful economic moats」を築く。予測であり、固有データが差別化要因になったことの実証ではない。 | S-2.11 | A |
| F-2.24 | H-1.3 | **NOT FOUND**: 「差別化の源泉がモデルから自社資産との接続面へ移った」ことを**実測**で示す一次資料。本 WS の範囲で見つかったのは予測 (F-2.23) と相関 (F-2.14) だけ。BloombergGPT と GPT-4 の比較 (固有データでの fine-tune 優位が失われた事例) は検索予算外で未確認。 | — | — |
| F-2.25 | H-1.1 | **NOT FOUND**: Gartner / Forrester / IDC / McKinsey が「IT 部門はアプリを作る側ではなく、プラットフォーム・ガバナンス・ガードレールの提供者である」と**明示的に**述べた一次の文言。Gartner の AI 支出予測 (2025/2026) と、Gartner の agentic AI 投資状況ウェビナー投票 (n・比率) は予算内で一次確認できなかった。 | — | — |

## 2. 仮説ごとの暫定判定

### H-1.1 アドバイザリの CIO 向け提言は「作る」より「基盤・ガバナンス・統制」側に置く
- **暫定判定: 一部支持 / 確度 中**
- 支持する側: F-2.1 (中止理由はコスト・価値・リスク統制)、F-2.4 (AI Security Platforms がトップトレンド入り)、F-2.8 (CIO が事業部門主導の AI 失敗を処理する)、F-2.9 (ガバナンス不備による CIO 解任)、F-2.18 (成熟したガバナンスモデルを持つのは21%)。ガバナンスと統制の欠如は、主要4社すべてで**リスクとして**一次的に扱われている。
- 支持しない側 / 競合する説明: F-2.7 では CIO 自身の首位が「Operationalizing AI」(実装) で、ガバナンスと運用モデルは上位3位の外にある。F-2.10 では IDC が CIO を「business architect / orchestrator」とし、ROI プレイブックの作成者に位置付ける。基盤の守り手に限定しておらず、価値創出まで CIO の責任範囲に入れている。F-2.25 のとおり「作る人ではなく基盤の人」という二分法を明示した一次文言は見つからなかった。アドバイザリ側の構図は「ガバナンスを敷き、**かつ**価値を実装する」であって、二者択一ではない。熟議の D1 (作る人ではない) は、外部の描像より狭い。

### H-1.2 連邦型 / 民主化モデルが中央 CoE より広がり、中央は platform + guardrails を担う
- **暫定判定: 一部支持 / 確度 中**
- 支持する側: F-2.12 で、導入 (業務変更) はハイブリッド54% + 分散23%、技術人材はハイブリッド49%。リスク・コンプライアンス (完全集中57%) とデータガバナンス (46%) は中央に寄っている。「統制は中央、実装は現場寄り」という**分担の形**は D1 と一致する。F-2.11 では LoB が「Champion」として AI 資金の決定に関わる (43.1%)。
- 支持しない側: F-2.17 では APJ の73%が agentic AI を**中央管理** (予定を含む) し、IDC は CoE による中央化を予測している。F-2.8 では business-led AI の失敗を CIO が引き取る。どちらも、エージェント段階では再集中の圧力があることを示す。F-2.16 のとおり「広がっている」(推移) を示す時系列データは**見つからなかった**。ハイブリッドが多数派なのは導入と人材だけで、ガバナンスでは中央集権が首位。
- 競合する説明: 規模の効果。売上5億ドル未満の企業ほど完全集中を選ぶ (F-2.12 本文)。もう一つは段階の効果で、エージェントの初期は中央管理、成熟後に分散するという見方 (APJ の予測)。

### H-1.3 モデルのコモディティ化は実測され、差別化は接続面へ移る
- **暫定判定: 一部支持 / 確度 中** (前半と後半で確度が分かれる)
- 前半 (価格低下と性能の収斂) は **支持・確度 高**。F-2.19、F-2.20 (Stanford)、F-2.21 (Epoch)、F-2.22 (a16z) の独立した3者がそろって「固定性能あたりの価格は年1桁から3桁の倍率で下がる」と示している。オープンとクローズドの差、上位モデル間の差も縮んだ。
- 後半 (差別化が接続面へ移る) は **未検証寄り・確度 低**。手がかりは F-2.14 (ワークフロー再設計が EBIT と最も相関) と F-2.23 (Data as the Moat、予測) だけで、実測は NOT FOUND (F-2.24)。
- 競合する説明: フロンティアモデルは依然として大幅に高価で (Stanford の注記)、最先端の能力は収斂していても価格は収斂していない。McKinsey の相関は生成 AI 全般についてのもので、「接続面」の定義とは対応していない。

## 3. 矛盾・注意点

1. **McKinsey の中央集権度は二次要約で逆になっている。** ある検索要約は「リスク・コンプライアンス 13% 集中 / 57% 分散」と書いていたが、原本の図 (Exhibit 1) では57%が**完全集中**、13%が完全分散。図の左右の軸 (CENTRALIZED「HUB」/ DECENTRALIZED「SPOKE」) を読み違えた典型例。本パックは原本の PDF 本文で確認した (F-2.12)。
2. **調査が二つある。** 「Gartner 2026 CIO and Technology Executive Survey」(n=2,501、2025年5〜6月) と、Evanta / Gartner C-level Communities の「Leadership Perspective Survey」(CIO 1,400人、2026年5月) は別物。「AI が CIO の首位優先度」は後者の結果で、前者には帰属させない。
3. **「AI governance platforms」は2025年版のトレンド。** Gartner 2026年版で最も近い項目は「AI Security Platforms」。第三者の要約 (Libertify など) は2026年版にも governance platforms があるかのように書いている。
4. **予測と実測を混同しない。** Gartner の40%中止、IDC の20%解任と45%オーケストレーション、Forrester の25%繰り延べは、すべてアナリストの予測。熟議の反証条件を判定する根拠にはならず、注意喚起として扱う。
5. **母集団の違い。** IDC の73%中央管理は APJ、20%は G1000、15%は A1000 (二次報道) で、互いに比較できない。McKinsey は全役職層、Deloitte は IT 部門と事業部門のリーダー。
6. **コモディティ化指標の定義。** 3者とも「**固定ベンチマーク到達点**あたりの最安価格」を測っている。企業が実際に使うフロンティアモデルの単価や総支出ではない。総支出は増え得る (H-2.3 の WS と突き合わせること)。MMLU 汚染の留保もある (a16z)。
7. **利害。** a16z は AI スタートアップへの投資家で、価格低下の物語に利害がある。Gartner、Forrester、IDC は CIO 向けの有料サービスを売っており、「CIO の役割拡大」を描く動機がある。
8. **アクセスの限界。** Gartner、Forrester、McKinsey の発行元ドメインはこのセッションから到達できなかった (403 / 503)。これらの B 判定は、エグレスの制約が無い環境で再確認すれば A に上がり得る。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-2.1 | 一次 | The state of AI: How organizations are rewiring to capture value | McKinsey & Company (QuantumBlack) | 2025-03 | https://cdn.jsdelivr.net/gh/abncharts/abncharts.public.1/abnasia.org/1744132962976_www.abnasia.org.pdf (mirror; 正本 https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai は 503) | ミラー PDF を pdftotext で抽出した。Exhibit 1 の数値、CEO 28%・取締役会17%、ワークフロー再設計21%、n=1,491 / 2024-07-16〜31 を本文で確認。発行元ドメインでは未確認なので B。 |
| S-2.2 | 一次 | Gartner Predicts Over 40% of Agentic AI Projects Will Be Canceled by End of 2027 | Gartner | 2025-06-25 | https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027 | 403 で本文を確認できず。存在と日付は報道で確認した。 |
| S-2.3 | 二次 | Over 40% of agentic AI projects will be scrapped by 2027, Gartner says (Reuters) | The Star (Reuters 配信) | 2025-06-25 | https://www.thestar.com.my/tech/tech-news/2025/06/25/over-40-of-agentic-ai-projects-will-be-scrapped-by-2027-gartner-says | 本文で40%、理由、約130社、2028年の15% / 33% を確認。投票の n は記載なし。 |
| S-2.4 | 一次 | Gartner Top 10 Strategic Technology Trends for 2026 | Gartner | 2025-10 | https://www.gartner.com/en/articles/top-technology-trends-2026 | 403。AI Security Platforms の説明と50% / 2028予測は検索抜粋でのみ確認。 |
| S-2.5 | 一次 | Gartner Identifies the Top Strategic Technology Trends for 2026 (press release) | Gartner via Business Wire | 2025-10-20 | https://www.businesswire.com/news/home/20251020453550/en | 403。発表の場 (Orlando IT Symposium/Xpo) を検索抜粋で確認。 |
| S-2.6 | 準一次 | Strategic Pivots Will Define the CIO's Agenda in 2026 | Gartner, Inc. (Hospitality Net 掲載の寄稿) | 2026-04-28 (年はページ上で推定) | https://www.hospitalitynet.org/external/4132095/strategic-pivots-will-define-the-cios-agenda-in-2026 | 本文で 94% / 48% / 57% / 52% / 18% / 28% / 33% を確認。n と実施日は記載なし。n=2,501 と 2025-05-01〜06-30 は検索抜粋による。 |
| S-2.7 | 一次 | Top 3 Priorities for CIOs in 2026 | Evanta (a Gartner company) | 2026 (調査 2026-05) | https://www.evanta.com/resources/cio/survey-report/top-3-priorities-for-cios-in-2026 | 本文で n=1,400、Operationalizing AI が首位、2024年は4位だったこと、ガバナンスと運用モデルが上位5位にあることを確認。 |
| S-2.8 | 一次 | Forrester's 2026 Technology & Security Predictions: As AI's Hype Fades, Enterprises Will Defer 25% Of Planned AI Spend To 2027 | Forrester via Business Wire | 2025-10-28 | https://www.businesswire.com/news/home/20251028226928/en/Forresters-2026-Technology-Security-Predictions-As-AIs-Hype-Fades-Enterprises-Will-Defer-25-Of-Planned-AI-Spend-To-2027 | 403。25% 繰り延べ、P&L 3分の1未満、CIO の4分の1が尻拭い、tech debt bankruptcy は検索抜粋で確認。 |
| S-2.9 | 一次 | CIO – AI Spending May Slow Down As ROI Remains Elusive | Forrester (press newsroom) | 2025-11-06 | https://www.forrester.com/press-newsroom/cio-ai-spending-may-slow-down-as-roi-remains-elusive/ | ページは要約1文のみ (Brian Hopkins の取材記事への誘導)。「2026年に AI 支出の遅延が一般化する」という主旨だけ確認。 |
| S-2.10 | 一次 | IDC FutureScape 2026 Predictions Reveal the Rise of Agentic AI and a Turning Point in Enterprise Transformation | IDC | 2025-10-23 | https://www.idc.com/resource-center/press-releases/idc-futurescape-2026-predictions-reveal-the-rise-of-agentic-ai-and-a-turning-point-in-enterprise-transformation/ | 本文で 40% G2000 職務 / 2026、15% 生産性損失 / 2027、最大20% G1000 訴訟・罰金・CIO 解任 / 2030、45% オーケストレーション / 2030、60% 主権クラウド、70% ベンダー価格、70% CEO ROI を確認。 |
| S-2.11 | 一次 | Charting the Agentic Future — IDC APJ Predictions 2026–2030 (FutureScape 2026 Singapore excerpt) | IDC Asia/Pacific | 2025-11-14 | https://info.idc.com/rs/081-ATC-910/images/IDC-futurescape-2026-charting-the-agentic-future-excerpt-AP.pdf | PDF を pdftotext で抽出し、本文で 73% 中央管理、55% / 2030、50% POC 止まり → CoE、CIO 3.0 Orchestrator、資金決定者の比率、Data as the Moat 40% / 2028、40% 目標未達 / 2026 を確認。 |
| S-2.12 | 一次 | The state of AI in 2025: Agents, innovation, and transformation | McKinsey & Company | 2025-11 | https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/the-state-of-ai-2025 | 503。88% / 78%、62%、23%、10%以下、39% EBIT、約6% high performer は検索抜粋と二次報道 (idm.net.au「McKinsey: Few Organisations Fully Scaling AI Despite Uptake」) で確認。n≈1,993 も二次情報。 |
| S-2.13 | 一次 | AI agents are scaling faster than governance (State of AI in the Enterprise 2026 関連記事) | Deloitte Insights (Andy Bayiates) | 2026-04-24 | https://www.deloitte.com/us/en/insights/topics/emerging-technologies/ai-agents-scaling-faster.html | 本文で n=3,235、24か国、成熟ガバナンス21%、74% moderately / 23% extensive / 5% full (2027見込み)、横断ガバナンスの推奨を確認。調査期間 2025年8〜9月は検索抜粋による。 |
| S-2.14 | 準一次 | The 2025 AI Index Report (Top takeaways) | Stanford HAI | 2025-04 | https://hai.stanford.edu/ai-index/2025-ai-index-report | 本文で 280倍超 (2022-11〜2024-10)、HW 年30% / エネルギー効率 年40%、オープンとクローズドの差 8%→1.7%、1位と10位の差 11.9%→5.4%、上位2モデルの差0.7%、米中の差を確認。$20→$0.07 と Gemini-1.5-Flash-8B は検索抜粋による。 |
| S-2.15 | 準一次 | LLM inference prices have fallen rapidly but unequally across tasks | Epoch AI | 2025-03-12 | https://epoch.ai/data-insights/llm-inference-price-trends | 本文で 年9倍〜900倍、6ベンチマーク・約3年、直近が最速で持続は不明を確認。中央値は未確認。 |
| S-2.16 | 二次 (VC の一次分析) | Welcome to LLMflation – LLM inference cost is going down fast | Andreessen Horowitz (Guido Appenzeller) | 2024-11-12 | https://a16z.com/llmflation-llm-inference-cost/ | 本文で 年10倍、$60→$0.06 (MMLU 42、2021-11 → 執筆時)、1,000倍 / 3年、MMLU 83 で約62倍、留保を確認。投資家の分析で利害がある。 |
