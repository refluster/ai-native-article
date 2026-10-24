---
title: "CRM の価値重心は「記録」から「推論と実行」へ移る――a16z が描く GTM ソフトウェア再編"
lang: "ja"
type: "explanation"
category: "AI Productivity"
date: "2026-05-24"
abstract: "The article argues that AI is transforming enterprise software from passive systems of record into active systems of work that can help execute tasks, coordinate workflows, and drive productivity. It likely explores how generative AI enables software to move beyond storing information toward becoming an operational layer that assists knowledge workers directly."
notionId: "36ad0f0b-e61e-8110-a8d2-ec3bc7fab2da"
sourceUrls: "https://www.a16z.news/p/from-system-of-record-to-system-of"
---

# CRM の価値重心は「記録」から「推論と実行」へ移る――a16z が描く GTM ソフトウェア再編

## Executive Summary

a16z の本稿は、Salesforce や HubSpot のような system of record は消えない一方で、企業ソフトウェアの価値の中心が、そこに蓄積されたデータを読み書きしながら実際に判断・優先順位付け・実行を担う「system of intelligence」に上方移動すると論じる。とくに GTM（go-to-market）領域では、AI エージェントが CRM を「操作画面」ではなく「構造化データベース」として扱い始めており、次の 10 年の企業価値はこの推論レイヤーに集約される、というのが著者らの主張である。

## 「friend graph」ではなく「news feed」が価値になった、という比喩

本文は、ソーシャルメディアにおける価値の移動を、CRM の将来像を説明する比喩として使っている。以前の Facebook では「people’s profiles」とプロフィール間のデータグラフが durable asset だったが、やがて「news feed」が“Here’s what happened today; here’s where you catch up and take action, all in one place.” という新しい操作面になり、friend graph は「just one of many inputs」へ後退した、という整理である。

- エビデンス
- 著者らは Facebook の変化を、プロフィールと friend graph から news feed への重心移動として説明している。
- そのうえで「The CRM isn’t going to go away, just like the friend graph never went away—but it’s turning into just an input; one of many inputs, into the systems of intelligence which we use to get work done.」と述べる。
- 現在の営業担当者像として、朝にノート PC を開くと、10-Ks と recent earnings calls を調べる research agent、異議対応をその場で助言する dialer、通話を聴いて CRM に structured notes を書き戻す orchestration layer が待っている、という例を挙げる。
- これらを総合して「this is the newsfeed. It’s the valuable thing now.」と位置づけている。
- 結論
- CRM の破壊は、データ保存先の置換ではなく、ユーザーが最初に向き合う価値レイヤーの置換として進む、というのが著者らの見立てである。
- 価値は「どこにデータがあるか」から「どこで文脈が統合され、次の行動が提示されるか」へ移る。
## Salesforce と HubSpot は依然として「database を所有」している

著者らは、過去 20 年の GTM ソフトウェアで勝者が system of record だった事実を否定していない。むしろ Salesforce と HubSpot が価値を集中できた理由は、まさに database を握っていたからだと明言している。

- エビデンス
- 「A thousand companies were founded to help salespeople sell; but almost all the value ended up accumulating in just two names: Salesforce, today valued at around $140 billion, and HubSpot, valued around $9 billion.」
- その理由として「Salesforce and HubSpot own the database. And the database is where all the value resides.」と述べる。
- 蓄積される内容として「Every call note, every pricing precedent, every contact, every stray observation about why a deal had stalled」が system に入力されると説明している。
- スイッチングコストについては、Alex Rampell の表現として users are “hostages, not customers.” を引用する。
- さらに、Salesforce と HubSpot は marketing、service、analytics、commerce へ拡張し、「same data spine」の上に新モジュールを積み増してきたと述べる。
- 一方で著者らは、両社が「some of the most valuable datasets in the industry」を持ち、「API-first offerings」を急速に整備して AI 機能を自社の壁の内側に取り込んでいるとも書く。
- 結論
- 著者らの論点は「SoR incumbents の没落」ではない。database の保有価値は残るが、その価値の取り込み方が UI 主導から API 主導へ移るという整理である。
- 既存大手の防衛線はデータ保持と API 化にあるが、次の支配点は必ずしもデータ保有そのものではない。
## AI エージェントにとって CRM は「database」であり、重力は「data accumulation」から「orchestration」へ移る

本稿の技術的な中核は、AI エージェントが CRM をどう見るか、という記述にある。人間にとっては CRM が画面とワークフローの集合でも、エージェントにとっては read/write しやすい構造化データの置き場である、という前提で議論が進む。

- エビデンス
- 著者らは、エージェントが sales reps の behalf で account research、outbound sequence の draft、inbound leads の qualification、deal record の update を行うと述べる。
- さらに meeting recording を聴き、structured fields を CRM に自動で書き戻すケースも示している。
- そのうえで「The CRM, from the agent’s perspective, is a database. A very large and carefully curated database, hosted by a trusted vendor, with excellent integrations and a decade of accumulated customer trust; but a database, nonetheless.」と定義する。
- ソフトウェア時代の重力は「data accumulation」だったが、AI 時代の重力は「orchestration」になると明言している。
- AI エージェントは CRM、calendar、shared inbox、call recording、Slack、enrichment API、billing system、product telemetry から同時に signal を引き出し、synthesize した上で action を取れるとされる。
- スイッチングコストも「All of our customer data is in Salesforce」から「all of our workflows, our reasoning, our accumulated institutional context live in our AI layer.」へ移ると述べる。
- 結論
- 新しいロックインの源泉は、単一データベースへの蓄積量ではなく、複数システム横断の推論・実行・制度知の蓄積になる。
- したがって、CRM の上に載る補助アプリという従来の従属関係ではなく、system of intelligence がハブになり、CRM は「one of the many systems of record」へ相対化される。
## 基盤モデルの上には、地味だが巨大な「GTM application layer」が必要になる

