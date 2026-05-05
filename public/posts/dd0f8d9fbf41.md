---
title: "Palantirが20年前に発明し、AI時代に800%急増した職種「FDE」——なぜ今、すべてのAI企業がFDEを雇おうとしているのか"
type: "explanation"
category: "C: New Roles / FDE"
date: "2026-03-26"
abstract: "Palantirが生み出したFDE（Forward Deployed Engineer）というモデルがAI時代に再評価され、求人数が800%急増した背景を、First Round CapitalがPalantir・OpenAI・AIスタートアップへの取材を元に分析。エンタープライズAI導入の「最後の1マイル」問題を解く職種として注目される実態を論じる。"
image: "/posts/images/dd0f8d9fbf41.jpg"
notionId: "34fd0f0b-e61e-81f6-8a27-dd0f8d9fbf41"
sourceUrls: "https://review.firstround.com/so-you-want-to-hire-a-forward-deployed-engineer/"
---

## Executive Summary

First Round Capitalの取材記事は、Palantirが約20年前に考案したFDE（Forward Deployed Engineer）が、AIスタートアップのエンタープライズ展開において再評価されている理由を、Palantir、OpenAI、Ironclad、Looker、Serval、Promiseの実務者証言から整理している。記事の中核は、FDEを「実装支援」や「営業補助」ではなく、顧客現場に埋め込まれ、プロダクトの“last mile”を本番環境で作り込むエンジニアとして位置づけ直している点にある。

同記事によれば、2025年1月から9月にかけてFDEの月間求人件数は800%増加した。ただし、記事はFDEを万能解として扱っておらず、上位顧客向けの高単価案件、非一様な顧客要件、将来のプロダクト像を固定しすぎない事業に限って投資対効果が成立しやすいと明示している。

## FDEの定義は「顧客接点を持つ実装担当」ではなく「本番コードを書くエンジニア」である

Palantir起源のFDEは、顧客に常駐・密着しながら、本番で動くコードを書いて「last mile」を埋める役割として設計された。記事は、solutions consultantやsales engineerとの違いを、実装責任とプロダクト創発への関与に置いている。

- エビデンス
- 記事はFDEを、顧客に「embed directly」して「build the ‘last mile’ of the product to work in production」する役割と説明している。
- ただし「traditional solutions consultant or sales engineer」とは異なり、「still very much an engineer who writes and debugs production code」と明記している。
- PalantirのFDEは「literally onsite」で、地方政府、医療大手、サプライチェーン業務など多様な大組織と働いていた。
- Shilpa Balajiは「Deeply understanding your customer and executing for them through product implementation or configuration is important, but that’s not forward deployed engineering」と述べている。
- 同氏はFDEモデルを「making room for creativity and innovation」「discovering new things in a customer context and decentralizing product development」と定義している。
- Jake Stauchも「The way I see an FDE is as an actual member of the software engineering team. Don’t just force them into implementation. Let them build the software」と述べている。
- 結論
- FDEは「導入を助ける人」ではなく、顧客現場から得た情報をそのままコードに変換するエンジニア職として設計しないと、記事がいうFDEの価値は成立しない。
- 実装、設定、トレーニング、顧客満足維持を一人で担う“万能ポストセールス人材”として定義すると、FDEではなく別職種になる。
## AI時代にFDE需要が急増した理由は、モデル性能ではなく導入障害がボトルネックになったからである

記事は、AI製品の能力自体が制約ではなくなり、企業内の既存ワークフロー、コードベース、コンプライアンスが導入の阻害要因になったと整理する。その「blockers」を現場で回避・実装する役としてFDEが求められている。

