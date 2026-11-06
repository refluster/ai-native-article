# WS1 ファクトパック — 構造的異質性の実測 (H-1.1 / H-1.2 / H-1.3 / H-1.4)

座席: **sora** (AI ネイティブ製品の研究者。論評より一次資料を先に読む) + **freya** (エージェント体験の設計者。複製・記憶の移植・同一性の揺らぎが、エージェントの側からどう見えるかを書く)。アクセス日: 2026-11-05。検索 6 回 / 12 回。残りは一次資料 (arXiv、ベンダ文書、METR と SWE-bench の公開データファイル、OpenAI の PDF、Statuspage の API) を直接取得した。第 1 報の行は S-0.<ws>.<k> で内部引用する。

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-1.1 | H-1.2 | METR (arXiv 2503.14499、v1 2025-03-18、v4 2026-07-10)。指標は「50%-task-completion time horizon」で、AI が 50% の成功率で完遂できるタスクに、ドメインの専門家である人間がかかる時間を表す。Claude 3.7 Sonnet で「around 50 minutes」。「doubling approximately every seven months since 2019」で、「the trend may have accelerated in 2024」とも書く。測っているのは RE-Bench、HCAST と短いタスク 66 件 (主にソフトウェアと ML 研究) で、一般の業務ではない。外的妥当性の限界は著者自身が書いている | S-1.1 | A |
| F-1.2 | H-1.2 | METR Horizon v1.1 のデータファイル (`benchmark_results_1_1.yaml`。ページの最終更新 2026-09-08) は、倍増時間を **2023 年以降 128.7 日** (95% CI 104.4〜158.0 日、約 4.2 か月)、**2019 年以降で 187.8 日** (約 6.2 か月) と推定している。p50 が 16 時間を超える点は推定から除いている | S-1.2 | A |
| F-1.3 | H-1.2 | 同じファイルの p50 horizon (単位は分。括弧内は CI)。GPT-4 (2023-03): 4 分 → o1 (2024-12): 39 分 → Claude 3.7 Sonnet (2025-02): 60 分 → o3 (2025-04): 120 分 → GPT-5 (2025-08): 203 分 (113〜406) → Claude Opus 4.5 (2025-11): 293 分 → GPT-5.2 (2025-12): 352 分 → **Claude Opus 4.6 (2026-02-05): 719 分 ≈ 12 時間 (317〜3,634)** → **Claude Mythos Preview early (2026-04-07): 1,045 分 ≈ 17.4 時間 (509〜3,304)**。80% horizon はずっと短く、Opus 4.6 で 70 分、Mythos Preview で 186 分。ページには「Measurements above 16 hrs are unreliable with our current task suite」とあり、最新値は上限に張り付いている | S-1.2, S-1.3 | A |
| F-1.4 | H-1.2 | 単位の罠。METR のページ本文は GPT-5 を「around 2 hours and 17 minutes」と書くが、v1.1 のデータファイルでは 203 分 (約 3.4 時間) になっている。タスク集合の版が違う (v1.0 と v1.1) ため。版を混ぜて時系列を作ってはいけない | S-1.2, S-1.3 | A |
| F-1.5 | H-1.2 | SWE-bench Verified の公式リーダーボード (500 件、公式データ `leaderboards.json`。最新エントリ 2026-02-26)。最高解決率の推移は 2023-10: 4.4% (RAG + Claude 2) → 2024-06: 37.0% → 2024-10: 53.0% → 2025-05: 73.2% (Claude 4 Opus) → 2025-12-05: **79.2%** (Sonar Foundation Agent + Claude 4.5 Opus)。28 か月で約 18 倍だが、70% を超えてからは傾きが鈍り、天井効果がある。ベンダの自己申告値 (下の F-1.13) は、このリーダーボードに載らないことがある | S-1.4 | A |
| F-1.6 | H-1.1 | **再実行 1 回の値段**。同じリーダーボードの統一 harness (mini-SWE-agent 2.0、Attempts 1、2026-02-17) で、1 タスクあたりの平均費用は Claude 4.5 Opus (high) が **USD 0.75** (解決率 76.8%、33 calls)、Claude 4.6 Opus が USD 0.55 (75.6%)、GPT 5.2 (high) が USD 0.47 (72.8%)、Gemini 3 Flash が USD 0.36 (75.8%)、MiniMax M2.5 が **USD 0.07** (75.8%、60 calls)。同じ水準の解決率で単価に約 10 倍の幅がある。これは API の推論費用だけで、人間のレビュー時間とインフラは含まない。人間のエンジニアが同じタスクを解く費用は、このデータに **NOT FOUND** | S-1.4 | A |
| F-1.7 | H-1.1 | 第 1 報 (内部): 固定性能あたりの推論価格は**年 9 倍〜900 倍**で下がった (Epoch AI、6 ベンチマーク、約 3 年)。GPT-3.5 水準は 2022-11 から 2024-10 で **280 分の 1 以下** ($20 → $0.07 / 100 万トークン)。持続するかは「less clear」とされる | S-0.2.15, S-0.2.14 | A (第 1 報) |
| F-1.8 | H-1.1 | Epoch AI Trends (更新 2026-02-05)。フロンティア言語モデルの訓練計算量は「growing at 5× per year since 2020」、AI チップの性能/ドルは「49% per year since 2023」。推論価格はこのページに **NOT FOUND** (F-1.7 で補う) | S-1.5 | A |
| F-1.9 | H-1.1 / H-1.3 | **トークン単価は下がるが、1 タスクのトークン量は増える**。Anthropic のマルチエージェント研究 (2025-06-13) は、エージェントが「about 4× more tokens than chat」、マルチエージェントが「about 15× more tokens than chats」を使うと書く。評価のばらつきは「token usage by itself explains 80% of the variance」。限界費用がゼロに向かうのはトークン単価であって、タスク単価ではない | S-1.6 | A |
| F-1.10 | H-1.3 (並列) | 同じ記事。リードエージェントが「3-5 subagents in parallel」を起動し、Claude Opus 4 の単体構成を社内の研究評価で **90.2%** 上回った (社内 eval、n は非公開)。複雑な問い合わせで研究時間を「up to 90%」短縮した。並列が効くのは幅優先の調査で、密結合のコーディングには向かないと同じ記事が留保している (要旨) | S-1.6 | A |
| F-1.11 | H-1.3 (並列・複製) | Claude Code の subagents ドキュメント。既定では同時 **20** 体で「Concurrent subagent limit reached」になり、上限は環境変数で任意の正の整数に変えられる。「no limit on the total number of subagents Claude can spawn over a session」。各体は「fresh, isolated context window」で起動し、「Each subagent invocation creates a new instance」。複製の限界は製品の既定値と費用であって、採用市場ではない | S-1.7 | A |
| F-1.12 | H-1.3 (停止再開) | 停止と再開は 2 社とも製品機能になっている。(a) Claude Code checkpointing: プロンプトのたびに自動でチェックポイントを作り、直近 **100 個**のスナップショットを保持し、既定で約 **30 日**残す。`/rewind` で「Restore code and conversation」ができ、`--fork-session` でセッションを複製して分岐できる。(b) OpenAI Agents SDK: 承認待ちで止めた run を `state.to_json()` で DB やキューに保存し、`RunState.from_json(...)` で再開する (「RunState is designed to be durable」)。(c) Anthropic のマルチエージェント研究は、エラーが起きた地点から再開する仕組みを作った (「resume from where the agent was when the errors occurred」) | S-1.8, S-1.9, S-1.6 | A |
| F-1.13 | H-1.3 (休まない) / H-4 系 | Claude Sonnet 4.5 の発表 (2025-09-29): 「we've observed it maintaining focus for more than 30 hours on complex, multi-step tasks」。ベンダが観測した事例で、条件・n・成功率は**非公開**。同じ発表に、**SWE-bench Verified は通常 77.2% (10 試行平均)、並列に複数を試して選ぶ high-compute 条件で 82.0%** とある。投機的な並列試行が、製品の公表値の中に組み込まれている | S-1.10 | A (値) / C (30 時間の一般性) |
| F-1.14 | H-1.3 (休まない) | 「休まない」の反証材料。Claude の公開 Statuspage は直近 50 件のインシデントを載せており、期間は 2026-08-05〜2026-10-28 の約 84 日。影響度は critical 2、major 24、minor 21、none 3。対象は claude.ai、API、Claude Code などの全コンポーネントで、1 件の長さと影響範囲はまちまち。稼働率 (%) は JS 描画のため取得できず **NOT FOUND**。エージェントは疲れないが、供給元が止まる単一障害点を持つ。人間の病欠とは相関構造が違い、全員が同時に休む | S-1.11 | A (件数) |
| F-1.15 | H-1.3 (集団で学習) | 能力はモデルのリリース日に全員へ一斉に入る。METR のデータで、Claude Opus 4.5 (2025-11-24) の p50 は 293 分、Opus 4.6 (2026-02-05) は 719 分。**約 10 週で 2.5 倍**になり、同じ製品の全利用者に同日に配られた。SWE-bench Verified の首位も、モデルのリリースに合わせて段差で上がる (2025-05-22 Claude 4 Opus: 70.6 → 73.2)。人間の組織で、全員の技能が同じ日に段差で上がる対応物は **NOT FOUND** (推論。比較研究は無い) | S-1.2, S-1.4 | A (値) / C (対応物の不在) |
| F-1.16 | H-1.3 (記憶の移植) | Claude Code の subagent の persistent memory には scope が 3 つある。`project` は `.claude/agent-memory/<name>/` で「shareable via version control」。記憶はファイルとして git で配れて、別の個体に入れられる。メインの会話の auto memory は subagent に**渡らない**。API の memory tool はクライアント側に置く設計 (第 1 報)。**移植した記憶で成果が上がるかを測った値は NOT FOUND** | S-1.7, S-0.4.16 | A (機能) |
| F-1.17 | H-1.3 (同一性の揺らぎ) | Lu et al. "The Assistant Axis" (arXiv 2601.10387、2026-01-15。Anthropic、MATS、Oxford)。ペルソナ空間の第 1 主成分が「Assistant Axis」で、そこからのずれが「predicts "persona drift"」。post-training は既定のペルソナに「only loosely tethers」。ずれは、自分の内部についての内省を求める会話や、感情的に弱っている利用者との会話で起きやすく、コーディングでは起きにくい (要旨)。活性化を固定の範囲に抑えると安定する。対象は Gemma 2 27B、Qwen 3 32B、Llama 3.3 70B で、商用フロンティアモデルではない。抄録に数値は無い | S-1.12 | A |
| F-1.18 | H-1.3 (同一性) | 第 1 報 (内部): 指示のずれは「within eight rounds」で起きる (Li et al.)。過度な compaction は「loss of subtle but critical context」を招く (Anthropic)。**圧縮の前後で同一性を比べた公開ベンチマークは NOT FOUND** | S-0.4.11, S-0.4.14 | A (第 1 報) |
| F-1.19 | H-1.3 (推論時スケーリング) | Brown et al. "Large Language Monkeys" (arXiv 2407.21787、2024-07)。coverage (どれか 1 つのサンプルが解けた問題の割合) は、サンプル数に対して 4 桁にわたり、しばしば log-linear に伸びる。SWE-bench Lite で DeepSeek-Coder-V2 は **1 サンプル 15.9% → 250 サンプル 56%** で、当時の単発 SOTA 43% を超えた。ただし自動検証器の無い領域では、選択法が「plateau beyond several hundred samples」 | S-1.13 | A |
| F-1.20 | H-1.3 (推論時スケーリング) | OpenAI "Learning to reason with LLMs" (2024-09-12)。o1 は AIME 2024 で、1 サンプル 74% → 64 サンプルの合議 83% → 1,000 サンプルを学習済みスコアラで並べ替えて 93%。性能は推論時の計算 (考える時間) で伸びると主張する。ページは 403 で、値は検索要約から取った | S-1.14 | B |
| F-1.21 | H-1.3 (タスク構成) | Anthropic Economic Index。第 1 回 (2025-02-10、Claude.ai 約 100 万会話): augmentation 57% / automation 43%、「computer and mathematical」が 37.2%。2025-09-15 の回: Claude.ai で directive が 27% → 39% になり、「first report where automation usage exceeds augmentation」。1P API (2025-08、100 万件) は automation **77%** / augmentation 12% | S-1.15, S-1.16 | A |
| F-1.22 | H-1.3 / H-1.2 | Economic Index 2026-01-15 (2025-11-13〜20、Claude.ai 100 万 + 1P API 100 万)。Claude.ai は augmentation 52% / automation 45% で、自動化はいったん反転した。API は「three-quarters … automation」。タスク成功率は Claude.ai 67%、API 49%。API の成功率は 1 時間未満のタスクで約 60%、人間なら 5 時間以上かかるタスクで約 45% に落ち、**50% を切るのは約 3.5 時間** (Claude.ai を外挿すると約 19 時間)。利用者がタスクを選んでいるので、能力だけの値ではないと著者が留保している。上位 10 タスクの占有率は Claude.ai 24%、API 32% | S-1.17 | A |
| F-1.23 | H-1.4 | **やり直しが利く範囲は製品が明示している**。Claude Code の checkpointing は、Bash で変えたファイル、背景 subagent の編集、外部の変更、symlink / hard link を巻き戻せない (「Not a replacement for version control」)。巻き戻せるのはローカルのファイル編集と会話だけで、送信・デプロイ・外部 API などの副作用は対象外 | S-1.8 | A |
| F-1.24 | H-1.4 | OpenAI Agents SDK: 「Approval permits a tool call to execute; it does not guarantee exactly-once execution」。tool が動いた後、状態を保存する前にプロセスが止まると、再開で同じ操作が**もう一度**実行され得るので、idempotency key を勧めている。再実行が安いのは副作用の無い部分だけで、副作用がある操作は「やり直し」が二重送信になる | S-1.9 | A |
| F-1.25 | H-1.4 | OpenAI ChatGPT Agent System Card (2025-07-17)。「before finalizing actions that affect the state of the world (e.g., before completing a purchase or sending an email)」に確認を取るよう訓練している。確認の recall は **91.0%** (Operator 4o 90.8%、o3 92.1%。著者は過小評価と注記)。誤った共有の高リスク 8 テストでは、権限変更 100.0%、高リスクの送信 99.9%、金融取引 100.0% で、8/8 合格。銀行やメールにログインした文脈では「Watch Mode」でユーザーが離れると止まる。確認のすり抜けは約 9% あり、不可逆な操作の前の確認は 100% ではない | S-1.18 | A |
| F-1.26 | H-1.4 | 第 1 報 (内部): OWASP LLM06 Excessive Agency は「Require user approval」と最小権限を挙げる。Anthropic のサンドボックス化は permission prompt を **84%** 減らした (社内利用、母集団は非公開)。可逆性は境界 (sandbox) で作り、人の承認は不可逆な少数の操作に絞る、という処方と整合する | S-0.1.8, S-0.7.6 | A (第 1 報) |
| F-1.27 | H-1.4 | **NOT FOUND**: エージェントの失敗のうち、外部副作用を伴う不可逆なものの割合 (実運用の率)、1 件あたりの損害額、再実行コストと人間のやり直しコストの比較 | — | — |

