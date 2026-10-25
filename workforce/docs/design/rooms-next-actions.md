<!-- Status: design note (Zone B). Brainstorm record for the Rooms "conclusion → next action" layer; implements nothing. Governing ADR: adr-0048 (Rooms). -->

# Rooms 結論 → ネクストアクション UI ブレスト (2026-10-25)

参加: nadia (戦略・設計リード / ADR-0048 起案) · aoi (コンソール UI デザイナ) · ren (バックエンド)
対象: `workforce/app/src/pages/Room.tsx` (`ConclusionCard`, L745) · `workforce/lambdas/rooms-api/` · `workforce/lambdas/room-debate/handler.ts`

## 0. 現状 (コードから確認済み)

- chair のプロンプト (`room-debate/handler.ts` L173–174) は既に `## 推奨アクション / ## Recommended action` と `## 未解決の論点 / ## Open questions` を見出しとして要求している。ただし中身の形 (箇条書き・担当・宛先) は自由記述。
- GitHub 書き込み経路は既にある: `workforce/lambdas/shared/github.ts` の `createIssue()` (POST /repos/{o}/{r}/issues, ADR-0007 の週次 config digest 用)、`dispatchEngineer()`、`findRecentPRs()`。トークンは Secrets Manager `wf/github` (PAT か App installation token) を `getSecret<GithubSecret>` で取得。`shared/external-pr.ts` は R-N1 例外経路 (外部 git は PR のみ)。
- `rooms-api` は 6 ルート。SAM の resource policy 上限 (20 480 bytes) を避けるために agents-api から分離された経緯があるので、ルート追加は 1 本に抑えたい。
- ラベル規約 (`docs/issue-labeling.md`): `project:` (article|workforce) + `layer:` (L0–L3) + `type:` (bug|feature|chore|tracker|ops) が必須。

## 1. 議事

- **nadia**: 「Room は *問いに答えるため* に開くもので、ADR-0048 の趣旨は『話して終わり』を防ぐこと。結論が課題として管理されて初めて閉じたと言える。最低ラインは GitHub Issue で、それ以外は Issue を起点にぶら下げる形が正しい。」
- **aoi**: 「ConclusionCard の下に『Actions』の帯を置き、推奨アクションの各項目を 1 行ずつ、チェックボックス + 宛先ピッカー (Issue / エージェント / 追い Room) で並べたい。一括送信できて、送った行には Issue 番号などのバッジが残る。これで結論カードが ‘やることリスト’ に変わる。」
- **ren**: 「`createIssue()` と `wf/github` はもうあるので、Issue 作成は新しい秘密情報なしで rooms-api に 1 ルート足せば済む。ただしパースは chair の出力形に依存するので、先にプロンプト側の契約を固めて、サーバ側でパースして `actions[]` として保存したい。クライアントで Markdown を正規表現で切るのはやめたい。」

## 2. 候補カタログ (11 案)