- エビデンス
- 記事は「Monthly job listings for the role shot up by 800% from January to September of 2025」と記している。
- AIスタートアップは「highly technical AI products」を「red-tape-lined legacy workflows」に展開するためにFDEモデルを採用しており、FDEは「unruly codebases」や「compliance hurdles」といった導入障害の周囲を作り込む役割を担うとされる。
- 記事は「even OpenAI is building out its own fleet」と述べている。
- ServalのJake Stauchは「Software platforms have become so powerful that their capabilities are no longer the rate-limiting step for the customer」と述べる。
- 同氏はさらに「AI unlocked all of these long-tail capabilities, so it can theoretically do anything imaginable. But somebody has to steer the product to do it in that way」と説明している。
- 結論
- AI時代のFDE需要は、モデルや基盤ソフトウェアの性能向上そのものではなく、エンタープライズ導入時の組織・業務・技術的摩擦の増大に対応するために生じている。
- したがって、FDE採用の論点は「AIを売るか」ではなく、「顧客環境ごとの差分を誰が本番実装で吸収するか」にある。
## FDEが生む価値は、受注、顧客埋め込みによる発見、創業初期のCTO的反応速度の再現に集中している

記事は、FDEの効果を抽象論ではなく、売上とプロダクト開発の両面で具体化している。特に、大型案件の受注支援、顧客現場からの新規機会発見、P2機能の継続的出荷が主要な効用として描かれている。

- エビデンス
- Lookerでは、見込み客に無料トライアルを提供しつつ、実データを使った「heavy pre-sales implementation efforts」を行っていた。
- Lloyd Tabbは「Selling as a product and forward-deploying during the free trial so it felt like a customized service」と述べている。
- 同氏は「we always asked the prospect for an actual dataset to play with」とし、デモをproof of concept化していた。
- Shilpa BalajiはPalantir時代について、「three or four forward deployed engineers」がエネルギー業界の顧客向けに「totally hand-rolled something to win the business」と述べている。
- BalajiはFDEについて「Living onsite with the customer is such a core part of being an FDE」「You're prototyping what you hear one day and showing them something the next day」と説明している。
- Servalでは、FDEが顧客現場での学習をもとに「over 60 third-party app integrations」「a feedback system for users to rate agent performance」「an SLA system within the product」を出荷した。
- Stauchは、FDEが創業初期の「your CTO hears feedback directly from the customer and immediately fixes it and makes the product better」という状態をスケールさせると述べている。
- 同氏はVerkada時代のSlackチャンネル「Feature Garage」を引き合いに出し、FDEならP2機能を放置せず処理できると説明する。
- 「Overprioritizing is actually a mistake」「They never touch the P2s. But P2s stack up」とStauchは述べている。
- 結論
- FDEの価値は、顧客要望を受けて既存製品を説明・設定することではなく、受注前後の短い時間軸で顧客固有の問題をコードとして解き、その過程で他顧客にも通じる機能を発見する点にある。
- その反面、FDEが「random features」を量産するリスクも記事は認めており、単なる顧客迎合ではなく、他社にも波及しうる問題を見抜くプロダクトセンスが前提になる。
## FDEが成立する会社には3つの条件があり、PLG前提や均質ICPでは適合しにくい

記事は、FDEを広く勧めるのではなく、事業モデルの制約条件を明示している。高単価の上位顧客、プロダクトの使われ方を固定しすぎない姿勢、非一様な顧客群が揃わない場合、FDE投資は過剰になりうるという立場である。