### 異質性の表 (編集用 1 枚)

| 性質 | 最良の実測値 | 出典 F | 人間組織との差 |
|---|---|---|---|
| 複製 | 同時 20 体 (既定、変更可)、総数の上限なし、セッションの fork | F-1.11, F-1.12 | 採用・育成のリードタイムが 0 になる |
| 並列 | 3〜5 体の並列で単体比 +90.2% (社内 eval)、時間 −90%、トークン 15 倍 | F-1.10, F-1.9 | 速さを買う代わりに計算を払う |
| 停止と再開 | チェックポイント 100 個 × 30 日、RunState の JSON 保存。ただし exactly-once は保証しない | F-1.12, F-1.24 | 「中断した状態」をそのまま保存できる |
| 記憶の移植 | 機能はある (git で配れる memory)。効果の測定は NOT FOUND | F-1.16 | 引き継ぎ書でなく、記憶そのものを渡せる |
| 休まない | 30 時間超の連続作業 (ベンダ観測)。供給元の障害は 50 件 / 約 84 日 | F-1.13, F-1.14 | 疲れないが、全員が同時に止まる |
| 集団で学習 | 同じ製品で 10 週に p50 が 2.5 倍 (293→719 分)。リリース日に全員へ | F-1.15 | 対応物は NOT FOUND |
| 同一性の揺らぎ | 8 ラウンドでずれる。Assistant Axis で予測でき、抑制できる (オープンモデル) | F-1.17, F-1.18 | 同一性を「測って直す」対象にできる |
| 失敗の可逆性 | 再実行 USD 0.07〜0.75 / タスク。確認 recall 91%。不可逆な操作の率は NOT FOUND | F-1.6, F-1.25, F-1.27 | 内側は安く可逆、外側は人より速く不可逆 |
| 守備範囲の伸び | p50 horizon の倍増 128.7 日 (2023 以降)。最新は約 17 時間 (計測の上限) | F-1.2, F-1.3 | 年単位で守備範囲が倍以上になる |

