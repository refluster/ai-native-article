# Public documents in two editions (ja / en) — design note

- **Status**: Implemented 2026-10-19 (this PR); design rules in
  [`../../DESIGN.md` §Docs](../../DESIGN.md#docs)
- **Routes**: `/docs` (index), `/docs/:slug` (capabilities · whitepaper ·
  founding-story · manifesto · book-production · asp-cloud-dev-review), and
  the landing page's *Read before you sign in* grid. **New routes: none** —
  the edition is `?lang=ja|en` only, per
  [`docs/adr/adr-0005-bilingual-article-editions.md`](../../../docs/adr/adr-0005-bilingual-article-editions.md)
- **Sibling notes**: [`public-docs.md`](public-docs.md) (the documents in the
  SPA) · [`research-surface.md`](research-surface.md) (the edition mechanism
  this note reuses)
- **Author**: Aoi Marchetti (Designer, LLM persona) — operator-orchestrated
  session, not an autonomous fire. Engineering implements from this note.

## 意図

制約から先に書きます。新しいトークン・新しいルート・新しいコンポーネントは作らない（`LanguageToggle` の移動と引数化だけ許可）。言語解決は Research と同じ `resolveLanguage` / `storeLanguage` / `useResearchLanguage` をそのまま使う。六文書すべてに両版が存在するので、Research にある「英語版未着」の通知状態は Docs には存在しない。

典型ユーザーは一人に絞ります。**同僚から `/docs/founding-story` のリンクを受け取った英語話者**（`navigator.languages = ['en-US']`、ストレージ空、14 インチのノート PC）。今日この人は日本語の本文に着地して閉じます。このノートの目的は、その人が英語版に着地し、文書から文書へ移っても版が勝手に変わらないこと、です。

判断の背骨は一つ：**manifest の行から来る文字列は版に従い、ページのソースに書かれた文字列は英語のサイトクローム**。Research が「記事の版だけを切り替え、クロームは英語」としたのと同じ線を、Docs では機械的に検査できる境界（manifest か、ページか）に引き直します。

## IA

```
manifest.json  — 1 行 = 1 文書。slug が同一性（ADR-0005: one row, one URL）
{ slug, measure,
  editions: { ja: { file, kicker, title, description, cta, packTitle },
              en: { file, kicker, title, description, cta, packTitle } } }
```

- 単一の `lang`（原語）は削除します。原語を UI で表示する場所がもう無く、残すと「原文」バッジを誘発するだけです。
  *実装注（運営者）*：`original` として残しました。読者には一切見せず、`build-board-knowledge.mjs` が知識パックに入れる版を選ぶためだけに読みます。
- 片方の版の本文や項目が欠けた行は、モジュール読み込み時に throw（C-4）。実行時のフォールバックは作らない — Docs で「版が無い」は表示状態ではなくビルド欠陥です。
- 両版は同じ節 id の集合（`s1…sN`）を持つ。目次・深いリンク・版切替の位置復元がこれに依存します。
- `workforce/scripts/build-board-knowledge.mjs` は同じ manifest を読むため、スキーマ変更は同じ PR で追随（どちらの版をパックに入れるかはこのノートの範囲外）。

**何が版に従うか（決定 2）**

| 版に従う（manifest 由来） | 英語のまま（クローム） |
|---|---|
| 本文、`document.title`（`packTitle — Software Talent Network`）、パンくず二段目の kicker、索引カードの kicker / title / description / CTA、*Continue reading* カード、ランディングの文書カード | ヘッダー/フッター、`Docs`、`Documentation`、`Continue reading`、`← All docs`、Not found カード、索引 `document.title`（`… — Docs`）、索引 lede |

理由：クロームは `<html lang="en">` のコンソール全体の言語で、それを訳すと UI 文字列表という第二の IA が生まれる（Research が避けたもの）。索引 lede の "The founding story is in Japanese." は偽になるので、英語のまま書き換えます：*"… read any first. Each is published in Japanese and English."*

**kicker（決定 4）**：言語マーカー（`· 日本語`）は両版から外す。言語を示すのはトグルだけです。kicker は版の言語で書いた文書種別、manifest の kicker は本文 `.cover .kicker` の先頭セグメントと一致させる（今の "Process" と "Book production" のずれもここで解消）。版番号と日付はデータなので両版同一。

| slug | en | ja（訳語は提案、最終は Kai の確認） |
|---|---|---|
| capabilities | Capabilities · v1.0 · 2026-09 | 提供能力 · v1.0 · 2026-09 |
| whitepaper | Technical whitepaper · v1.0 · 2026-08 | 技術ホワイトペーパー · v1.0 · 2026-08 |
| founding-story | Founding story · 2026-09 | 創業ストーリー · 2026-09 |
| manifesto | Manifesto | マニフェスト |
| book-production | Book production · v1.0 · 2026-10 | 書籍制作 · v1.0 · 2026-10 |
| asp-cloud-dev-review | Development review · asp-cloud · 2026-10-10 | 開発レビュー · asp-cloud · 2026-10-10 |

founding-story の日本語タイトルは「人間ひとり、AI 58体」（運営者決定、句点なし）。

## フロー

```
到着 ─┬─ ?lang=ja|en ───────────────────▶ その版（ストレージには書かない）
      ├─ localStorage "kohuehara.lang" ──▶ その版（Research と共有＝一人の読者に一つの言語）
      ├─ navigator.languages の最初の ja/en ▶ その版
      └─ どれも無い ──────────────────────▶ ja
トグル押下 ─▶ storeLanguage ＋ ?lang= を replace ─▶ 読んでいた節で再描画
/docs 内の遷移（カード・パンくず・← All docs・本文リンク・旧 URL 転送）
           ─▶ 現 URL に ?lang= があれば引き継ぐ。無ければ何も付けない
```

不変条件：**読者がトグルを押さない限り、遷移で版は変わらない。**

**ランディング（決定 3）**：二案を描いて比較しました。

- A. 解決済みの版に従う（トグルなし）。失敗モード：見えない状態 — Research で EN を押した人には、ランディングのカードが理由の表示なく英語になる。
- B. 各文書の原語のまま。失敗モード：約束違反 — 日本語のカードを押した英語ブラウザの読者は英語の本文に着地し、カードと行き先が食い違う。英語版があるのに英語読者に日本語カードを見せ続ける。

**A を採用。** カードは行き先についての約束で、行き先は同じ関数で解決されるので、カードと本文が必ず一致します。見えない状態の代償は、着地先の文書ページにトグルがあることで一手で回収できます。ランディングにトグルは置かない（ランディングの IA は変えない）。

## コンポーネント

**配置（決定 1）**

```
/docs
┌ PublicShell ───────────────────────────── Docs  Research  (Sign in) ┐
  DOCUMENTATION
  Docs                                               ( JA | EN )  ← PageHero aside
  What this organization delivers, … Each is published in Japanese and English.
  ┌ LinkCard lg  lang="ja" ─────────────────────┐
  │ 創業ストーリー                                │
  │ 人間ひとり、AI 58体                            │
  │ なぜ一人の人間がこの組織を作ったのか…            │
  │ 創業ストーリーを読む →                          │
  └──────────────────────────────────────────────┘

/docs/:slug  （Research の記事ページと同じ位置）
  DOCS / 創業ストーリー                              ( JA | EN )
  ^ nav[aria-label=Breadcrumb]  justify-between, flex-wrap 可
  article.docs-prose[lang=ja]
    創業ストーリー · 2026-09        ← .cover .kicker（本文側）
    人間ひとり、AI 58体
    …
  CONTINUE READING   [card][card] …
  ← ALL DOCS
```

文書ページには PageHero が無く、本文の `.cover` がヒーローなので、トグルを `.cover` の中に入れると本文（コンテンツ）とクロームが混ざります。パンくず行の右端に置きます。manifesto（`measure: narrow`）では 820px の列の右端。電話幅ではパンくずが折り返してよく、トグルは切り詰めない・横スクロールを生まない。

**`LinkCard lang`（決定 5）**：まだ必要です。条件が「文書の原語が ja」から「解決済みの版が ja」に変わるだけ。ページは `lang="en"` なので、ja 版のとき三面（索引・Continue reading・ランディング）の文書カードすべてに `lang="ja"`、en 版では付けない。パンくず二段目の span も同じ規則。`<article>` の `lang` は版そのもの。

**`LanguageToggle`（決定 6）**：`components/research/` から `components/public/LanguageToggle.tsx` へ移動します。二つの公開面が使う時点で、それは Research の部品ではなく公開面の共有語彙（`PageHero`、`LinkCard` と同じ棚）です。`label` 引数を追加し、既定値は `"Article edition"`（Research は無変更）、Docs は `"Document edition"` を渡す。スクリーンリーダーは名詞を読み上げるので、文書を「article」と呼ばない。

**トークン**：変更なし。ピルの見た目は Research と同一（`wf-primary` / `wf-on-primary` / `wf-outline-variant` / `wf-surface-container-lo`）。

## 状態

| 面 | 状態 |
|---|---|
| `/docs` | ja / en。トグルあり |
| `/docs/:slug` | ja / en。トグルあり。版切替直後は「読んでいた節」に位置復元 |
| `/docs/:slug`（未知の slug） | Not found カード。切り替える版が無いのでトグルなし。`← All docs` は `?lang=` を引き継ぐ |
| ランディング | 解決済みの版に従う。トグルなし |
| ストレージ不可（Safari プライベート） | 毎回ブラウザ設定から解決。トグル後は `?lang=` の引き継ぎで同一セッション内は一貫 |
| 本文の読み込み中 | 版ごとに一ファイルを遅延読み込みする（レビュー M2/D2）。パンくずとトグルは即時、本文はスケルトン → 到着次第差し替え。切替時の位置復元は新しい本文の到着後 |
| 「英語版未着」 | **存在しない**。欠けた版はビルドで落ちる |

## ユーザーが間違えたとき

- **`?lang=en` の深いリンク**（`/docs/whitepaper?lang=en#s7`）：en 版の s7 に着地。保存済みの `ja` より URL が勝つが、ストレージは上書きしない — 共有リンクが受け手の選択を奪ってはいけない。その後の遷移は `?lang=en` を引き継ぐ。引き継がないと、次のカードで受け手の保存値 `ja` に戻り、版が黙って入れ替わる（これが最も起きやすい失敗）。
- **`?lang=EN` / `?lang=fr`**：無効値として無視し、ストレージ → ブラウザ → `ja`。エラーも 404 も出さない。
- **文書の途中で切替**：両版は長さが違うので、ピクセル位置の維持は別の場所に着地させ、先頭へ戻すと読んでいた場所を失う。どちらも禁止。ビューポート上端を最後に通過した節の id を記録し、新しい版で同じ id の先頭へ。URL の `#hash` は書き換えない。節 id の無い文書（manifesto）は `<article>` の先頭へ。トグルは `replace` なので、戻るボタンは前の版ではなく前のページへ。
- **Japanese しか読まない端末に `en` が保存されている**（家族共用機で誰かが EN を押した）：全文書とランディングが英語で開く。ブラウザ設定でこっそり補正してはいけない — 明示の選択は推測に勝つ。回復手段は索引と文書ページのトグル。ストレージキーが Research と共有なので、Research で押した選択も効く（意図どおり）。
- **本文の相互リンクが `?lang=` を落とす**（`<a href="/docs/whitepaper">`）：`internalNavigationTarget` の結果に、現 URL の `?lang=` を足す（リンク側に `lang` が無いときだけ）。本文 HTML に `?lang=` を直書きしてはいけない — ja 版が `?lang=ja` 付きでリンクすると英語読者を強制的に日本語へ送る。`#s10` のような節リンクは両版の id 一致で守られる。
- **旧 URL**（`/docs/founding-story.html?lang=en#s3`）：転送先 `/docs/founding-story?lang=en#s3` で `?lang=` と `#hash` を保持する。今の転送はパスだけを返す。

## 受け入れ基準

- [ ] `?lang=en` 付きで開くと en 本文、`article[lang="en"]`。保存値 `ja` があっても en、かつ `kohuehara.lang` は書き換わらない
- [ ] クエリ無し・保存 `ja`・`navigator ['en-US']` → ja。クエリ無し・保存無し・`['en-US']` → en。`['fr']` → en（ADR-0005 の既定、実装注参照）。`?lang=EN` → 無視
- [ ] 文書ページ：`nav[aria-label="Breadcrumb"]` 内に `role=group` `aria-label="Document edition"`。EN 押下で URL に `lang=en`、ストレージ `en`、本文 en、`aria-pressed` が移る
- [ ] `/docs`：トグルが PageHero の aside にある。カードの kicker/title/description/CTA が版に従う
- [ ] 文書カード（索引・Continue reading・ランディング）は ja 版のとき `lang="ja"`、en 版のとき `lang` 属性なし
- [ ] ランディングにトグルが無く、文書カードは解決済みの版に従う
- [ ] 両版でクローム文字列が同一：`Docs`、`Documentation`、`Continue reading`、`← All docs`、Not found カード、新しい索引 lede
- [ ] `document.title` は版の `packTitle — Software Talent Network`。パンくず二段目は版の kicker
- [ ] manifest：全行に `ja` / `en` 両方の全項目と本文。欠ければモジュール読み込みで throw。どの kicker にも `日本語` / `Japanese` を含まない。manifest kicker は本文 cover kicker の先頭セグメントと一致。founding-story の ja タイトルは `人間ひとり、AI 58体`
- [ ] 各文書の ja / en 本文の節 id 集合が一致。コーパス内の `#` リンク先は両版に存在
- [ ] どの本文断片の `href` にも `lang=` が含まれない
- [ ] 現 URL に `?lang=en` があるとき、Continue reading・パンくず `Docs`・`← All docs`・本文の内部遷移先がすべて `lang=en` を持ち、`#hash` を保持（`?lang=en#s10` の順）。現 URL に無ければ何も付かない
- [ ] 旧 URL 転送が `?lang=` と `#hash` を保持する
- [ ] s4 を読んでいる状態で切替 → 新しい版の `#s4` に `scrollIntoView`。トップへの `scrollTo` は呼ばれない
- [ ] Research：トグルの `aria-label` は `Article edition` のまま、見た目のクラスも同一（import 先の移動のみ）
- [ ] （手動）360px 幅で、トグル込みのパンくず行が横スクロールを生まない

## やらないこと

- UI クロームの日本語化（文字列表）。クロームは英語のまま。
- `resolveLanguage` の最終フォールバックの変更。ADR-0005 は読者サイトで「どちらも無ければ English」としているが、コンソールの実装は `ja` で終わる。Docs はコンソールの関数をそのまま使うので、ja/en どちらも挙げないブラウザ（`fr` のみ等）は日本語に着地する。直すならコンソール全体（Research 含む）の判断として運営者へ。
  *実装注（運営者、レビュー D1 を受けて）*：`resolveLanguage` に `fallback` 引数を足し、Docs は `en`（`DOCS_FALLBACK_LANGUAGE`、ADR-0005 の既定）、Research は従来どおり `ja` を渡す。英語原本だった三文書を、言語を挙げないブラウザがこれまでどおり英語で開けるようにするため。
- `hreflang` / OG / canonical。SPA の `index.html` は `noindex` のまま（[`public-docs.md`](public-docs.md) と同じ理由）。
- 版の内容ずれの検出（片方だけ編集された文書）。ADR-0005 の Consequences と同じ未解決の穴として残す。
- トグルのボタンの読み上げ名（"JA" / "EN" が `title` より優先される）。Research と共通の課題として別の小さな PR で。
