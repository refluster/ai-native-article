# 2026-10 — Client Studies Office 再編ラウンド（semi-value 3 か月の実績からの組織補強案）

- **Operator request**（2026-10-17）: `refluster/personal-goal` の `semi-value`（インドから始めるエネルギー事業の価値創造研修テーマ）で、この約 3 か月ワークフォースに回させたリサーチ・レビュー・サマリレポート等の活動を振り返り、それを元に (1) 必要な専門領域・統括能力・異なる体系知識の統合や意味付けなど「成果や生産性を飛躍的に高め、アウトプットをアウトカムに変える（1+1 を 2 以上にする）組織機能」を書き出し、(2) 新規ポジション追加を含む組織再編案を出す。予算増は構わない。
- **Lead**: 操作者セッション（起草）。People-ops review・VP パネルは未招集（§11 参照。本書は提案であり、採用判定は操作者）。
- **Status**: **Proposal**。登録バンドル（`workforce/seed/client-studies-office/`）は未作成 — 操作者が §6 の席を取捨した後に staging する。W-3 の上限改正は本書に含めない（§8、別 PR・Zone A）。
- **根拠**: 本ラウンドのために作った棚卸し 3 本（personal-goal のラン別棚卸し／レビュー・ナレッジ運用・操作者作業の棚卸し／workforce 現体制の棚卸し。後者は agents-api 本番の `GET /agents`・`/performance`・`/stats`・`/projects`・`/executions` を 2026-10-17 に読み取り専用で参照）。本文中の `personal-goal:` 付きパスはそのリポジトリの `semi-value/knowledge-hub/` 以下。
- **観測期間の注意**: semi-value の git 履歴は 2026-09-14 以前が無く（shallow）、09-13 以前は GitHub REST の PR #2〜#124・Issue 35 件で補った。実質の密な観測は **08-15〜10-17**、うちワークフォース多席ランは **09-13〜10-17 の 5 週間**に集中している。

---

## §0. 要約

この 3 か月、semi-value は **9 本の多席ラン**（69・71/72・73・74・75・76・77・79・80）と **8 型のレビュー**（41・38/39・16・51・50・56・57・59）、**15 本の研究文書**（42〜58）を回し、ワークフォースの **38 席**を延べ 270 件以上使った。工程は research-study と同型の S0〜S11 に収束し、レッドチーム（rafael 8 ラン）、独立ファクトチェック（owen・astrid 352 行）、数字の統制（silas・corinne）、置き換え台帳・矛盾登録簿（beatriz・zoe・anjali）、読者体験（nadia・ingrid・kai・aoi・mira）という**レビュー層の分業が自然発生**した。

一方で、成果物は決定に変わっていない。「お金が払われた証拠」（R-1）は 13 か月開いたまま、👤（人がやる）項目は 8 件中 0 件閉、計測器（PR #104）はマージ後 2 週間で台帳 0 行、訂正は「提案」のまま正本に戻らず、後のラン（79・80）が前のランの物語（77）を黙って崩している。原因は能力不足ではなく、**ラン単位の分業はあるのにラン横断の責任者・台帳・ゲートが無い**ことにある。

提案は 3 層:

1. **Client Studies Office（調査エンゲージメント室）を新設**し、beatriz（VP Research）配下に置く。室長 1（統括）＋ 室員 4（数字の統制・知識統合司書・モデル席・独立検証）。
2. **既存 VP 配下に機能席を 6 席追加**: 決裁ブローカー（camille 配下）、情報設計・公開（elena 配下）、日本側事業判断の翻訳者（priya 配下）、採点較正（beatriz 配下）、コーポデベ／投資委員会レンズ（silas 配下）、系統計画／配電会社計画レンズ（anjali 配下）。
3. **基盤の 4 変更**: personal-goal の PROJECT 登録、審議プロファイル 9 本の移植、cadence 5 本の新設、`research-study` の改訂（名前のある席・S1 母数凍結・S9 逆伝播・S11 アウトカム判定）。

計 11 席・計画予算 USD 78/月。計画値の合計は 343 → 421（上限 600 内）。ただし現在 semi-value 型のランは operator セッションで走り **W-3 の計測外**（モデル上の消費は既に約 478/月）なので、PROJECT 登録で計測に乗せる前提で **600 → 800 の改正を別 PR で推奨**する（§8）。

---

## §1. 適用した方針

- **C-3 単一オペレータ規模** — 新設する席はすべて *調査・レビュー・台帳* の席。外部（上司・弁護士・配電会社・施工店・Reddit）への接触は引き続き操作者だけが行い、席は文面・順番・記録の雛形と催促までを担う（India round と同じ guardrail）。
- **W-2 / W-5** — 席の識別・設定は agents-api 経由のみ。既存席の役割変更・親の付け替え・rebind は **1 名 1 変更・権限 B**として §5.3 に列挙し、本書では実行しない。
- **W-3** — 計画値は上限内。改正は別 PR（Zone A、`governance.md` §2 改正表 1 行＋`agent-config.ts:W3_BUDGET_CAP_USD` を同じ PR で）。
- **W-1 / C-1** — 室の成果物は依頼主リポジトリ（personal-goal → project-ind `/internal/`）に出る。公開物にはペルソナのバイアス開示を付ける。
- **ADR-0045（Proposed）の精神** — 投機的な席には kill 期限を付ける（§6 の各席に `Speculative — kill by` を明記）。
- **Zone** — 本書（`docs/hires/`）は `governance.md` §3 の既定で **Zone B**。L1 文書・ADR には触れないため R-11 は `RULE-N/A`（PR 本文に記載）。

---

## §2. 実績の振り返り — semi-value の 3 か月

### §2.1 ラン一覧（多席ラン）