## 2. 仮説ごとの暫定判定

- **H-1.1** (限界費用ほぼゼロ) — **一部支持 / 中**。F-1.6, F-1.7, F-1.8, F-1.9。トークン単価が年 1〜3 桁で下がることと、1 タスクの再実行が USD 0.07〜0.75 であることは実測で支持された。ただし「ほぼゼロ」はトークン単価にしか言えない。エージェント化で 1 タスクのトークンは 4〜15 倍に増える (F-1.9)。人間の費用は同じデータ集合に無いので、比は推論になる。競合する説明: 価格の低下は補助金と競争による一時的なもの (Epoch 自身が持続性を「less clear」とする)。
- **H-1.2** (time horizon の指数的な伸び) — **支持 / 高**。F-1.1, F-1.2, F-1.3, F-1.5, F-1.22。倍増の周期は 7 か月から約 4.2 か月 (2023 年以降、CI 3.4〜5.2 か月) に縮んだ。ただし (a) タスク集合はソフトウェアと ML 研究に偏っている、(b) 16 時間超は計測できない、(c) 80% horizon は p50 の 1/5〜1/10 しかない。実運用の Economic Index では 50% を切るのが約 3.5 時間 (API)。ベンチと実務の間に約 3〜5 倍の開きがある。競合する説明: ベンチの汚染や飽和 (SWE-bench は 70% を超えて鈍化)。
- **H-1.3** (並列・停止再開・記憶の移植は実装済み。集団学習と同一性の揺らぎは対応物なし) — **一部支持 / 中**。F-1.10〜F-1.22。前半 (製品機能として実装済み) は支持で、確度は高。後半のうち「集団で学習」はリリース日に段差で上がるという実測があるが、「人間組織に対応物がない」ことを示す比較研究は NOT FOUND で、これは推論。「同一性の揺らぎ」は測定法が生まれた (Assistant Axis)。ただし対象はオープンモデルで、圧縮前後の比較は NOT FOUND。記憶の移植の効果は NOT FOUND。
- **H-1.4** (内側は安く可逆、外部副作用は不可逆で、可逆性は設計で作る) — **支持 / 中**。F-1.6, F-1.23, F-1.24, F-1.25, F-1.26。ベンダ文書 3 社分が、巻き戻しの範囲をローカルに限ると明示している (exactly-once は保証しない、購入と送信の前に確認、確認 recall 91%)。不可逆な失敗の実運用での率と損害額は NOT FOUND で、確度は中に留める。

