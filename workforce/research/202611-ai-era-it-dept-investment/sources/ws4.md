# WS4 ファクトパック — スキル再利用・エージェント体験・記憶 (H-5.1 / H-5.4 / H-5.5)

- 担当: sana (スキル SRE。成熟度は申告ではなく成果で測る) · 協力: freya (仮説の提出者として擁護側に立つ。判定は sana)
- 作成日 / アクセス日: 2026-11-04 · 検索使用: 10 / 10 回 (standard のみ)。以後は一次資料の URL を直接取得した
- 前提の注意: H-5.1 の根拠はほぼすべて **ベンダー自身の発表・製品文書** である。採用率・再利用率を示す第三者の測定値は見つからなかった (§1 の NOT FOUND 行を参照)

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 (A/B/C) |
|---|---|---|---|---|
| F-4.1 | H-5.1 | Anthropic は 2025-10-16 に Agent Skills を発表 (2025-12-18 に更新)。定義は "Skills are folders that include instructions, scripts, and resources that Claude can load when needed"。Claude アプリ・Claude Code・API の 3 面で "the same format" が使われ、スキル同士は "stack together" (組み合わせ可能)。**再利用の単位は、エージェント個体ではなく個体より小さい手順の束**である。ベンダーの製品発表であり、採用数の公表はない | S-4.1 | A |
| F-4.2 | H-5.1 | 同じ発表によると、Team/Enterprise では管理者が組織全体で有効化してからでないと使えない。Claude Code のスキルはバージョン管理で共有し、`/v1/skills` API でバージョンを管理する。12 月の更新で「組織全体のスキル管理」と partner-built スキルのディレクトリが加わった。導入企業として名前が出ているのは Canva・Notion・Rakuten・Box。Rakuten は「1 日かかった作業が約 1 時間」と述べているが、これは顧客の談話であって測定ではない | S-4.1 | A |
| F-4.3 | H-5.1 | Salesforce は 2025-03-04 に AgentExchange を発表した。初期パートナーは 200 社超、出品は「hundreds of ready-made actions, topics, and templates」(正確な件数は書かれていない)。出品の単位は **actions / prompt templates ("pre-written, reusable prompts") / topics / agent templates** の 4 種。agent templates の提供開始は 2025-04 予定と書かれていた。AgentExchange 自体の導入数は書かれておらず、引用されているのは前身 AppExchange の「13 million app installs」だけ。「$6 trillion digital labor market」には出典が付いていない | S-4.2 | A |
| F-4.4 | H-5.1 | Microsoft の Agent Store (Microsoft Learn、ms.date 2026-04-17) は「Microsoft、信頼できるパートナー、自組織」のエージェントを一つにまとめた curated なハブである。自組織のエージェントは Copilot Studio で作り、管理者が M365 admin center の Requests で承認すると "Built by your org" に載る。**ここでの単位はエージェント (個体) であり、スキルではない**。承認時に確認するのは機能・データアクセス・作成者情報 | S-4.3 | A |
| F-4.5 | H-5.1 / H-5.5 | Microsoft Agent 365 の agent registry (ms.date 2026-04-28) は、テナント内の全エージェントを一元管理する台帳で、"Single source of truth" を名乗る。Copilot Studio でエージェントを作ると自動で登録され、Entra identity が自動で付与される。管理者が取れる統制は **Block / Reassign (所有者の移管。"Useful for team transitions or organizational changes") / Delete** で、操作は Purview に記録される。配布用の Power Platform app catalog とは役割が分かれている | S-4.4 | A |
| F-4.6 | H-5.1 | Google は 2025-04-09 の Agentspace の発表で Agent Gallery を GA (allowlist 制) にした。Agent Gallery は Google・社内チーム・パートナーのエージェントについて「a single view of available agents across the enterprise」を社員に見せる。あわせて no-code の Agent Designer (preview) と、Google Cloud Marketplace 内の AI Agent Marketplace を発表した。**ここでも単位はエージェント**。利用数は示されていない | S-4.5 | A |
| F-4.7 | H-5.1 | ServiceNow は 2025-01-29 に AI Agent Orchestrator と AI Agent Studio を発表し、「thousands of pre-built AI agents」を添えると述べた。2025-03-12 の Yokohama リリースで GA になり、機能は ServiceNow Store から入手できる。どちらも検索結果の要約で確認しただけで、本文は取得していない | S-4.6, S-4.7 | B |
| F-4.8 | H-5.1 | **NOT FOUND**: エージェントやスキルのマーケットプレイス / カタログについての Gartner の一次声明。gartner.com の press release ページは 403 で取得できず、検索でも「agent marketplace」を主題にしたリリースは出てこなかった。2028 年に Fortune 500 の 1 社あたり 150,000 エージェントという数字は二次ブログでしか見ておらず、採用しない | — | — |
| F-4.9 | H-5.1 | **NOT FOUND**: 企業内でのスキル / プロンプト / エージェントの**再利用率** (二部門目で採用された比率、インストール数に対する継続利用率など) の公表値。四社 (Anthropic・Salesforce・Microsoft・Google) とも件数やパートナー数は出しているが、再利用の成果指標は出していない | S-4.1–S-4.5 | — |
| F-4.10 | H-5.1 | 「個体 (ペルソナ) 単位の再利用」(反証側) の事例も見つからなかった。各社のカタログに載る「エージェント」は機能を設定した構成物で、名前を持つ人格が記憶を蓄えて育つ形ではない。持ち運ばれる単位は、①手順の束 (skills、prompt templates、topics)、②エージェント構成のテンプレート の二層になっている | S-4.1–S-4.5 | A (各ページ上の記述からの解釈) |
| F-4.11 | H-5.4 | LongMemEval (Wu et al., arXiv 2410.10813, ICLR 2025)。チャット履歴に埋め込んだ 500 問で、情報抽出・セッションをまたぐ推論・時間推論・知識の更新・回答の棄却の 5 能力を測った。商用チャットアシスタントと長文脈 LLM は、対話が続く条件で「a 30% accuracy drop」を示した。測ったのは 2024 年時点のモデルで、同一性やペルソナの保持は測っていない | S-4.9 | A |
| F-4.12 | H-5.4 | LoCoMo (Maharana et al., arXiv 2402.17753, 2024-02)。平均 300 ターン・約 9K トークン・最大 35 セッションの会話で検証した。長文脈モデルも RAG も改善はするが「still substantially lag behind human performance」。arXiv の抄録ページには数値と会議名が載っていない | S-4.10 | A |
| F-4.13 | H-5.4 | Li et al. (arXiv 2402.10962, COLM 2024)。指示を与えたチャットボット同士を自己対話させると「a significant instruction drift within eight rounds」が起きた (LLaMA2-chat-70B、GPT-3.5)。原因は attention の減衰と推定し、split-softmax を対策として出している。**系譜としては、これがペルソナ (指示) のずれを直接測った最も近い研究**。ただし対象は 2023 年世代のモデルで、要約や圧縮の後の同一性を測ったものではない | S-4.11 | A |
| F-4.14 | H-5.4 | MemGPT (Packer et al., arXiv 2310.08560)。OS の階層メモリにならった「virtual context management」を提案した。抄録はペルソナの一貫性を扱っていない | S-4.8 | A |
| F-4.15 | H-5.4 | Survey "Memory in the Age of AI Agents" (Hu et al. ほか全 50 名, arXiv 2512.13564, 2025-12)。抄録は「the field has also become increasingly fragmented」と書き、long/short-term という従来の分類では足りないと述べる。trustworthiness を今後の研究課題 (frontier) として挙げている。評価プロトコルが研究ごとに異なるとも指摘している | S-4.13 | A |
| F-4.16 | H-5.4 | Anthropic "Effective context engineering for AI agents" (2025-09-29) は、compaction を「taking a conversation nearing the context window limit, summarizing its contents」と定義し、「overly aggressive compaction can result in the loss of subtle but critical context」と警告している。context rot (文脈が長くなるほど想起の精度が落ちる現象) は全モデルに共通すると書いている | S-4.14 | A |
| F-4.17 | H-5.4 | Claude の context editing 文書 (beta) によると、ツール結果は古い順に消され、placeholder に置き換わる。SDK compaction は履歴全体を `<summary>` 1 つに置き換える (例: 約 100k トークン → 2〜3k トークン)。これはドキュメント上の例示値で、ベンチマークの結果ではない | S-4.15 | A |
| F-4.18 | H-5.4 (反証寄り) | Claude memory tool の文書では status が stable。文書は、記憶はクライアント側のファイルに置き、保持の責任はアプリ側が持つ設計だと説明する。そのうえで「memory preserves the information that must survive summarization」と、compaction と併用することを勧めている。つまり、**圧縮で失われるものを外部の記憶へ逃がす仕組みは製品として出ている**。ただし同一性が保たれることの評価は示していない。運用上の注意として「Memory expiration」(長く読まれないファイルの削除) を挙げている | S-4.16 | A |
| F-4.19 | H-5.4 (反証寄り) | Mem0 (Chhikara et al., arXiv 2504.19413, 2025-04) は "Production-Ready" を名乗る。LoCoMo で OpenAI memory に対して LLM-as-a-Judge 指標で「26% relative improvements」、full-context に対して「91% lower p95 latency」とトークン費用 90% 超の削減を主張している。著者はメモリ製品を提供する側 (所属は arXiv の抄録ページに書かれていない) で、**利害のある当事者による自己評価**である。同一性は測っていない | S-4.12 | A (主張がページにあることを確認した。主張の正しさは未検証) |
| F-4.20 | H-5.4 | **NOT FOUND**: 要約や圧縮の**後で**ペルソナ・同一性・価値判断が保たれるかを測った公開ベンチマーク。LongMemEval・LoCoMo は事実の想起を、Li et al. は対話中の指示のずれを測っており、「圧縮前後の同一性の比較」はどれも測っていない | S-4.9–S-4.11 | — |
| F-4.21 | H-5.5 | Microsoft CoE Starter Kit の core components には `CLEANUP - Admin \| Sync Template v3 (Orphaned Makers)` という flow がある。週次で「checks if any makers have left the organization」を調べ、作成者が Entra/O365 から消えていれば、その人が作った apps / flows / environments / chatbots を orphaned として印を付ける。Copilot Studio のエージェント表には「Is bot orphaned (yes/no)」の列がある。所有者を付け替える HELPER flow (Assign) も用意されている | S-4.18 | A |
| F-4.22 | H-5.5 | 同じ kit の App Catalog は、管理者が app 監査 (app auditing process) を通したものだけを `In App Catalog = Yes` にして全社公開する。**組織全体へ「昇格」させる前に審査のゲートがある**形である。ただしページ上では、そのゲートで「保守担当の指名」が要件として書かれているかは確認できない | S-4.18 | A |
| F-4.23 | H-5.5 | Power Platform admin center の Actions ページ (更新 2026-08-14) は、自動の是正の例として、使われていない app を消す前に所有者へ通知し、返答がなければ削除する手順を挙げている。所有者に連絡が取れることが削除の前提になっている | S-4.19 | A |
| F-4.24 | H-5.5 | 皮肉な事実: CoE Starter Kit 自体が「no longer actively maintained」で、「Issues are no longer reviewed or addressed」となっている (2026 年時点)。機能は Power Platform admin center (Inventory / Usage / Monitor / Actions) へ吸収された。**ガバナンス資産も保守の担い手が抜ければ止まる**という実例であり、移管先が明示されている点はよい止め方の例でもある | S-4.17 | A |
| F-4.25 | H-5.5 | Axelos の白書 "Ownership and owners in ITIL 4" によると、ITIL 4 は process owner / service owner の枠組みから product owner と practice owner へ概念を移し、product owner を「accountable for the delivery of a specific service」の役割と書いている。本文は取得できず (ページのタイトルしか返らなかった)、検索結果の抜粋で確認しただけ | S-4.20 | B |
| F-4.26 | H-5.5 | Gartner "How to Support and Govern Low-Code Applications for Citizen Development" (2025-04-17) は抄録しか見られない。抄録に orphaned app や ownership への言及はない。2011 年の Gartner の予測には、市民開発のガバナンス方針を持たない企業の 1/3 以上が 2014 年までにデータ・プロセスの完全性やセキュリティの問題に直面する、とある (二次の転載で確認) | S-4.21, S-4.22 | B |
| F-4.27 | H-5.5 | **NOT FOUND**: 「所有者のいない」資産の比率 (例: 市民開発アプリのうち作成者が退職した割合) を示す Gartner・Microsoft・学術の一次の数値。ツールが存在することは確認できたが、問題がどの程度の規模かは確認できなかった | — | — |