| # | アフォーダンス | 何をするか | UI 上の位置 | 必要なバックエンド | コスト | 提案者 |
|---|---|---|---|---|---|---|
| A1 | **GitHub Issue 登録** (運用者の最低ライン) | 推奨アクション 1 件 = Issue 1 件。本文に Room へのリンク・結論の抜粋・対立点を入れる。ラベルは `project:`/`layer:`/`type:` を chair 推定 + 人が確定 | Actions 帯の各行 → 宛先「Issue」 | `POST /rooms/{id}/actions` (kind=`github_issue`) → `shared/github.ts#createIssue` (`wf/github`) | M | nadia |
| A2 | **トラッカー Issue 一括** | 全項目を 1 つの `type:tracker` Issue + sub-issues に | Actions 帯フッタ「まとめてトラッカー化」 | A1 + sub-issue API (`POST .../issues/{n}/sub_issues`) を `github.ts` に追加 | M | nadia |
| A3 | **エージェントへ委任** | 項目を担当ペルソナへ engagement / タスクとして渡し、Track Record (EXEC 行) に記録 | 行の宛先「Agent」+ 担当者ピッカー (Room 参加者が既定) | agents-api の engagement 書き込み (`record-engagement.mjs` と同じ形) / outsource-to-workforce の流れ。実行は既存 bindings 経由 | M–L | ren |
| A4 | **追い Room を開く** | 未解決の論点 1 件から新 Room を作成 (親 Room の結論を context に、参加者を引き継ぎ) | 未解決の論点の各行に「この論点で Room を開く」 | 既存 `POST /rooms` に `parent_room_id` / `seed_context` を追加 | S | aoi |
| A5 | **Markdown エクスポート / コピー** | 結論全体 or 選択行を Markdown でコピー・ダウンロード | ConclusionCard 右上メニュー | なし (クライアントのみ) | S | aoi |
| A6 | **ADR / 決定記録ドラフト** | 結論を ADR テンプレに流し込み、draft PR として出す (L1 なので必ず人間承認) | 結論カードメニュー「ADR 下書き」 | `dispatchEngineer()` で engineer routine に渡し PR 化 (R-N1: PR のみ) | L | nadia |
| A7 | **フィード / スレッド投稿** | 結論要約を workforce のフィード or messaging thread に投稿 | 結論カードメニュー「共有」 | 既存 threads/feed 書き込み API | S–M | aoi |
| A8 | **Notion L1 ソース行追加** | 議論中で引用された URL を Articles DB に L1 候補として登録 | 行の宛先「L1 source」(URL を含む項目のみ表示) | `wf-l1-source-register` Lambda を呼ぶ | M | ren |
| A9 | **リマインダ / 定期チェックイン** | N 日後に「この推奨アクションどうなった？」を Room に自動ターンとして追加、または Issue の状態を見て再 conclude | 行の「⏰ 期限」 | EventBridge Scheduler 1 回起動 → `POST /rooms/{id}/turns` | M | ren |
| A10 | **状態の逆同期** | 作成済み Issue の open/closed を行バッジに反映、全部 closed で Room を「解決済み」表示 | Actions 帯の各行のバッジ | `GET /rooms/{id}` 時に Issue 状態を取得 (キャッシュ) or Issue webhook | M | aoi |
| A11 | **却下 / 保留マーク** | 採用しない項目に理由付きで「やらない」を記録 (意思決定ログ) | 行の宛先「Skip」 | `actions[]` の status 更新のみ | S | nadia |

## 3. パース契約 (chair プロンプトへの追加要求)

`## 推奨アクション` と `## 未解決の論点` だけは **1 行 1 項目の箇条書き** に固定し、行末に任意のメタタグを付けさせる:

```markdown
## 推奨アクション
- [A1] room-debate の chair 出力を JSON 併記に変える — owner: ren · type: feature · layer: L3 · project: workforce
- [A2] ADR-0048 に「結論の閉じ方」節を追記する — owner: nadia · type: chore · layer: L1 · project: workforce

## 未解決の論点
- [Q1] Issue の宛先リポジトリを Room ごとに選べるべきか — ask: operator
```

- ID (`A1`, `Q1`) は Room 内で安定。再 conclude で同じ ID を再利用するよう指示し、既に送信済み行との対応を保つ。
- メタは `key: value` を ` · ` 区切り。欠落は許容 (UI で補完)。
- 英語見出し (`## Recommended actions` / `## Open questions`) も同じ文法。
- パースは **サーバ側** (room-debate が conclusion turn を保存する時点) で行い、turn に `actions: RoomAction[]` / `open_questions: RoomQuestion[]` を保存。パース失敗時は空配列 + ログ (W-4: 黙って捏造しない。UI は「項目を抽出できませんでした — 手動で追加」を表示)。
- 型 (案, `lib/rooms.ts` と共有):

```ts
type RoomAction = {
  id: string;              // "A1"
  text: string;
  owner?: string;          // agent_id or "operator"
  labels?: { project?: string; layer?: string; type?: string };
  dispatch?: { kind: "github_issue" | "agent" | "room" | "skip";
               ref?: string; // "owner/repo#123", room_id, engagement id
               at: string; by: string; status?: "open" | "closed" };
};
```

## 4. 推奨 v1 (三者合意)

**作るもの (3 つ)**: A1 GitHub Issue 登録 · A4 追い Room · A5 Markdown コピー。(A11 Skip はデータ上 1 フィールドなので同時に入れても良い。)