## 3. 矛盾・注意点

- **ベンダの利害**: F-1.10 (+90.2%)、F-1.13 (30 時間、82.0%)、F-1.21/22 (Economic Index) は Anthropic の、F-1.20/25 は OpenAI の自己申告。社内 eval の n とタスクは非公開。90.2% は「研究型クエリ」の社内評価で、一般の業務の改善率ではない。
- **予測と実測**: METR の「5 年で 1 か月のタスク」は外挿で、実測ではない。最新の p50 (約 17 時間) はタスク集合の上限 (16 時間) を超えていて、CI の上端は 3,000 分台。報告では「12〜17 時間、上限に張り付き」と書き、点推定を見出しにしない。
- **単位の罠**: (1) METR v1.0 と v1.1 で同じモデルの値が違う (GPT-5: 137 分 vs 203 分)。(2) p50 と p80 の差は 5〜10 倍。(3) SWE-bench には、公式リーダーボード (統一 harness、1 試行) と、ベンダ発表 (独自の scaffold、並列試行、10 回平均) の 2 系統がある。77.2% と 82.0% は同じモデルの条件違い。(4) Economic Index の API は「1 往復の組」、Claude.ai は「会話」で、単位が違う。(5) 「トークン単価」と「タスク単価」を混ぜない (F-1.9)。
- **生存者バイアス**: リーダーボードに載るのは提出された成功例だけ。Statuspage はインシデントを数えるが、稼働率の分母は取れていない。
- **自動化の比率は振れる**: Claude.ai の automation は 2025-08 に augmentation を上回り、2025-11 に再び下回った。一方向の趨勢として書かない。
- **同一性の研究の外的妥当性**: Assistant Axis はオープンモデル 3 種での結果で、商用フロンティアモデルに当てはまるかは未検証。