## 2. 仮説ごとの暫定判定

### H-5.1 再利用の単位は個体よりスキル / ツール / プロンプト資産で、企業内の再利用は内部マーケットプレイス・テンプレートライブラリの形で現れている
- **暫定判定: 一部支持 · 確度 中** (F-4.1–F-4.7, F-4.9, F-4.10)
- 支持される部分: 主要四社がそろって**カタログ / マーケットプレイス**という形で再利用の場を作っている (Salesforce AgentExchange、Microsoft Agent Store + agent registry、Google Agent Gallery、Anthropic の skills directory と組織単位の管理)。名前と記憶を持って育つ「個体」を再利用の単位にした例は見つからない。
- 支持されない部分: 単位は「スキル」だけに寄っていない。Microsoft と Google のカタログが扱うのは**エージェント構成物**であり、Salesforce は手順 (actions/topics/prompt templates) とエージェントテンプレートの両方を並べている。実際には「手順の束」と「構成したエージェント」の**二層**になっている。
- 確度を「中」にとどめる理由: 根拠はすべて**ベンダー自身の一次文書** (自社製品の発表) で、独立した採用や再利用の測定がない (F-4.9 NOT FOUND)。「マーケットプレイスが作られた」ことは確認できたが、「再利用が起きている」ことは確認できていない。Gartner の声明も確認できなかった (F-4.8)。
- 競合する説明: カタログは再利用の需要があって生まれたのではなく、**エコシステムを囲い込む (プラットフォーム戦略) ための供給側の構造**である可能性がある。AppExchange の 1,300 万インストールを引き合いに出していることがその傍証になる。