**UI パターン — ConclusionCard 直下の「Actions」帯**
- 推奨アクションを 1 行ずつ: `☐ [A1] テキスト   [宛先 ▾ Issue]  [labels: project/layer/type チップ]`
- 帯フッタ: 「選択した N 件を登録」ボタン。送信前に確認モーダル (リポジトリ・タイトル・ラベル・本文プレビュー)。
- 送信済み行は `#1234 ↗` バッジに置換し、再送不可 (冪等)。
- 未解決の論点は別ブロックで、各行に「この論点で Room を開く」(A4)。
- 右上メニューに「Markdown をコピー」(A5)。
- 書き込み系ボタンはオペレータ (Cognito ログイン) にのみ表示。公開閲覧では帯を読み取り専用で表示。

**バックエンド**
- 新ルートは 1 本: `POST /rooms/{id}/actions` (AWS_IAM, routes.ts で再チェック)。body `{ items: [{ action_id, kind: "github_issue"|"skip", repo?, labels?, title?, body? }] }`。
  - `github_issue` → `shared/github.ts#createIssue` (トークンは既存 `wf/github`、新規シークレット不要)。
  - 冪等キー `ROOM#{id}/ACTION#{action_id}` で DDB 条件付き書き込みを先に行い、二重 Issue を防止。
  - 結果を conclusion turn の `actions[].dispatch` に保存 (W-2: 状態は DDB/S3 のみ)。
- A4 は既存 `POST /rooms` に `parent_room_id`, `seed_question_id` を追加するだけ (ルート増なし → resource policy 上限に影響しない)。
- room-debate: chair プロンプトに §3 の契約を追記 + 保存時パーサ (`parseConclusionActions()`、純関数 + vitest)。

**ガバナンス**
- Zone: `Room.tsx` / `rooms-api` / `room-debate` のコードは Zone B。ただし chair プロンプト文言は品質に関わるので prompt 変更として PR で明示 (D-2)。SAM テンプレ / `samconfig.toml` に触れる場合は Zone A。
- R-N1 (外部 git は PR のみ): Issue 作成は git 書き込みではないので抵触しないが、宛先リポジトリは **allowlist** (既定 `kohuehara/ai-native-article`、`workforce/projects/*/project.json` に repo があるもののみ) に限定。
- ラベル: `docs/issue-labeling.md` の 3 系統必須を **サーバ側で検証** し、欠けたら 400 (C-4/W-4)。追加で `source:room` ラベルを提案 (`.github/labels.json` 編集 = 要 `sync-labels`)。
- ADR-0048 を引用し、「結論 → 行動」節の追記は L1 なので別 PR で人間承認。pr-autopilot は L1 パスをマージしない (§4.4)。
- W-3 コスト: Issue 作成は LLM 呼び出しゼロ、API 呼び出しのみ。chair プロンプトの出力が数十トークン増える程度で影響は無視できる。A3/A9 は bindings や Scheduler を増やすため v2 で予算行と一緒に。
- `wf/github` の権限: 現在の PAT/App に `issues:write` があるかを要確認 (週次 digest で使っているので対象リポジトリにはあるはず)。

**v2 以降**: A3 エージェント委任 (Track Record 連携) → A10 状態逆同期 → A2 トラッカー化 → A9 リマインダ → A6 ADR ドラフト → A7/A8。

## 5. オペレータへの確認事項 (5 つ)

1. Issue の宛先リポジトリ: 既定は `ai-native-article` 固定で良いか、Room 作成時に project (asp-cloud, luckyhat …) を選ばせるか。
2. Issue は「推奨アクション 1 件 = 1 Issue」か、「Room 1 つ = トラッカー Issue 1 つ + チェックリスト」か、既定はどちらが好みか。
3. ラベル (`layer:` / `type:`) は chair の推定をそのまま使って良いか、毎回確認モーダルで人が確定するか。
4. 作成者表記: Issue は `wf/github` のボット名義になる。本文に「Room 参加ペルソナ / 提案者」を明記するだけで良いか。
5. v1 にエージェント委任 (A3) を入れたいか — 入れるなら W-3 の予算行をどこに積むか。