著者らは、foundation models の重要性を認めつつ、それだけでは GTM アプリケーションにはならないと線を引いている。価値が生まれるのは、モデルと顧客の間にある業務特化の実装層だという立場である。

- エビデンス
- 「At the technical core of the new stack sit the foundation models. But a foundation model is not, by itself, a GTM application, any more than Oracle’s database engine was a CRM.」
- その間にある仕事として、「orchestrating context across dozens of connected systems」「encoding the actual logic of how sales and marketing teams operate」「handling permissions and compliance」「integrating with the chaotic reality of a Fortune 500 IT environment」を列挙する。
- この層を「the new GTM application layer」と呼び、「It is where the new GTM companies are being built.」と述べる。
- 結論
- 著者らの投資仮説は、モデル単体ではなく、業務文脈・権限制御・統合・運用現実を織り込んだアプリケーション層に企業価値が形成されるというものだ。
- 争点はモデル性能の一点競争ではなく、企業の実運用に接続された orchestration と domain logic の実装能力にある。
## ROI は「人件費の削減」より「GTM 予算全体の拡大」として現れている

本稿は、AI 導入が直ちに営業人員削減へ向かうという見方を採っていない。むしろ、ソフトウェアが payroll に比べて小さかった GTM 支出構造の中で、AI は ROI を通じて総額を膨らませる可能性があるとする。

- エビデンス
- 著者らは、歴史的に GTM では software が total GTM spending の「between 5 and 10 percent」で、残りは payroll だったと述べる。
- AI によって software companies は「meaningfully reduce costs while opening up new high ROI use cases」を初めて実現しうると書く。
- ただし headcount への影響については「So far, it has not, or at least not in a straightforward way.」と留保する。
- 実際には「teams spend even more on people」とされ、「The ROIs on these agents are strong enough that the total pie grows rather than the labor budget shrinking.」
- さらに、これらのツールを使う reps は、未使用の reps より「attainment and quota at noticeably higher rates」であり、「the return on every GTM dollar is rising」と述べる。
- CRM 利用についても、著者らの GTM survey では「CRM usage has actually risen since AI tools began to be adopted at scale」とされる。
- その理由として、通話を聴いて structured notes を書き戻す agents によって「the data sitting there has become dramatically richer than it used to be」と説明する。
- また Jason ✨👾SaaStr.Ai✨ Lemkin の 2026-04-26 の投稿を引用し、Salesforce について「we’ve reduced our seats from 10+ to 2 human seats and 1 API seat. And yet, we now pay $22,000 a year, 83% up from $12,000.」という例を示している。
- 結論
- 著者らの見立てでは、AI の経済効果は seat 削減による単純な SaaS 収縮ではなく、API 経由利用と高 ROI な新用途の増加を通じた再配分として現れる。
- CRM は利用されなくなるのではなく、より豊かなデータ基盤として使われ続け、その上位で intelligence layer が収益機会を広げる。
## 次のユースケースは「優先順位付け」「自動準備」「制度知の継承」に集中する

著者らは、AI-native GTM スタートアップの初期集中領域にも言及している。現段階では「比較的狭く」「高頻度」で、「inputs are structured and outputs are measurable」なワークフローに集積しているという観察である。

- エビデンス
- 数年後の VP of Sales の一日として、Salesforce の static account list ではなく、system of intelligence が作る prioritized feed から始まると描写する。
- その feed には「which of her accounts had material news overnight」「which prospects in the territory are suddenly in market」「which deals in the pipeline have gone quiet in ways that ought to be investigated」が並ぶ。
- これにより「The daily prioritization decision ... has been quietly offloaded to the intelligence layer.」
- 営業準備についても、以前は case by case で、時には全く行われなかった prep が、「every time as a matter of course」行われると述べる。
- 具体例として「The rep who would never have read the 10-K is walking in with a briefing drafted for him; the new hire six weeks into the job is, by certain measures, better equipped than the ten-year veteran at the desk next to her.」
- 管理者視点では、call transcripts、email threads、calendar data が自動流入し継続分析されることで、誰が disciplined discovery をしているか、どの account が coverage され、どれが neglected されているかを把握できると書く。
- さらに、退職時に失われる institutional knowledge について、「A system of intelligence that has been quietly ingesting that context for the duration of a rep’s tenure can, when she leaves, hand the whole of it over to her successor. Institutional memory becomes something a company can actually ship.」と述べる。
- 結論
- system of intelligence の価値は、単なる CRM 入力自動化ではなく、優先順位決定、準備の標準化、可視化、制度知移管といった、従来は人間の認知負荷や属人性に依存していた領域の代替にある。
- 著者らの射程では、次の GTM ソフトウェアは記録管理ツールではなく、営業組織の判断と実行を肩代わりする operational layer として定義される。