### H-5.4 記憶圧縮と同一性保持は未解決の研究課題で、「個体育成」への投資は時期尚早という判断は研究動向と整合する
- **暫定判定: 支持 · 確度 中** (F-4.11–F-4.17, F-4.20。反証寄りの F-4.18, F-4.19 も含めて判断した)
- 長期の記憶 (LongMemEval で 30% の精度低下、LoCoMo で人間との差)、対話中の指示のずれ (8 ラウンド以内)、圧縮で文脈が失われるというベンダー自身の警告 (Anthropic)、分野が断片化しているという survey の評価。この 4 系統が独立に「未解決」を示している。**同一性が保たれることを評価した公開ベンチマークは存在しない** (F-4.20)。そのため「保持が確認できてから育成する」という熟議の順序 (D6) は、守られるべき前提条件として妥当である。
- 確度を「高」にしない理由: (1) 主要な実証 (Li et al., LongMemEval) は 2023〜2024 年世代のモデルを対象にしており、2026 年のモデルでの再測定を確認できていない。(2) memory tool は stable で、Mem0 のような「production-ready」を名乗る製品があり、**事実の想起という限られた範囲では実用化が進んでいる**。(3)「同一性」の定義が研究ごとにばらばらである。
- 競合する説明: 個体育成が時期尚早なのは研究が未解決だからではなく、**評価の基準 (同一性とは何か) が定義されていないから**である。その場合、投資すべきは育成よりも先に**同一性を判定する eval を作ること** (U8) であり、熟議の D6「リコールパケットの形は a) の仕事」はこちらの読みと合う。