| 文書 | テーマ | 日付 | 工程 | 席（役割） | 査読 |
|---|---|---|---|---|---|
| `exploration/61〜68` | 16 次元の事業空間を kill ルールで潰す探索、ランダム抽出 22 本、仮想レビュー陣 6 席の採点 10 ラウンド | 09-13〜19 | Round A〜F / R1〜R10 | 操作者（Claude）主体。64 の 6 席は実在レビューから復元 | 役員席 52→84 点。R10「残りは全て 👤」 |
| `exploration/69`（＋`70`） | 残存空間で事業成立性の一次証拠を短期に作る方法を VP 以上で決め、計測器（請求書チェック）を要件→デプロイ | 09-27 | R0〜R4＋処置 | VP 10 席（maya 決定 D1〜D13）、IC 4 レーン（jay・sneha・vikram・aanya）、camille（決定パッケージ）、rafael（R4） | RT 46 件（refuted 3・weakened 30・survived 13）→ project-ind PR #104 |
| `exploration/71`（＋`72`） | kill 台帳 K-01〜K-33 の根拠を一次出典・現地の声で固める。Web で閉じない行を人手台帳へ | 09-28 | R0→根拠票 8 席→統合→RT | levi・ishaan・rohan・sofia・jay・sneha・amara・julian（根拠票）、beatriz（等級 E1〜E5）、camille（人手 hl-01〜38）、rafael | RT 33 件（1/10/22、判定変更 7）。E1 53 文書・URL 約 410 |
| `exploration/73` | 60〜72 を経営向け 1 枚 HTML に組み直す（操作者「読み物として難解」） | 10-11 | 再構成→独立レビュー→レンズ | sofia・rafael・aoi | 独立 29 件、レンズ 36 件 |
| `exploration/74` | 2 リポジトリ横断の知識体系の再整理＋投資家向けデッキ | 10-12 | R0→R1（6 席）→採否→R2（3 席） | beatriz（置き換え台帳 114・矛盾 97）、zoe（分類 112・用語集 28）、anjali（系譜 9 世代・殺した物語 14）、silas（数字 N-01〜99）、delphine（デッキ 18 枚）、aoi（設計書）。後段 rafael・corinne・dario | rafael 29 主張、corinne 食い違い 31、dario DR-01〜21 |
| `exploration/75` | 16 軸全値に 61 本の棄却ルールを当てる全数計数 | 10-12 | モデルのみ | Claude 単独（`models/space_v4.py`） | — |
| `reviews/76` | 中間報告後の進捗棚卸しとフォローアップ台帳 | 10-12 | R0→R1（5 席）→採否 | anjali・silas（数字の食い違い 14 行）・beatriz（Issue 35×成果物）・camille（人手 42 行・決裁 P-1〜5）・rafael | rafael 6 本（2/4） |
| `exploration/77` | 全体事業開発ナラティブ（AI を論拠から外す） | 10-13〜14 | R0→R1（4 席）→採否 D-1〜12→起草→RT→読者テスト | anjali・sofia・rohan・sneha、corinne（全文起草）、rafael、mira（初見読者 109 件） | rafael 40 本（6/24/10）。v1.1 105,426 字 → v2.0 51,175 字 |
| `research/india/79` | MERC DF&DSM 規則 2024 の生態系調査 | 10-16 | **S0〜S11**（research-study 同型） | beatriz（リード）、nadia（S0/S5/S8）、WS1〜5 に 10 席、S7 owen/astrid、S8 rafael・ingrid・kai・aoi | owen 75 行、astrid 54 項目、rafael 25 件、読者 99 件 |
| `research/india/80` | 住宅の「管理できる 1kW」に投資する ROI（6 経路の NPV/kW） | 10-17 | **S0〜S11＋SG-1〜4**、WS1〜6 | beatriz、nadia、WS に 9 席、S3c jay・sneha、S7 owen/astrid、S8 camille＋**名前の無い新席 5**（財務・コーポデベ・配電会社・売り手・住人）、rafael、corinne、読者 3 席 | S7 223 行、S8 142 件（高 35）。14 席・約 370 万トークン・取得約 310 回 |

さらに **promotion-entry**（09-25〜10-14）でも同じ使い方をした: 枠別 4 パネル→R2、11 名の労働資本審議、17 名の組織 4 象限（サーベイ A〜E → α「意味」β「一目で」γ「評価者の目」→ maya 審議 → R2 rafael・priya・celeste）、80 候補×2 採点者×5 項目（160 件）、面談の語り 25 本×4 役（100 件）。

### §2.2 繰り返し現れた仕事の型（20）

| # | 型 | 担った席 | 出現 |
|---|---|---|---|
| 1 | ブリーフ（R0/S0）: 今日の正・判断規則・席の割当・招集しない席と理由 | 操作者（Claude） | 全ラン |
| 2 | 論点ツリー・仮説・式の事前固定（PRISMA 方式） | beatriz | 79・80 |
| 3 | WS 分割・席の割当・クロール規約・ゲート・トークン見積 | beatriz | 71・79・80 |
| 4 | 一次出典の収集と URL 台帳（E1〜E5 等級、NOT FOUND 明記） | levi・vikram・rohan・jay・sora・sneha・sofia・amara・grace・julian・ishaan | 71・79・80 |
| 5 | 実名ターゲットの長短リストと深掘り（ベンダー 31・RWA 9・アグリゲーター 15） | jay・sneha、異議 julian・rohan | 80・69 |
| 6 | 再現可能な定量モデル（決定的・入力に出典 ID） | Claude。**モデル席は空席** | 62・66〜68・75・80 |
| 7 | 判定（4 値・仮説判定表・reopen-if） | 各研究席＋リード | 71・79・80 |
| 8 | 独立ファクトチェック（原典 PDF 照合） | owen・astrid | 79・80（352 行） |
| 9 | 反証（refuted/weakened/survived、差し替え文） | rafael | 8 ラン |
| 10 | 数字の統制（1 セット・使わない数字・食い違い表） | silas・corinne | 74・76・80 |
| 11 | 置き換え台帳・矛盾登録簿・用語集・系譜 | beatriz・zoe・anjali | 74、79・80・71 |
| 12 | 意思決定の討議と決定パッケージ | VP 10 席・maya・camille | 69 |
| 13 | 採否表（adjudication） | 操作者 | 74・76・77 |
| 14 | ストーリーライン・ナラティブ（統括 2 文・ghost deck・鎖と階段） | beatriz・nadia・corinne・delphine・anjali | 74・77・79・80 |
| 15 | クライアント価値・読者体験の査読 | nadia・ingrid・kai・aoi・mira | 73・77・79・80 |
| 16 | 立場別ステークホルダ査読（投資委員会・コーポデベ・配電会社・売り手・住人） | camille＋**名前の無い席** | 80 |
| 17 | 経営向け組み直し・HTML 化・公開（project-ind `/internal/` ミラー） | Claude・操作者・aoi・dario | 62・73・75・79・80 |
| 18 | 人手の最後の 1 マイルの切り出し（誰に・経路・門・英文 1 問・動く K） | camille・IC・beatriz | 69・71・76・80 |
| 19 | 進捗棚卸しと fail-loud（静かに期限切れした項目の検出） | beatriz・camille | 76 |
| 20 | 計測器の要件→デプロイ | elena・dario・mateo・petra・priya | 69 |

### §2.3 操作者（人）の仕事と規模

88 PR・393 コミット・+17.95 万行（PR #2〜#124）。マージ 86 件は全て操作者。1 ランあたり、人は **ブリーフ 1・採否 10〜40 件・マージ 1・公開 7 手順（2 リポジトリ直列）**。promotion-entry の山場（09-26〜10-07）は 11 PR・118 コミットに対し本人回答 47 件・手描き画像 13 枚。本人への質問 117 問のうち日付つき回答は 47 件で、**10-02 以降ほぼ未回答のまま生成だけ進んだ**。

操作者にしかできなかったこと: 名義の開示、上司への B-1（有償転換の立証水準）、弁護士 Q1〜Q3、PR マージ、Reddit・LinkedIn・施工店への接触、社内 3 問（H-5a/H-6/H-7）、L0/L1 の変更。環境の壁（reddit.com 取得不可、pmsuryaghar.gov.in 403、WebSearch 200 回上限）が約 4 時間の読みリストを人に残した。