## 4. 情報源台帳

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-1.1 | 一次 | Measuring AI Ability to Complete Long Tasks (arXiv 2503.14499) | METR (Kwa, West et al.) | v1 2025-03-18 / v4 2026-07-10 | https://arxiv.org/abs/2503.14499 | 抄録で 50 分、7 か月、2024 年の加速、5 年の外挿、版の履歴を確認 |
| S-1.2 | 一次 (データ) | METR-Horizon-v1.1 benchmark_results_1_1.yaml | METR | 2026-09-08 時点 | https://metr.org/assets/benchmark_results_1_1.yaml | curl で取得し、Python で全モデルの p50 / p80 / CI / release_date と倍増日数 (128.744、CI 104.4〜158.0、全期間 187.8) を抽出した。単位は分 |
| S-1.3 | 一次 | Time Horizons (METR ページ) | METR | 最終更新 2026-09-08 | https://metr.org/time-horizons/ | GPT-5 の「2 hours and 17 minutes」、「above 16 hrs are unreliable」、更新ログ (Mythos Preview は 2026-05-08 に追加) を確認 |
| S-1.4 | 一次 (データ) | SWE-bench leaderboards.json (Verified) | SWE-bench (Princeton / Stanford) | 最新エントリ 2026-02-26 | https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json | 取得して、Verified 180 エントリから最高値の推移と、mini-SWE-agent 44 エントリの instance_cost と calls を抽出した |
| S-1.5 | 準一次 | Epoch AI Trends | Epoch AI | 更新 2026-02-05 | https://epoch.ai/trends | 5× / 年 (2020 年以降)、49% / 年 (2023 年以降) を確認。推論価格は記載なし |
| S-1.6 | 一次 (ベンダ) | How we built our multi-agent research system | Anthropic Engineering | 2025-06-13 | https://www.anthropic.com/engineering/multi-agent-research-system | 90.2%、4× と 15×、80% variance、3〜5 体の並列、up to 90%、resume と checkpoints の文言を確認 |
| S-1.7 | 一次 (ベンダ) | Create custom subagents (Claude Code docs) | Anthropic | 2026-11 時点 | https://code.claude.com/docs/en/sub-agents | 同時 20 体、総数の上限なし、isolated context、new instance、memory の scope 3 種を確認 (先頭 100k 文字) |
| S-1.8 | 一次 (ベンダ) | Checkpointing (Claude Code docs) | Anthropic | 2026-11 時点 | https://code.claude.com/docs/en/checkpointing | 全文を取得。100 個、約 30 日、rewind の選択肢、fork-session、制限 (Bash、subagent、外部、symlink)、「Not a replacement for version control」を確認 |
| S-1.9 | 一次 (ベンダ) | Human-in-the-loop (OpenAI Agents SDK docs) | OpenAI | 2026-11 時点 | https://openai.github.io/openai-agents-python/human_in_the_loop/ | to_json / from_json、「designed to be durable」、「does not guarantee exactly-once execution」、idempotency key を確認 |
| S-1.10 | 一次 (ベンダ) | Introducing Claude Sonnet 4.5 | Anthropic | 2025-09-29 | https://www.anthropic.com/news/claude-sonnet-4-5 | 30 時間超、77.2% (10 試行) と 82.0% (並列 + 選択)、OSWorld 61.4%、checkpoints を確認 |
| S-1.11 | 一次 (データ) | Claude Status — incidents.json (Statuspage API v2) | Anthropic | 取得 2026-11-05 | https://status.claude.com/api/v2/incidents.json | API で直近 50 件 (2026-08-05〜10-28) と影響度の内訳を集計した。稼働率 % は取れなかった |
| S-1.12 | 準一次 | The Assistant Axis: Situating and Stabilizing the Default Persona of Language Models (arXiv 2601.10387) | Lu, Gallagher, Michala, Fish, Lindsey | 2026-01-15 | https://arxiv.org/abs/2601.10387 | 抄録の要所を逐語で確認。数値は抄録に無い。対象モデルは検索要約と HTML 版の題で確認 |
| S-1.13 | 準一次 | Large Language Monkeys: Scaling Inference Compute with Repeated Sampling (arXiv 2407.21787) | Brown et al. | 2024-07-31 (v3 2024-12-30) | https://arxiv.org/abs/2407.21787 | 抄録で log-linear、15.9% → 56% (250 サンプル)、43%、plateau を確認 |
| S-1.14 | 一次 (本文未取得) | Learning to reason with LLMs | OpenAI | 2024-09-12 | https://openai.com/index/learning-to-reason-with-llms/ | WebFetch は 403。74 / 83 / 93% と test-time compute の主張は検索要約 (各言語版のスニペット) で確認したので確度 B |
| S-1.15 | 一次 (ベンダ) | The Anthropic Economic Index | Anthropic | 2025-02-10 | https://www.anthropic.com/news/the-anthropic-economic-index | 57% / 43% (57.4 / 42.6)、37.2%、約 100 万会話を確認 |
| S-1.16 | 一次 (ベンダ) | Anthropic Economic Index report (September 2025) | Anthropic | 2025-09-15 | https://www.anthropic.com/research/anthropic-economic-index-september-2025-report | directive 27% → 39%、automation が初めて上回ったこと、API 77% / 12%、API の標本 (2025-08、100 万件、1P の約半分) を確認 |
| S-1.17 | 一次 (ベンダ) | Anthropic Economic Index report (January 2026) | Anthropic | 2026-01-15 | https://www.anthropic.com/research/anthropic-economic-index-january-2026-report | 標本、52 / 45%、API 約 3/4、成功率 67 / 49%、3.5 時間 / 19 時間、上位 10 タスク 24 / 32% を確認 (先頭 100k 文字) |
| S-1.18 | 一次 (ベンダ) | ChatGPT Agent System Card | OpenAI | 2025-07-17 | https://cdn.openai.com/pdf/839e66fc-602c-48bf-81d3-b21eacc3459d/chatgpt_agent_system_card.pdf | PDF を取得してテキスト化。§3.1.2.3–3.1.2.4、§3.2.2.1、表 13 (91.0% / 90.8% / 92.1%、100 / 99.9 / 100%、8/8) を逐語で確認 |
| S-0.2.14 | 内部 | 第 1 報 S-2.14: The 2025 AI Index Report | Stanford HAI | 2025-04 | https://hai.stanford.edu/ai-index/2025-ai-index-report | 第 1 報で A 判定。再調査していない |
| S-0.2.15 | 内部 | 第 1 報 S-2.15: LLM inference prices have fallen rapidly but unequally across tasks | Epoch AI | 2025-03-12 | https://epoch.ai/data-insights/llm-inference-price-trends | 第 1 報で A 判定。再調査していない |
| S-0.4.11 | 内部 | 第 1 報 S-4.11: Measuring and Controlling Instruction (In)Stability in Language Model Dialogs | Li et al. | 2024-02-13 | https://arxiv.org/abs/2402.10962 | 第 1 報で確認済み |
| S-0.4.14 | 内部 | 第 1 報 S-4.14: Effective context engineering for AI agents | Anthropic | 2025-09-29 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 第 1 報で確認済み |
| S-0.4.16 | 内部 | 第 1 報 S-4.16: Memory tool (Claude API docs) | Anthropic | 2026-11 時点 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool | 第 1 報で確認済み |
| S-0.1.8 | 内部 | 第 1 報 S-1.8: LLM06:2025 Excessive Agency | OWASP | 2025 | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ | 第 1 報で確認済み |
| S-0.7.6 | 内部 | 第 1 報 S-7.6: Beyond permission prompts (sandboxing) | Anthropic | 2025-10-20 | https://www.anthropic.com/engineering/claude-code-sandboxing | 第 1 報で確認済み (84%) |