### H-5.5 保守の担い手が決まらない限り昇格を止める、という条件はオーナー不在資産の実務知見と整合する
- **暫定判定: 一部支持 · 確度 中** (F-4.5, F-4.21–F-4.24, F-4.25, F-4.26, F-4.27)
- 支持される部分: Microsoft は、作成者の退職による orphan の検出 (週次)、所有者の移管 (Reassign/Assign)、削除前の所有者への通知、全社カタログへ載せる前の監査を**製品機能として**備えている。所有者のいない資産が、ツールを用意するほどの運用上のリスクだと認められている証拠になる。ITIL 4 も、特定のサービスを提供する責任を一つの役割に負わせている (B)。
- 違う部分: 実務の主流は「**事後に検出して付け替える**」型であり、熟議のような「**保守担当が決まるまで昇格させない**」という事前のゲートが明文化された例はない。App Catalog の監査がそれに最も近いが、監査項目に保守担当の指名が入っているかは確認できなかった (F-4.22)。
- 根拠の偏り: 一次の具体例はほぼ Microsoft の製品文書だけで、**単一ベンダーの文書**に依存している。Gartner の orphan に関する記述は抄録では確認できなかった。所有者のいない資産の比率は NOT FOUND (F-4.27)。
- 競合する説明: 資産を保守できなくなっても、移管先を明示して止める (F-4.24 の CoE Kit) ことは健全な終わらせ方である。昇格を止めるより「**終わらせ方の手順 (sunset path) を条件にする**」ほうが、実務の形に近い可能性がある。