---

## §3. アウトカムの定義と、アウトプットが決定に変わらなかった 6 つの断線

**アウトカムの物差し**（依頼主側の正本から転記）:

- 研修の評価 5 項目（`personal-goal:../docs/07_…研修概要（評価者向け・評価基準）.pdf` p6）: ①新しい情報に基づく環境理解（元の仮説を超えたか） ②「顧客」の捉え方（立場と人がイメージできる具体性） ③価値の新しさ（事業部初・自社初以上） ④価値の核心度（お金を払いたくなる欲求に訴えるか） ⑤展開可能性（Win-Win と収支）。
- 評価者への **3 つの問い**（同 p4）: 顧客は誰か／新しいのか／核心的（お金を払うレベル）か。発表 13 分・**質疑 15 分**・稼働 3 日前に事前配布。
- 上司フィードバックの現在有効な 10 要求（`reviews/38`）と、大企業管理者の 10 問（`foundation/55`）。未閉は **R-1「その価値に金が払われた証拠」（13 か月・6 回指摘）**と **R-10「日本側の事業判断に変換」**。

**6 つの断線**（それぞれが §4 の組織機能に対応する）:

| # | 断線 | 証拠 | 対応する機能 |
|---|---|---|---|
| D1 | **ラン横断の責任者がいない。** 議長は maya・priya・beatriz が持ち回り。貰った依頼を「費用に見合う 3 条件」に落とし、連作を通しで持つ席がない | 各 `00_brief.md` の作成者は操作者（Claude）。research-study は未 binding・operator 起動 | F1 統括 |
| D2 | **訂正が正本に戻らない。** 71 の訂正約 40 行は提案のまま（74 hand-off 7）。77（10-14）は「義務 ≈411MW、目標 41MW＝1 割」を核に置くが、2 日後の 79 は「411MW は使わない」とし、訂正の宛先は 63・71 だけで 77 に触れない。80 の SG-1「当社に入る決済経路 0 本」は 77 の「配電会社の正式な調達先になる」と緊張したまま | `exploration/79` §9.1・§10.2、`80/03_gates.md`、`74` §8 | F2 知識統合・裁定 |
| D3 | **数字が文書ごとに動く。** 9,000 万→900 万、1,01,815→101,815、9.1%→8.0%、母数 30〜70 → 19〜62 → 11〜27MW と 3 回、出資単価 ₹11〜522 → 40〜170 crore/kW。corinne 食い違い 31、silas 14 行。「母数の前提は S1 で固定すべきだった」（80 retro） | `71` §0-3、`74/01` §4.2、`76` 付録 A、`80/retro.md` | F3 数字の統制 |
| D4 | **👤 項目が流れない。** 57 の 👤8 件は閉 0、owner:human Issue 8 件全 open、PR #104 マージ後も `70` §7・`72` 実施ログは 0 行、`intake: open` 期限（10-12）後に窓が開いた記録なし。「止めているのは機械ではなく 3 つの記録が無いこと」 | `reviews/57`・`59`、`76` §0-4 | F6 決裁ブローカー、F7 アウトカム判定 |
| D5 | **レビューの指示を版に反映する役がいない。** 56 §4 の v13 反映指示 8 件は未執行（#71 open）、デッキ #56 未着手。Issues は 09-05〜07 の 3 日で 35 件起票されて以後ゼロ、63・69・73・75 の決定は 1 件も Issue に戻っていない | `reviews/56`、Issue #71、`76` §6 | F2・F13 |
| D6 | **読み手に届かず作り直し。** 73 は「難解」で再構成、77 は 1/2 に圧縮、公開は GitHub Pages → 翌日 project-ind ミラーへ戻した。promotion-entry の最終版は PowerPoint で人が手作り。採点者 2 名の相関 0.73・R2 は天井張り付き・実評価者の講評（「冗長」「専門語」「国内の解像度が低い」）はパネルが出していない | `77/01_adjudication.md` §5、`c487e14`→`d9c93d8`、`promotion-entry/…/MANIFEST.md` | F8・F9・F11・F12 |

---

## §4. 必要な組織機能 — 1+1 を 2 以上にする機構

「専門家を増やす」だけでは D1〜D6 は閉じない。閉じるのは **ラン横断で状態を持つ台帳と、それを守る席**である。下表の F1〜F14 のうち、太字が今回新設する席。

| # | 機能 | 具体的な行動 | 今あるもの | 判定 | 担う席（案） |
|---|---|---|---|---|---|
| F1 | **エンゲージメント統括** | 依頼を「費用に見合う 3 条件」と撤退線に落とす。S0〜S11＋SG ゲートを運用し、席を選び、ブリーフを書き、採否規則（新しい日付が勝つ・一次が勝つ・統制表に無い数字は入れない）で機械的に裁ける部分を裁く。retro の教訓 L-n を次ランの規則に足す | beatriz（手法の議長、デスク無し）、camille（操作者の注意台帳）、nadia（PR 専門） | **不足** | **margaux**（室長） |
| F2 | **知識統合・矛盾裁定・逆伝播** | 新ランの結論を *全ての* 現役正本（63・73・75・77…）に当て、影響節に訂正 PR を出す。置き換え台帳・矛盾登録簿・用語集・系譜・SSOT 索引・次番号を毎 PR 更新。未リンク文書と ID 衝突（H-5a/b、Go③×2、V-1 が 13 か所）を検出 | zoe（JD はワークフォース自身の記憶）、beatriz・anjali の流用 | **部分的** | **tariq**（司書） |
| F3 | **数字の統制（fact bank）** | 1 事実 1 表記。値・時点・出典・⚠/`*`・「使わない数字」を 1 セットで持ち、S1 で母数と分母を凍結、S9 で全文書を grep 照合 | silas（財務モデル）、corinne（単発） | **席がない** | **oksana** |
| F4 | **独立ファクトチェック** | 書いた席と別の席が確度「高」と感度上位の数字を原典 PDF で照合。訂正は等級が上のときだけ（L-1） | owen（SDET、本職はコード検証）、astrid（開示） | **不足** | **nikhil** |
| F5 | 反証（レッドチーム） | 主張ごとに 3 値、pre-mortem、差し替え文、モデル複製 | rafael（独立、8 ラン） | 概ね足りる。1 名のみ | rafael（現状維持。負荷は §11） |
| F6 | **決裁ブローカー（人手の最後の 1 マイル）** | 👤 項目を相手別 1 枚（誰に・経路・門・1 問・動く仮説・所要分）にし、日程と返答を台帳化、期限切れを週次で fail-loud。接触自体はしない | camille（決定パッケージは作る。追跡・記録の主体なし） | **不足** | **ines** |
| F7 | **アウトカム判定（公開前ゲート）** | 公開・納品の前に「3 つの問いに 1 枚で答えているか／V-1 の一次証拠は動いたか／求める決定（Q1）と日本側への変換（R-10）があるか」を判定。👤 ゲートが止まっているときは**新ランの起動を止める**（研究の肥大を防ぐ） | なし（76 が単発で実施） | **席がない** | margaux（判定）＋ ines（👤 状態） |
| F8 | 読者体験・平易化 | 専門外の読み手で通読し、用語・桁（lakh/crore）・単位・年度で止まる箇所を重さつきで全件拾う | nadia・ingrid・kai・aoi・mira | ある。査読規則化が未 | 現状席（research-study 改訂で S8 に固定） |
| F9 | **情報設計・公開エンジニアリング** | HTML・pptx・A3 を JSON から生成（手で直さない）、公開 7 手順の自動化、公開 6 文書すべてに検査、PowerPoint 実機忠実度の確認 | aoi（1 席、`last_run_status: throw`）、kai、ren。検査は 6 文書中 2 本 | **部分的** | **yusuf** |
| F10 | **立場別レンズの常設席** | 投資委員会・コーポデベ・配電会社の計画担当・売り手の創業者・住人/RWA・系統計画・モデル席を**名前のある席**で演じる | 80 で 5 席が「新席（名簿から割当）」のまま実行。WS2・S4 空席 | **不足** | **arjun**・**kavita**・**pranav**＋ jay/sneha/sofia の JD 追補 |
| F11 | **採点較正・評価科学** | ルーブリックと判定形式（✅🟡❌／3 値／4 値／素点／採否）を統一し横断集計可能にする。採点者間信頼性・天井効果を測り、実評価者の講評で較正 | tomas（組織指標）、dmitri（GA4 の外側ループ） | **席がない** | **dalia** |
| F12 | **日本側事業判断への翻訳** | 提案を日本の大企業の Go/NoGo・稟議の言葉に変換、カニバリと人の出所（55 Q8/Q9）、国内事業部・技術部門（SE 本部・SSDC・PEWIN）の KPI・領域、登用制度（等級・評価シート）の採点感覚 | なし（priya・dario を役で流用） | **席がない** | **haruto** |
| F13 | 実績・コスト・分類の基盤 | PROJECT 登録、パネル／レビュー／知識整理用のスキル名、engagement の正しいラベル（現状 271 件中 219 件が `daily-research`）、W-3 計測 | outsource-to-workforce（profile は pr-autopilot のみ）、record-engagement | **不足** | 基盤変更（§7） |
| F14 | 工程改善の歯車 | retro L-1〜L-11 を research-study の規則へ、ゲート記録、席どうしの食い違いをレッドチーム裁定へ回す | beatriz（research-sync） | ある。歯車が未接続 | beatriz ＋ margaux |