- エビデンス
- James Honsaは「Forward deployed engineering is definitionally an upmarket motion」と述べる。
- 同氏は「You should not be doing this if you believe the end shape of your product is some sort of product-led growth freemium fit」と明言している。
- Frank BienはLookerで、顧客単価の仮説を「$25,000 a year per customer」と置き、「by the time we had 2,000 customers, we could be doing $100 million dollars in ARR」と試算した上で投資判断したと述べている。
- 同氏は、もし「2,000 customers or 100,000 customers」のどちらで$100 million run rateに届くのか不明なら、「lighting our VC dollars on fire」になりえたと説明している。
- Shilpa Balajiは、創業者が将来のプロダクト像に強い確信を持つなら、必要なのはFDEではなく「more customer signal」や仮説検証であり、「a PM」や「an engineer who can talk to a customer」でも足りる場合があると述べる。
- 同氏はスペクトラムの一端をApple、他端をPalantirとして対比し、Palantir初期は「we rarely said, ‘This is what the product should be.’」と振り返る。
- HonsaはIroncladについて、初期50社に「public tech companies, YC startups, global beauty brands and professional sports teams」が混在していたと説明する。
- PromiseでBalajiは、顧客である「the US government」が異質であり、「Each state administers their government programs differently」と述べ、FDEチームを構築している理由に挙げている。
- 結論
- FDEは、標準化された低価格セルフサーブ製品を大量販売するモデルより、Fortune 500級を含む上位顧客向けに高いACVを取りにいくモデルで整合しやすい。
- また、顧客ごとの差分が小さい均質ICPでは、FDEではなく通常のプロダクト開発、PM、実装チームの方が合理的である。
- FDE投資は採用判断ではなく、事業モデル判断である、というのが記事の立場である。
## 採用と運用で失敗しない条件は、「営業寄りの何でも屋」にしないことと、技術水準を下げないことである

記事後半は、FDEの誤採用を避けるための識別基準と、適切なスコープ設計を提示している。焦点は、役割の混同を避けること、技術選考を緩めないこと、適用対象を上位顧客の難問に絞ることにある。

- エビデンス
- Tiffany Siuは、創業者が「build the product, implement it, train customers, customize it and keep everyone happy」という“一人で全部やる人”を想定しがちだが、「That’s not realistic at scale」と述べている。
- 同氏は、役割定義のために「What triggered this opening?」「What would this person’s day-to-day work look like?」「How will you measure this person’s success?」を問うとしている。
- 「If a founder says, ‘I want this forward deployed engineer to have closed X deals or run X number of demos,’ they probably want someone closer to sales, not an FDE」とSiuは述べる。
- BalajiはPalantirのFDEについて、近年の新卒が多く、「An FDE isn’t somebody who brings a playbook with them」と説明する。
- 同氏は、10年以上FAANGにいたような、過度にドグマティックな候補者は「no fly zone」だったと述べている。
- 記事が挙げる資質は、grit、「willingness to eat pain」、高い技術力、「compulsive builders」、そして事業理解への強い好奇心である。
- Honsaは、Ironclad初期のlegal engineersが「merging code into production and doing code review with our CTO every single week」だったと述べる。
- Siuは、PalantirのFDEがソフトウェアエンジニアと「the same interview loops and facets」を通過していた点を評価している。
- Balajiは面接で「No one has ever been able to solve this problem. How would you solve it?」のような高次の問題解決課題を使っていたと説明する。
- Honsaは候補者に「present a problem from their career and teach us how they used technology to solve it」を求めていた。
- 運用面では、Ironcladは全顧客にlegal engineerを付けるのをやめ、「high ACV customers」に限定した。
- Honsaは「sprinkle FDE on the right customers at the right times」と表現している。
- Servalも当初は全顧客対応だったが、現在は「companies with more than 1,000 employees」を優先している。
- Balajiは「FDEs do their best work when they’re onsite」とし、自身が「weeks in a small German town」で工場フロアに通った経験を語っている。
- 結論
- FDE採用では、肩書きや前職ブランドより、未定義問題への耐性、顧客現場への没入、継続的な実装習慣を優先すべきだというのが記事の示す基準である。
- 役割設計では、受注件数やデモ本数をKPIに置くと営業職に近づき、既存製品の反復導入を主務にするとimplementation roleに寄る。FDEとして機能させるには、コードを書く責任と顧客固有課題の解決責任を両立させる必要がある。
- また、全顧客にFDEを張り付ける運用は前提ではなく、記事ではむしろ高ACV顧客の難問に限定配分することが成熟した運用として示されている。