## 3. 矛盾・注意点

1. **「エージェント」の語の揺れ**: Microsoft と Google の「agent」は設定 (指示・知識・ツール) を束ねた構成物で、熟議でいう「個体 (ペルソナ。記憶と実績が積み上がる)」とは別物である。カタログにエージェントが並んでいることを「個体単位で再利用されている」証拠と読まないこと (F-4.10)。
2. **ベンダーの利害**: H-5.1 と H-5.5 の根拠はすべて、マーケットプレイスやガバナンス製品を売る側の文書である。Salesforce の「$6 trillion」は出典がなく、Rakuten の「1 日 → 1 時間」は顧客の談話であって測定ではない。Mem0 の数値はメモリ製品を提供する側による自己評価 (F-4.19)。
3. **研究の世代のずれ**: H-5.4 の実証研究は 2023〜2024 年のモデルを対象にしている。2026 年のモデルでも同じ傾向が出るかは確認していない。ベンダー文書 (F-4.18) が「compaction と memory の併用」を勧めていることは、問題が残っていることを認めつつ回避策を製品にしているとも読める。
4. **「想起」と「同一性」は別の問題**: 長期記憶のベンチマークは事実を想い出せるかを測っており、価値判断・語り口・判断の一貫性 (熟議でいう同一性) は測っていない。H-5.4 の「未解決」はこの二つを分けて報告するべきである。
5. **ITIL 4 の用語**: ITIL 4 では service owner と product owner の境界がはっきりしない (F-4.25)。報告で「ITIL が service owner を要求している」と言い切らないこと。
6. **CoE Starter Kit の状態**: ガバナンスの参照例として挙げた kit 自体が保守を終えている。引用するときは「現行機能は PPAC (Power Platform admin center) へ移った」と必ず併記する。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-4.1 | 一次 | Introducing Agent Skills (blog "skills") | Anthropic | 2025-10-16 (2025-12-18 更新) | https://claude.com/blog/skills | 2026-11-04 アクセス。定義文、3 面での同一形式、"stack together"、管理者による有効化、/v1/skills、12 月の org 管理とディレクトリ、導入企業名をページ上で確認。再利用の指標はない |
| S-4.2 | 一次 | Salesforce Launches AgentExchange, the Trusted Marketplace for Agentforce | Salesforce | 2025-03-04 | https://www.salesforce.com/news/press-releases/2025/03/04/agentexchange-announcement/ | 2026-11-04 アクセス。200 社超、4 種の出品単位、"hundreds of"、AppExchange の 13M installs、$6T (出典なし) を確認 |
| S-4.3 | 一次 | Agent Store in Microsoft Copilot | Microsoft Learn | ms.date 2026-04-17 (更新 2026-11-03) | https://learn.microsoft.com/microsoft-365/copilot/copilot-agent-store | 2026-11-04 アクセス。4 つの導入経路、Requests による承認、"Built by your org" を確認 |
| S-4.4 | 一次 | Agent registry integration for Copilot Studio | Microsoft Learn (Agent 365) | ms.date 2026-04-28 | https://learn.microsoft.com/en-us/microsoft-agent-365/builder/agent-registry | 2026-11-04 アクセス。自動登録、Entra identity、Block/Reassign/Delete、Purview 記録、app catalog との違いを確認 |
| S-4.5 | 一次 | Google Agentspace enables the agent-driven enterprise | Google Cloud Blog | 2025-04-09 | https://cloud.google.com/blog/products/ai-machine-learning/google-agentspace-enables-the-agent-driven-enterprise | 2026-11-04 アクセス。Agent Gallery GA (allowlist 制)、Agent Designer preview、AI Agent Marketplace を確認。数値はない |
| S-4.6 | 一次 (未取得) | ServiceNow announces new agentic AI innovations to autonomously solve the most complex enterprise challenges | ServiceNow Newsroom | 2025-01-29 | https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-announces-new-agentic-AI-innovations-to-autonomously-solve-the-most-complex-enterprise-challenges-01-29-2025-traffic/default.aspx | 検索結果の要約でのみ確認 (AI Agent Orchestrator / Studio、"thousands of pre-built AI agents")。本文は取得していない → B |
| S-4.7 | 一次 (未取得) | ServiceNow's Latest Platform Release Adds to Thousands of AI Agents… (Yokohama) | ServiceNow / Business Wire | 2025-03-12 | https://www.businesswire.com/news/home/20250312170054/en/ | 検索結果の要約でのみ確認 (GA、ServiceNow Store)。本文は取得していない → B |
| S-4.8 | 準一次 | MemGPT: Towards LLMs as Operating Systems | Packer et al. (UC Berkeley), arXiv 2310.08560 | 2023-10-12 (v2 2024-02-12) | https://arxiv.org/abs/2310.08560 | 2026-11-04 アクセス。抄録で virtual context management を確認。ペルソナ一貫性への言及はない |
| S-4.9 | 準一次 | LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory | Wu et al., arXiv 2410.10813 (ICLR 2025) | 2024-10-14 (v2 2025-03-04) | https://arxiv.org/abs/2410.10813 | 2026-11-04 アクセス。500 問、5 能力、"30% accuracy drop" を抄録で確認 |
| S-4.10 | 準一次 | Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo) | Maharana et al., arXiv 2402.17753 | 2024-02-27 | https://arxiv.org/abs/2402.17753 | 2026-11-04 アクセス。300 ターン / 9K トークン / 35 セッション、"substantially lag behind human performance" を確認。抄録ページに会議名・数値はない |
| S-4.11 | 準一次 | Measuring and Controlling Instruction (In)Stability in Language Model Dialogs | Li et al., arXiv 2402.10962 (COLM 2024) | 2024-02-13 (v4 2024-07-25) | https://arxiv.org/abs/2402.10962 | 2026-11-04 アクセス。"significant instruction drift within eight rounds"、対象モデル、split-softmax を確認 |
| S-4.12 | 準一次 (利害当事者) | Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory | Chhikara et al., arXiv 2504.19413 | 2025-04-28 | https://arxiv.org/abs/2504.19413 | 2026-11-04 アクセス。26% relative、91% lower p95 latency、90% 超のトークン削減を確認。所属はページに書かれておらず、製品提供側の自己評価として扱う |
| S-4.13 | 準一次 | Memory in the Age of AI Agents (survey) | Hu et al. (全 50 名), arXiv 2512.13564 | 2025-12-15 (v2 2026-01-13) | https://arxiv.org/abs/2512.13564 | 2026-11-04 アクセス。"increasingly fragmented"、従来分類では不十分、trustworthiness が frontier、を抄録で確認 |
| S-4.14 | 一次 | Effective context engineering for AI agents | Anthropic Engineering | 2025-09-29 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2026-11-04 アクセス。compaction の定義、"overly aggressive compaction…" の警告、context rot を確認 |
| S-4.15 | 一次 | Context editing (Claude API docs) | Anthropic | 2026-11 時点 (beta) | https://platform.claude.com/docs/en/docs/build-with-claude/context-editing | 2026-11-04 アクセス。beta の header、ツール結果の消去、SDK compaction の履歴置換と例示値を確認 (先頭 100k 文字まで読んだ) |
| S-4.16 | 一次 | Memory tool (Claude API docs) | Anthropic | 2026-11 時点 (status stable) | https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool | 2026-11-04 アクセス。クライアント側に置く設計、compaction との併用 ("must survive summarization")、Memory expiration を確認 |
| S-4.17 | 一次 | Microsoft Power Platform CoE Starter Kit transition to Power Platform admin center | Microsoft Learn | ms.date 2026-05-07 | https://learn.microsoft.com/en-us/power-platform/guidance/coe/starter-kit | 2026-11-04 アクセス。"no longer actively maintained" と PPAC への移管を確認 |
| S-4.18 | 一次 | Use core components (CoE Starter Kit) | Microsoft Learn | ms.date 2026-05-18 | https://learn.microsoft.com/en-us/power-platform/guidance/coe/core-components | 2026-11-04 アクセス。Orphaned Makers flow (週次)、"Is bot orphaned"、Assign helper、App Catalog の監査ゲートを確認 |
| S-4.19 | 一次 | Actions Overview (Power Platform admin center) | Microsoft Learn | ms.date 2025-05-28 (更新 2026-08-14) | https://learn.microsoft.com/en-us/power-platform/admin/power-platform-advisor | 2026-11-04 アクセス。削除前に所有者へ通知する是正の例を確認 |
| S-4.20 | 一次 (未取得) | Ownership and owners in ITIL 4 (white paper) | Axelos (PeopleCert) | 不明 | https://axelos.com/resource-hub/white-paper/ownership-and-owners-in-itil-4 | ページ本文が取得できず (タイトルのみ)。product owner の定義は検索結果の抜粋でのみ確認 → B |
| S-4.21 | 一次 (抄録) | How to Support and Govern Low-Code Applications for Citizen Development | Gartner | 2025-04-17 | https://www.gartner.com/en/documents/6370411 | 検索結果に出た抄録の要約で確認。orphan や ownership への言及は抄録にない。本文は有料 → B |
| S-4.22 | 一次 (二次転載) | Gartner Says Citizen Developers Will Build at Least 25 Percent of New Business Applications by 2014 | Gartner (Zawya 転載) | 2011 | https://www.zawya.com/en/press-release/gartner-says-citizen-developers-will-build-at-least-25-percent-of-new-business-applications-by-2014-fcvdwxla | 検索結果の要約でのみ確認 (ガバナンスのない企業の 1/3 以上で問題が出る、という予測)。Gartner 原文は取得していない → B |