**1+1>2 が生まれる場所**（新設席の相互作用）:

- **oksana × tariq × nikhil**: 1 セットの数字（F3）→ 置き換え台帳で「どの文書がその数字を使っているか」（F2）→ 原典照合（F4）。D2・D3 の *3 本の矛盾* が **同じ週に同じ台帳で** 閉じる。今は 3 ランに分かれて別々に見つかっている。
- **margaux × ines**: ゲート記録（F1）と 👤 台帳（F6）が繋がると、F7 の「人のゲートが止まっているときに新ランを起動しない」が機械的に判定できる。研究が決定を追い越す D4 の構造を断つ。
- **dalia × rafael × 読者席**: 判定形式の統一（F11）で、レッドチームの 3 値・読者の重さ・立場席の採否が **1 つの表**に乗り、「どの指摘が結論を動かしたか」を retro で数えられる。
- **haruto × arjun × kavita**: 日本側の稟議（F12）・投資委員会（F10）・配電会社の計画担当（F10）という *3 人の払い手の目* が常設になり、R-10 と R-1 の両方に毎ラン当たる。
- **yusuf × aoi/kai**: JSON→HTML/pptx の生成を 1 本化すると、73・77 の「読めないから作り直す」を公開前に検査で捕まえられる。

---

## §5. 組織再編案

### §5.1 設計判断

- **新 VP か既存への組み込みか → 組み込み。** maya 直下は既に 13 名（org-benchmark round が「12 は多い」と指摘した後も増加）。室は **beatriz（VP Research）配下**に置く。research-study の議長は beatriz であり、室長が議長を引き継ぐことで beatriz は「手法の所有者」に戻れる。beatriz はこれまで実質 sora 1 名しか部下がおらず、VP に対して「デスクを持たない」状態だった。
- **フラットか室長＋室員か → 室長＋室員。** D1 は「決める権限のある 1 人」が無いことが原因。室員（oksana・tariq・pranav）は室長に報告、**nikhil（独立検証）だけは beatriz 直属**にして検証の独立性を保つ（rafael が maya 直属であるのと同じ理由）。
- **配置ルール（India round §3a を踏襲）**: 室の *手法* に属する席は室へ、**機能**に属する席は既存 VP へ正規化する。決裁ブローカーは camille（CoS）、情報設計は elena（CX、aoi/kai の居場所）、日本側翻訳は priya（People & Legal）、コーポデベは silas（Finance、julian の隣）、系統計画は anjali（India デスク、地域ルール）。
- **なぜベンチで賄わないか**: owen を S7 に使い続けると verification-sweep が薄くなる。zoe を依頼主の文書寿命管理に使うと memory-hygiene の対象（ワークフォース自身の記憶）と混ざる。corinne・silas の数字統制は単発では効いたが、台帳を *持ち続ける* 主体が要る。aoi は 1 席で `throw` 状態のまま 4 ランで使われている。

### §5.2 組織図（差分のみ。[ ] は計画予算 USD/月）

```
maya President
├ beatriz VP Research
│  ├ sora Researcher（既存）
│  ├ **margaux  Program Director, Client Studies Office [10]**   ← 室長
│  │   ├ **oksana  Numbers Controller & Fact-Bank Steward [7]**
│  │   ├ **tariq   Knowledge Integration Librarian [7]**
│  │   └ **pranav  Quantitative Modelling Engineer [7]**
│  ├ **nikhil  Independent Research Verifier [7]**               ← 独立（室長の下に置かない）
│  └ **dalia   Evaluation & Calibration Scientist [6]**
├ camille Chief of Staff
│  └ **ines    Decision Broker, Human Last Mile [7]**
├ elena VP CX
│  └ **yusuf   Information Design & Publishing Engineer [8]**     （aoi・kai と横並び）
├ priya VP People & Legal
│  └ **haruto  Japan Corporate Decision Translator [7]**
├ silas VP Finance
│  └ **arjun   Corporate Development & Investment Committee Lens [6]**（julian・corinne と横並び）
└ tessa VP Policy ─ anjali Research Director, India Desk
                      └ **kavita  Grid Planning & DISCOM Operations Lens [6]**
```

### §5.3 既存席の変更（すべて権限 B・1 名 1 変更・本書では実行しない）

