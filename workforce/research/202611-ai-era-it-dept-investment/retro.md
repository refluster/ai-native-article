# S11 納品・記録・振り返り (retro)

- 調査: AI 時代の企業 IT 部門の先行投資 — 熟議の 9 到達点の外部検証 (`workforce/research/202611-ai-era-it-dept-investment/`)
- 納品物: `report.md` v2.1 (本文 75,030 字、図表 18 点、情報源 136 件 = 外部 134 (一次 88 / 準一次 30 / 二次 16) + 内部 2、引用 104 件、仮説 24 件に判定 + 確度)、`report.html` (自己完結、ライト / ダーク / スマホ幅で検証)
- 納品経路: draft PR [refluster/ai-native-article#871](https://github.com/refluster/ai-native-article/pull/871)、`autopilot:off`。本リポジトリには `.claude/skills/research-report` の慣例が無いため、`publish-study.mjs` は `--dry-run` のガード検査 (G1–G10) にのみ使い、PR は operator セッションの通常の枝で開いた。
- 終端状態: **DELIVERED** (G11: draft PR 開、実績登録は本ファイル末尾、教訓 ≥3)

## 実行形態 (正直な記載)

全 12 段階を 1 つの operator セッション (Claude Code、リード役 = Fable 5.1) が運び、各座席はサブエージェント (Opus 5.5) に役割演技させた。ワークフォースが自律で発火したものではなく、EventBridge や agent-runner は経由していない。API 上の `execution_surface` は `client` に強制される。熟議の 4 参加者 (mateo, freya, anjali, yuki) は仮説の提出者として記録し、判定には座らせなかった。

| 段階 | 実行主体 | 主な成果物 | ゲート結果 |
|---|---|---|---|
| S0–S2 | lead (margaux 役) | brief / issue-tree / workplan / process-design | Go |
| 手法調査 | Opus ×1 (178k tokens) | process/professional-practices.md (P-1〜P-35) | — |
| S3 | Opus ×8 並列 (WS1–8) | sources/ws1–8.md、register.md (機械統合) | Go (NOT FOUND 明記) |
| S4–S5 | lead | analysis.md、storyline.md | Go |
| S6 | Opus ×1 (ingrid 役) | report.md v1 (39.9k 字、30 図) | Go (機械ゲートのみ) |
| S7 | Opus ×1 (nikhil + owen 役、305k tokens) | factcheck.md (236 主張、94 件を一次で再開封、必須修正 17) | 修正へ |
| S8 | Opus ×1 (5 座席、200k tokens) | panel-r1.md (44 所見: blocker 3 / major 30 / minor 11)、lead が AH-1〜6 と T-1 に回答 | **Recycle** |
| S10 準備 | Opus ×1 (yusuf + aoi 役、207k tokens) | build/figures.mjs (30 図の描画器)、90 枚のスクリーンショット検査 | — |
| S9 | Opus ×1 (ingrid + oksana 役) | report.md v2 (統括答えの二層化、30→18 図)、changelog.md | Go |
| S7 R2 | Opus ×1 (198k tokens) | factcheck.md §9 (44 主張、必須修正 10) | 修正へ |
| S9 R2 | 同上エージェント再開 | report.md v2.1 | Go (ラウンド上限 2 で終了) |
| S10 | lead | report.html、図 0-1 のグリッド修正 | Go |
| S11 | lead (ines 役の問いを含む) | 本ファイル、engagements.json | Go |

## 統括答えがどう変わったか (ゲートが捕まえた欠陥)

v1 の統括答え「土台 4 点を一チーム一作業と**同時に**敷く」は、S8 のレッドチーム (rafael) が「必要性は耐えたが順序は証拠が無い」と崩し、二層 (全社の最小線を一斉に / 一チームの深い線を同時に / 後段は第三者が数えてから、順序の最適性は未検証) に書き直した。S7 は「制度 3 系統が同じ 4 要素を求める」という v1 の主張を本書自身の図 4-1 と突き合わせて落とし、EU AI Act の適用範囲 (高リスク限定、Art.4/50 の例外)、Ancker の効果量の単位 (IRR)、個人情報保護法の条番号、白書の欠落区分 (「わからない」7.4%) を正した。

## 教訓 (≥3、どのテンプレート / ゲートを変えるか)

| # | 教訓 | 変えるもの |
|---|---|---|
| L1 | 統括答えの中の **順序・時期の句** は、必要性の句と同じ確度を装いやすい。v1 は D3「支持・高」(必要性) を「同時に敷く」(時期) の根拠に流用していた | **G5** に「統括答えの各句 → 立つ仮説 ID と確度」の対応表を必須にする。句ごとに確度が違えば文を分ける |
| L2 | 本文の主張と図の DATA が食い違っても、機械ゲート (G6) は引用 ID の解決しか見ない。「3 制度が同じ 4 要素」は図 4-1 の空欄と矛盾したまま S7 まで残った | **G6** に oksana の grep 照合 (本文の数値・主張 ↔ 図 DATA ↔ 判定表) を前倒しする。S9 だけでなく S6 で走らせる |
| L3 | 図表リストを S5 で 30 点まで膨らませ、S8 で 12 点を削った。「図が場所を稼いでいるか」の判定が遅すぎた | **G5** に aoi の読者体験レビューを入れ、図の上限 (本文 1 万字あたり 3 点を目安) と「本文に無い情報を持つ図だけ残す」基準を置く |
| L4 | 編集者が図の type 名を発明し (15 種)、描画器が追随する形になった。契約が先に無かった | storyline テンプレートに **FIG DATA 契約** (許される type と JSON 形) を同梱する。未知の type はビルドで fail loud (今回修正済み) |
| L5 | Gartner / Forrester / McKinsey / ISO / RAND / meti.go.jp / EUR-Lex がこのセッションから 403/503。確度 B/C への格下げは機能したが、WS の探索予算を無駄にした | **S2** に到達性のプリフライト (主要ドメインを 1 回ずつ HEAD) を入れ、届かないドメインは最初から二次経由と決めて予算を配る。研究基準として「ミラー PDF で確認した一次」の確度を B と固定する |
| L6 | lead 自身の集計 (判定・確度の数) が 2 回ずれ、S7 が拾った | **G4** の集計を verify スクリプトで機械化する (今回の `verify.mjs` を skill に同梱) |
| L7 | `publish-study.mjs` は `--path research/YYYYMM-<kebab>` を要求し、`workforce/research/` 配下の研究を受け付けない。本件は dry-run のガードとしてのみ使えた | research-study skill (sana / beatriz): `--path` の正規表現を緩め、任意の repo の任意ディレクトリに公開できるようにする (skill meta を bump) |
| L8 | 熟議の到達点はワークフォース固有の概念 (個体、傭兵、マージ) を含み、一般企業にそのまま写せない (A1 一部崩れ) | **S0** の brief に「与件の出所の規模・文脈」と「転用可能性」の欄を置き、転用できない句を S1 で落とす |

## 予測レジスタの採点予定

report.md 図 8-3 の日付つき予測 (本書のもの 4 件、外部のもの Gartner 40% / IDC 20% / Forrester 25% など) は、2027-12 (EU Annex III 適用) と 2028-12 (IDC・Gartner の期限) に採点する。採点者は本 skill の improvement_agent (sana) と beatriz。

## operator への問い (ines: 人間にしか閉じられないもの)

| # | 問い | 動く仮説 | 誰が・どの経路で | 分 |
|---|---|---|---|---|
| Q-op-1 | 最初の一チームを誰にするか (選定基準は report.md 第 8 章に事前登録案) | H-3.3, D2 | operator → 対象部門長 | 15 |
| Q-op-2 | 反証条件の期限と判定者 (案: 次ゲート日固定、CFO + 部門長) を採るか | H-8.2, U4 | operator | 10 |
| Q-op-3 | 支払者 案 B (四半期 1 は情シスが払い showback、二つ目の部門から chargeback) を採るか | H-5.2, U1 | operator → 経理 | 10 |
| Q-op-4 | 本調査の実績登録 (engagements.json) を書き込んでよいか — 本セッションに AWS 資格情報があるため実行可能 | — | operator | 2 |
| Q-op-5 | 研究を Notion / 公開サイトへ出すか (本 PR はリポジトリ内 HTML のみ) | — | operator | 5 |

## 実績登録 (engagements)

`engagements.json` に 26 行 (座席ごとに 1 行、skill = `research-study`、uri = PR #871)。登録は `.claude/skills/log-workforce-engagements/scripts/log-engagements.mjs --rows engagements.json --project agent-workforce` (dry-run の結果は本ファイル末尾に追記)。提出者 (mateo, anjali) は本調査で作業していないため行を立てない。