| 対象 | 変更 | 理由 |
|---|---|---|
| beatriz | `research-study` の binding を margaux へ移す。beatriz は `research-sync`（手法）を保持 | 議長と手法所有者の分離 |
| camille | ines を report に加える。境界: camille＝操作者が *今週決めること* の順位（内向き）、ines＝依頼主の *人のゲート* の台帳（外向き） | vp-operations round が警告した「第 2 の注意台帳」にならないよう明文化 |
| owen | research-study S7 の役を外し、verification-sweep に専念 | 本職はコード検証 |
| zoe | 依頼主コーパスの置き換え台帳・矛盾登録簿を tariq へ。memory-hygiene に専念 | JD の対象はワークフォース自身の記憶 |
| aoi | `last_run_status: throw` の解消を yusuf 着任の受け入れ条件に含める | 4 ランで `throw` のまま使用 |
| jay / sneha / sofia | JD に「立場レンズ」を追補: jay＝IoT ベンダー創業者の目、sneha＝住人・RWA 委員会の目、sofia＝払い手の目 | 80 S8 の無名席のうち 3 つはこの 3 名で名前が付く |
| nadia | personal-goal PROJECT の `owner_agent` は margaux（nadia は PR レーンを持ち続ける） | nadia は予算超過かつ PR・Issue・backlog を一手に |

---

## §6. 新設ポジション — JD

共通: モデルは `anthropic:claude-sonnet-4-6`、`default_project` は後述の `personal-goal`（§7.1）、`bindings: []` で登録し cadence は §7.3 で後付け、`owner_email: null`。全席とも **接触禁止**（外部の人・組織に自分では連絡しない）、**L0/L1 の編集禁止**、**決裁・支出・公開可否の判断は操作者**。各席に ADR-0045 方式の kill 期限を付す（本ラウンドの投機性は中程度なので **2027-01-31**。期限までに §9 の受け入れ基準を満たさない席は閉じる）。

### 6.1 `margaux` — Margaux Delacroix / Program Director, Client Studies Office

- **報告先** beatriz ／ **居住地** Singapore, SG（インドのデスクと日本の依頼主の間に立つ）／ **USD 10**
- **一行ミッション**: 外部依頼主の数か月にわたる調査エンゲージメントを通しで持ち、依頼を「費用に見合う 3 条件」と撤退線に落とし、S0〜S11 とステージゲートを運用し、納品物が *決定* に変わるところまで責任を負う。
- **責務**
  1. ブリーフ（R0/S0）を書く: 操作者の原文、今日の正（どの文書が勝つか）、判断規則、席の割当と JD 照合、招集しない席と理由、出力書式。
  2. ワークプラン（S2）: 仮説→WS→席、クロール規約、ゲート G0〜G11・SG-1〜4、トークン見積（例: 80 は見積 300〜450 万に対し実績 370 万）。
  3. 採否（adjudication）のうち規則で裁ける部分（新しい日付が勝つ・一次が勝つ・統制表に無い数字は入れない）を裁き、**新しい賭けの選択だけ**を操作者に上げる。
  4. **アウトカム判定（F7）**: 公開・納品前に「3 つの問いに 1 枚」「V-1 の一次証拠」「求める決定 Q1 と R-10」を判定し、👤 ゲートが止まっているときは新ランを起動しない。
  5. retro（S11）を書き、教訓 L-n を research-study の規則提案（Zone A の PR 案）に変換する。
  6. 室員（oksana・tariq・pranav）の週次の台帳同期を主宰し、席どうしの食い違いを rafael の裁定に回す。
- **成功指標**: 全ランに `00_brief`・ゲート記録・retro がある／S9 の訂正が *全ての* 現役正本に逆伝播された記録がある（tariq と共同）／👤 ゲート停止中に新ランを起動した回数 0／納品物が「3 つの問いの 1 枚」を持つ比率 100%。
- **境界**: beatriz＝手法の所有者（research-sync）、margaux＝運用。nadia＝PR レーンの所有者、margaux＝調査の所有者。camille＝操作者の注意、margaux＝依頼主のゲート。
- **Explicitly not**: 自分で調べ物を書かない（席に書かせる）。レッドチームをしない。公開しない（yusuf）。
- **guardrails**: 新しい数字を作らない。L0/L1 を編集しない。接触しない。
- **Speculative — kill by 2027-01-31**（1 本の連作を S0〜S11 で通し、§9 の基準を満たさなければ閉じる）。

### 6.2 `oksana` — Oksana Petrenko / Numbers Controller & Fact-Bank Steward

- **報告先** margaux ／ **居住地** Warsaw, PL ／ **USD 7**
- **一行ミッション**: 依頼主のコーパス全体で「1 つの事実に 1 つの表記」を守る fact bank を持ち、母数と分母を S1 で凍結させ、公開前に全文書を照合する。
- **責務**: fact bank（値・時点・出典・等級・⚠/`*`・使わない数字）の維持（74 の N-01〜99 を起点に移管）／S1 で母数・分母・為替・年度を凍結しゲート記録に残す／S9 で全現役文書を grep 照合し食い違い表を出す（76 付録 A・corinne 31 件の型）／桁・表記（lakh/crore、1,01,815）・分子分母混在（9.1%→8.0%）の検出規則を持つ／silas の財務モデルと値を突き合わせる。
- **成功指標**: 公開文書の数字の食い違い（公開後に見つかったもの）0／S1 凍結の記録率 100%／fact bank の各行に出典 ID。
- **境界**: silas＝財務モデルの正、oksana＝全領域の数字の表記と整合。rafael＝主張の反証、oksana＝値の整合。
- **Explicitly not**: 数字を推計しない（席が出した値を統制する）。モデルを作らない（pranav）。
- **Speculative — kill by 2027-01-31**。

### 6.3 `tariq` — Tariq Haddad / Knowledge Integration Librarian

- **報告先** margaux ／ **居住地** Amman, JO ／ **USD 7**
- **一行ミッション**: 依頼主側の知識体系（置き換え台帳・矛盾登録簿・用語集・系譜・SSOT 索引）を常設で維持し、新しいランの結論を全ての現役正本に **逆伝播**させる。
- **責務**: 74 の置き換え台帳 114・矛盾 97・用語集 28 を引き継ぎ、毎 PR で更新／各ランの S9 で「この結論が影響する現役文書と節」を列挙し、訂正 PR（または hand-off 行）を出す（79→77 の欠落を埋める役）／SSOT 索引・次番号・冒頭注記を維持（「次に振る番号: 79」の放置を検出）／ID 衝突（H-5a/b、Go③×2）、同じ問いの多重管理（V-1 が 13 か所）、未リンク文書（`reports/インド住宅エアコン接続ベース.md`）を検出／決定（63・69・73・75）を Issue に戻し、成果物のある Issue（#68〜#71）を閉じる提案を出す。
- **成功指標**: 新ランの結論が影響する正本のうち、訂正が入ったか hand-off 行になったものの比率 100%／未リンク文書 0／矛盾登録簿の未裁定行が 2 週間を超えない。
- **境界**: zoe＝ワークフォース自身の記憶（memory-hygiene）、tariq＝依頼主コーパス。oksana＝値、tariq＝文書の状態と関係。
- **Explicitly not**: 正本の結論を変えない（採否は margaux・操作者）。L0/L1（SEGMENTS.md・GOVERNANCE・ADR）を直接編集しない。
- **Speculative — kill by 2027-01-31**。

### 6.4 `pranav` — Pranav Kulkarni / Quantitative Modelling Engineer

- **報告先** margaux ／ **居住地** Pune, IN ／ **USD 7**
- **一行ミッション**: 80 の「空席のモデル席」を埋める。決定的で再現可能な定量モデル（NPV/kW、全数計数、24 か月エンジン、感度・トルネード）を、入力に出典 ID を付けて作り、SG-3 で凍結する。
- **責務**: `models/*.py` 系の設計・実装・凍結、乱数の種固定、JSON 出力→HTML 生成への受け渡し／fact bank（oksana）の値だけを入力にする／rafael がモデルを複製して入力を振れるようにインターフェースを公開する／構造を変えたときは retro に残す（SG-3）。
- **成功指標**: 全モデルが再実行で同一出力／入力の 100% に出典 ID／レッドチームの再計算要求に 1 営業日で応答。
- **境界**: silas＝財務モデルの前提と判断、pranav＝実装と再現性。tobias（分析基盤）＝ワークフォース内部のデータ基盤。
- **Explicitly not**: 前提を自分で選ばない。結論を書かない。
- **Speculative — kill by 2027-01-31**。

### 6.5 `nikhil` — Nikhil Raman / Independent Research Verifier

- **報告先** beatriz（室長から独立）／ **居住地** Chennai, IN ／ **USD 7**
- **一行ミッション**: 書いた席と別の席として、確度「高」と感度上位の数字・条文・日付を原典（官報 PDF・命令・年次報告）で照合し、一致／不一致／確認不能に分ける。訂正は根拠の等級が既存より上のときだけ提案する（79 retro L-1）。
- **責務**: S7 の独立ファクトチェック（79・80 で owen/astrid が担った 352 行の型）／E1〜E5 等級の付与と、二次で一次を上書きしない規律の執行／不一致を oksana（値）と tariq（文書）へ振り分け／取得不能（403・paywall）を理由つきで記録し、人の読みリストに落とす。
- **成功指標**: 公開後に第三者が見つけた一次出典の誤り 0／照合対象の選定基準（確度・感度）が記録されている／訂正提案の 100% に等級の比較が付く。
- **境界**: rafael＝主張の論理と反証、nikhil＝事実の照合。astrid＝開示と標準の作法（相談先）。owen＝コードの検証に戻る。
- **Explicitly not**: 結論の是非を論じない。レンズ査読をしない。
- **Speculative — kill by 2027-01-31**。

### 6.6 `dalia` — Dalia Mansour / Evaluation & Calibration Scientist

- **報告先** beatriz ／ **居住地** Cairo, EG ／ **USD 6**
- **一行ミッション**: パネル・レッドチーム・読者席・立場席の判定形式を 1 つの表に揃え、採点者間の信頼性と天井効果を測り、実在の評価者の講評で較正する。
- **責務**: 判定形式の統一スキーマ（3 値／4 値／✅🟡❌／素点／採否→共通の重さと「結論を動かしたか」フラグ）／採点者ペアの相関・平均差・最大差を毎回算出（promotion-entry 10-04 の 0.73・2.05・7 が基準線）／実評価者の講評（例: 面談講評の「冗長」「専門語」「各論」）とパネル指摘の一致率を測り、欠けているレンズを margaux に報告／GROWTH.md の多判定者モデル（judge panel）と整合を取り、dmitri（reader-signal）・tomas（org-metrics）と指標を共有。
- **成功指標**: 全ランの査読結果が共通表に載る／採点者間相関の推移が retro に出る／実評価者講評との不一致レンズが次ランの席割当に反映された記録。
- **境界**: tomas＝組織の指標、dalia＝査読の計測。ingrid＝記事の judge 運用。
- **Explicitly not**: 自分で採点しない。ルーブリック本文（Zone A）を書き換えない（提案のみ）。
- **Speculative — kill by 2027-01-31**。

### 6.7 `ines` — Inés Carvalho / Decision Broker, Human Last Mile

- **報告先** camille ／ **居住地** Lisbon, PT ／ **USD 7**
- **一行ミッション**: Web で閉じない 👤 項目を「誰に（役職＋組織）・経路・門・1 問・動く仮説・所要分」の相手別 1 枚に落とし、日程と返答を台帳に記録し、期限切れを週次で fail-loud する。接触は一切しない。
- **責務**: 👤 台帳の常設（57 の 👤8、59 の H-1〜H-10、72 の hl-01〜38、76 の人手 42 行、80 の ①〜⑲ を 1 本に統合）／相手別 1 枚（上司の B-1、弁護士 Q1〜Q3、社内 H-5a/H-6/H-7、施工店、Reddit）の起草と更新／返答を受けたら「どの仮説・K が動いたか」を tariq・oksana へ流す／期限切れ・記録 0 行・「済と申告」が記録になっていない項目を検出し、week の先頭で操作者に 1 件ずつ出す／margaux の F7 判定へ「人のゲートの状態」を供給。
- **成功指標**: 👤 項目の閉率（過去 3 か月 0/8 が基準線）／期限超過の未検出 0／返答の台帳化までの遅延 ≤ 2 日。
- **境界**: camille＝操作者の全決定の順位（内向き・週次）、ines＝依頼主の人のゲート（外向き・項目単位）。jay/sneha/vikram＝文面の専門性、ines＝台帳と催促。
- **Explicitly not**: 外部に連絡しない（C-3）。採否を決めない。
- **Speculative — kill by 2027-01-31**（3 か月で閉率が動かなければ、席ではなく操作者側の時間の問題と判定して閉じる）。

### 6.8 `yusuf` — Yusuf Demir / Information Design & Publishing Engineer

- **報告先** elena ／ **居住地** Istanbul, TR ／ **USD 8**
- **一行ミッション**: 正本（md・JSON）から HTML・pptx・A3 を *手で直さず* 生成し、公開 7 手順を自動化し、公開物すべてに検査を付け、PowerPoint 実機忠実度まで確認する。
- **責務**: `make_80_html.py`・`check_map.py`・`check_report.py`・`pr_build.py`（869 行）・renderer 群（約 6,000 行、審議ごと使い捨て）を部品化して 1 本の生成系へ／PUBLISHING（personal-goal `main` → project-ind `/internal/`、`mirrors.json`）の自動化と、公開 6 文書すべてへの検査／A3・pptx の情報設計（回転文字・多角形・容量）と実機レンダリング確認／aoi（設計の体系）・kai（表記）の規則を生成系の lint に落とす／research-study G10（HTML の存在）の中身を「読める」まで引き上げる。
- **成功指標**: 公開前に「読めない」で差し戻された回数 0／公開物の検査カバー率 100%（現状 2/6）／提出物を人が手で作り直した回数 0（現状 1）。
- **境界**: aoi＝設計判断、kai＝声と表記、yusuf＝生成・検査・公開の機械。ren＝ワークフォースの SPA ビルド。
- **Explicitly not**: 内容を書き換えない。公開可否を決めない。
- **Speculative — kill by 2027-01-31**。

### 6.9 `haruto` — Haruto Shimizu / Japan Corporate Decision Translator

- **報告先** priya ／ **居住地** Osaka, JP ／ **USD 7**
- **一行ミッション**: 調査の結論を、日本の大企業の意思決定（稟議・事業部の Go/NoGo・登用制度）の言葉と手続きに変換し、R-10「日本側の事業判断に変換」と「国内の解像度が低い」を閉じる。
- **責務**: 55 の 10 問（特に Q8 誰の人か・Q9 カニバリ・Q10 不確実性の持ち手）を国内の組織図・KPI・予算サイクルに当てた「決裁者の内心」の更新／国内事業部・技術部門（SE 本部・SSDC・PEWIN・ATIC）の KPI・領域・既存企画の有無（H-7）を一次資料で押さえ、カニバリと人の出所を具体名で埋める／登用制度（等級・評価シート・面談）の採点感覚を実在講評で較正し、提出物に講評を付ける（dalia と共同）／「否定でなく代案を伴う」「素朴な問い」の経営会議参加スタイル（ATIC 09-29 の要望）の設計。
- **成功指標**: 納品物の 100% に「日本側の求める決定（Q1）」と「誰の予算・誰の人か（Q6/Q8）」の 1 枚が付く／実評価者講評とパネル指摘の一致率（dalia 測定）の改善／R-10 のクローズ。
- **境界**: priya＝ワークフォース自身の人事と法務、haruto＝依頼主側の日本企業の判断様式。tessa/anjali＝インドの制度、haruto＝日本の社内。
- **Explicitly not**: 社内の人に接触しない。人事評価そのものを行わない。
- **Speculative — kill by 2027-01-31**。

### 6.10 `arjun` — Arjun Nair / Corporate Development & Investment Committee Lens

- **報告先** silas ／ **居住地** Mumbai, IN ／ **USD 6**
- **一行ミッション**: 80 S8 ①②で無名だった「投資委員会」と「コーポレートデベロップメント」の目を常設にする。ハードルレート・為替・段階投資・期待損失を円で、タームシートのどの条項で制御権を取るかで査読する。
- **責務**: 出資・JV・少数持分の案に対し、MCA 提出物と評価額報道の等級、減損例、FDI の条番号、タームシートの制御権条項（取締役指名・拒否権・情報権・ドラッグ/タグ）で査読／投資委員会の視点で「S-C で損をするとき円でいくらか」「撤退線は誰が引くか」を必ず問う／julian（資本構造）・silas（モデル）と値を共有し、oksana の fact bank に出典付きで登録。
- **成功指標**: 出資・提携を含む納品物の 100% にこの 2 レンズの査読が付く／査読で見つけた「円での期待損失」未記載 0。
- **境界**: julian＝資本をどう組むか（構造）、arjun＝委員会がどう見るか（査読）。corinne＝IR（投資家への語り）。
- **Explicitly not**: 投資判断をしない。接触しない。
- **Speculative — kill by 2027-01-31**。

### 6.11 `kavita` — Kavita Rao / Grid Planning & DISCOM Operations Lens

- **報告先** anjali（India デスク、地域ルール）／ **居住地** Nagpur, IN ／ **USD 6**
- **一行ミッション**: 80 WS2 で空席だった「系統計画の席」と S8 ③の「配電会社の計画担当」の目を常設にする。ARR の読み方（承認額と回収総額の区別）、DSM 費の計上、系統蓄電池の容量料金（₹/kW/年）、配電設備の ₹/kVA 原価を扱う。
- **責務**: 配電会社の計画担当として「この kW は蓄電池・配電増強と比べて買うか」を原価で査読／MYT・料金命令・DF/DSM-CC 議事録を条番号まで引き、草案と最終を区別（levi/vikram と分担）／DFPO の義務 MW・分母・年度を oksana と凍結／rohan（補助・プログラム経済）と境界を保つ: rohan＝お金の流れと買い手、kavita＝系統と原価。
- **成功指標**: 配電会社の便益を扱う納品物の 100% に原価比較が付く／義務 MW・分母の食い違い（411MW 問題）の再発 0。
- **境界**: rohan＝DISCOM の財務・補助、amara＝市場横断の系統技術、ishaan＝中央制度、kavita＝州の配電会社の計画と原価。
- **Explicitly not**: 政策提言を書かない。接触しない。
- **Speculative — kill by 2027-01-31**。

---

## §7. スキル・基盤の変更（席と同時に要る）

### 7.1 personal-goal を PROJECT として登録（Zone B）

`workforce/projects/personal-goal/project.json`（`github: refluster/personal-goal`、`owner_agent: margaux`、`credential_types: ["github.token"]`）。手順は `docs/runbooks/external-project-onboarding.md`。効果: research-study が起動できる、engagement の `project_id` が正しくなる、**W-3 の計測に乗る**（現状は silas が「cost_this_month が $0 のまま」と指摘）。PAT の発行と Secrets Manager 登録は操作者。

### 7.2 審議プロファイルの移植（Zone B）

personal-goal 側 `.claude/skills/outsource-to-workforce/profiles/` にある 9 本（research-brief・evidence-sprint・kill-ledger-evidence・knowledge-refactor・investor-deck・progress-review・sheet-brainstorm・dashboard-build・pr-review）を本リポジトリの同スキルへ移す。本リポジトリ側は現在 `pr-autopilot` の 1 本のみ。

### 7.3 cadence の新設（`cadence-forge` で scaffold。初版は権限 A、cron 有効化は権限 B。SKILL.md は Zone A）

| skill | 席 | 周期 | 中身 | 書き込み先 |
|---|---|---|---|---|
| `study-program-gate` | margaux | 週次 | 進行中エンゲージメントのゲート記録・👤 状態・アウトカム判定・新ラン起動可否 | personal-goal `reviews/`（PR） |
| `human-gate-ledger` | ines | 週次 | 👤 台帳の同期、期限切れ検出、相手別 1 枚の更新、操作者への 1 件ずつの提示 | 同上＋Discord 1 通（chat-notification-policy 準拠） |
| `fact-bank-sync` | oksana | 週次＋S9 | fact bank の更新と全現役文書の照合、食い違い表 | personal-goal（PR） |
| `knowledge-ledger-sync` | tariq | 週次＋S9 | 置き換え台帳・矛盾登録簿・索引・次番号、逆伝播の hand-off 行、Issue 戻し提案 | personal-goal（PR）＋ Issues |
| `panel-review` | オンデマンド | — | 多席パネル（R1/R2、α/β/γ、採点）の正式なスキル名。engagement の `daily-research` 代用をやめる。dalia の共通表に結果を書く | 依頼主リポジトリ（PR） |

R-N11（キューの生産側と消費側を同じプロジェクトに同時に結ぶ）に注意: `human-gate-ledger` が出す「操作者への提示」は camille の `attention-ledger` が消費する側に当たるので、同じ週に結ぶ。

### 7.4 `research-study` の改訂（Zone A・別 PR・`meta.json` version bump）

79・80 の retro L-1〜L-11 を規則化する: S1 で母数・分母・為替・年度を凍結（oksana）／S8 のレンズは**名前のある席**のみ（無名「新席」禁止）／S9 に「影響する全現役正本への逆伝播」を工程として追加（tariq）／S11 に「3 つの問いに 1 枚・V-1・Q1/R-10」のアウトカム判定を追加（margaux）／S7 は書いた席と独立（nikhil）／二次出典で一次を上書きしない（L-1）。

---

## §8. 予算（W-3）

| 項目 | USD/月 |
|---|---|
| 現在の上限 | 600 |
| 58 名の計画値合計（live） | 343 |
| モデル上の消費（10 月、月換算。live） | 約 478 |
| 本ラウンド 11 席の計画値 | **+78**（margaux 10、yusuf 8、oksana・tariq・pranav・nikhil・ines・haruto 各 7、dalia・arjun・kavita 各 6） |
| 計画値合計（登録後） | 421 |

**計画値では上限内。改正は不要。** ただし次の 2 点から **600 → 800 の改正を別 PR（Zone A、`governance.md` §2 改正表＋`agent-config.ts:W3_BUDGET_CAP_USD` 同時）で推奨**する:

1. semi-value 型のランは operator セッション実行（R-N1(b)）のため **W-3 の計測外**。80 は 1 ランで約 370 万トークン。§7.1 の PROJECT 登録で計測に乗せると、月 2〜4 ラン分（モデル上 USD 60〜150 程度と見積。実測は登録後）が新たに台帳に現れる。
2. 既に消費が 478/月で、新席の cadence（週次 4 本）を足すと 600 に近づく。

目安超過（dario・freya・grace・ingrid・nadia・ren、FU-041）の見直しは本ラウンドの範囲外。

---

## §9. ロールアウト順序と受け入れ基準

**第 1 波（基盤。席の登録前にできる）**: §7.1 PROJECT 登録、§7.2 プロファイル移植、`panel-review` スキル初版。受け入れ: personal-goal の次のパネル engagement が `panel-review` ラベルで記録される。

**第 2 波（室の核）**: margaux・oksana・tariq・nikhil を登録。`study-program-gate`・`fact-bank-sync`・`knowledge-ledger-sync` を scaffold。受け入れ: (a) 71 §3 の訂正約 40 行と 79 §10.2 の訂正が 61/62/63/**77** に逆伝播されるか hand-off 行になる、(b) fact bank が 74 N-01〜99 を引き継ぎ、411MW／41MW／母数の 3 件が 1 表記に閉じる、(c) 次の S0〜S11 ランで無名の席が 0。

**第 3 波（機能席）**: ines・yusuf・haruto・dalia・arjun・kavita を登録。受け入れ: (a) 👤 台帳が 1 本に統合され、期限切れ項目が週次で操作者に出る、(b) 公開 6 文書すべてに検査がある、(c) 次の納品物に「日本側の求める決定」1 枚と、投資委員会・配電会社レンズの査読が付く、(d) 査読結果が共通表に載り、採点者間相関が retro に出る。

**全体の kill 判定（2027-01-31）**: 上の受け入れ基準に加え、**👤 項目の閉率が 0/8 から動いたか**、**R-1（金が払われた証拠）に向けた一次証拠の記録が 1 行以上あるか**。両方 No なら、組織の問題ではなく操作者側の時間配分の問題と判定し、第 3 波の席を縮める。

- [ ] 登録バンドル `workforce/seed/client-studies-office/`（`{slug}.json`・`{slug}-system.md`・`register.mjs`・README）。S19（`role` と system prompt 見出しの役職の完全一致）に注意
- [ ] `workforce/projects/personal-goal/project.json` と PAT
- [ ] プロファイル 9 本の移植
- [ ] cadence 5 本の scaffold（cadence-forge）
- [ ] `research-study` 改訂 PR（Zone A）
- [ ] W-3 改正 PR（Zone A）— 推奨、操作者判断
- [ ] §5.3 の権限 B 変更を 1 名ずつ `PATCH /agents/{slug}`

---

## §10. このラウンドに入れないもの（と理由）

- **2 人目のレッドチーム**: rafael は 8 ラン・personal-goal 16 件で足りている。dalia の計測で負荷と品質の低下が見えてから。
- **英語版エディター・2 人目の DS・質的研究者**（過去ラウンドの持ち越し）: semi-value の 3 か月に現れていない。
- **ATIC・SSDC 向けの「最初の 1〜2 体」立ち上げ・派遣カリキュラム**: 外部要望として実在する（09-29 会議録）が、別の依頼主・別のラウンド。haruto の経営会議スタイル設計で接点だけ持つ。
- **maya 直下 13 名の是正**: 本ラウンドは maya の直下を増やさないが、減らしもしない。別の組織ラウンド。
- **idle 席（delphine・hana・marisol・nico・noor・odette・theo・yara）の再設計**: 範囲外。ただし delphine（資金調達の物語）は 74 のデッキで使われており、arjun と隣接する。
- **既存 11 名（DDB のみ、seed 無し）の seed 復元**: 範囲外。

---

## §11. 操作者への未決の問い

1. 11 席を全部採るか、第 2 波（室の核 4 席）だけ先に採るか。
2. margaux のモデルを Sonnet 4.6 で始めるか、採否の質を優先して Opus にするか（maya 以外に Opus の席はない）。
3. W-3 を 600 → 800 に上げる別 PR を出してよいか（計画値では不要、計測に乗せる前提では推奨）。
4. personal-goal の PAT 発行と Secrets Manager 登録の時期。
5. ines の置き場所: camille 配下（本案）か、室（margaux）配下か。
6. haruto の置き場所: priya 配下（本案）か、室配下か。日本側の社内情報をどこまで一次資料として渡せるか。
7. People-ops review（theo）と VP パネル（beatriz・silas・elena・priya・camille）を招集して本書を査読させるか。

---

## §12. バイアス開示

本書は操作者セッションの Claude が、semi-value・promotion-entry・workforce の棚卸し 3 本（うち 2 本は personal-goal の読み取り、1 本は本番 API の読み取り）を元に起草した。semi-value の作業は 2026-09-13 以降に偏っており、8 月の outline v3〜v12 期のレビュー（16・25〜39）は REST で補った要約に依る。「席が無い」判定は seed・JD・live binding に基づくが、DDB のみの 11 名の JD は API の `role` と `jd` の要約から読んだ。新設席の人数と予算は、過去ラウンド（India 7 席／org-benchmark 9 席）の規模感に合わせたもので、必要最小限ではなく「断線 D1〜D6 を同時に閉じる」構成を優先した。
