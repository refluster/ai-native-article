---
title: "Y Combinator「Requests for Startups」2026年夏版——AIが「機能」から「土台」へ移り、投資テーマはエージェント向けソフトとシリコン供給網に集中した"
lang: "ja"
type: "explanation"
category: "Agentic AI"
date: "2026-06-11"
abstract: "Y Combinatorの最新「Requests for Startups」（Summer 2026）は「AI has stopped being a feature and started being the foundation」と宣言し、ソフトウェア・サービス・シリコンの再構築とAIの物理世界への展開を募集テーマの中心に据えた。パートナー署名付きの各テーマは、エージェント向けソフト、エージェント処理に最適化した推論チップ、半導体サプライチェーン、そしてサービス業そのものの代替に重心を置いている。"
notionId: "37cd0f0b-e61e-8142-98db-ec53a35adb9a"
sourceUrls: "https://www.ycombinator.com/rfs"
author: "elena"
---

## Executive Summary

Y Combinatorが公開した最新の「Requests for Startups（RFS）」（Summer 2026）は、冒頭で「AI has stopped being a feature and started being the foundation（AIは機能であることをやめ、土台になり始めた）」と宣言し、ソフトウェア・サービス・シリコンの再構築と、AIの物理世界への展開を募集テーマの中心に据えた。各テーマはYCパートナー個人の署名付きで、エージェント向けソフト（"Software for Agents"）、エージェント処理に最適化した推論チップ、半導体サプライチェーン、そしてサービス業そのものの代替に重心が置かれている。RFSはYCが「資金提供したいアイデア」を共有する慣習であり、これらに取り組むことは応募の必須条件ではない、とページは明記している。

## 「AIは土台になった」という宣言と募集の構図

RFSの位置づけは、ページ自身の言葉に明確に書かれている。

- 定義：「RFS is our tradition of sharing ideas we'd like to see founders tackle.」これらはYCが資金提供する対象の「just a fraction of what we fund」にすぎず、「you don't need to work on these ideas to apply to YC」と明記されている。
- 2026年夏版のリード文：「AI has stopped being a feature and started being the foundation. We're excited about a new wave of startups rebuilding software, services, and silicon— and pushing AI into the physical world.」
- 各テーマはYCパートナーの署名付き。Garry Tan、Jon Xu、Gustaf Alströmer、Ankit Gupta、Tom Blomfield、Tyler Bosmeny、Diana Hu、Jared Friedman、Aaron Epstein らが寄稿し、Diana Huは3テーマに単独で署名している。
これは特定スタートアップへの評価ではなく、YCが見ているフロンティアの言語化である。2026年夏版で繰り返されるのは「既存企業（incumbent）の堀が崩れた」と「AIが作業そのものを代替する」という二つの軸であり、ツール提供から作業代行への移行が全体に通底する主張になっている。

## ソフトウェアとサービスを「作り直す」テーマ群

最大のクラスタは、既存のソフトウェア・サービスを前提から作り直すという主張で構成されている。

- **Software for Agents**（Aaron Epstein）：「The next trillion users on the internet won't be people, they'll be AI agents.」エージェントには「forms, buttons, and dashboards」ではなく「machine-readable interfaces like APIs, MCPs, and CLIs」が必要だとし、スローガン「Make Something Agents Want」を掲げる。
- **AI-Native Service Companies**（Gustaf Alströmer）：「they don't sell software—they sell the service. Instead of giving you a tool, they just do the work.」関心領域として Insurance brokerage / Accounting, tax, and audit / Compliance / Healthcare administration を列挙し、サービスへの支出はソフトへの支出の「many times larger」と指摘する。
- **SaaS Challengers**（Jared Friedman）：「AI has collapsed the cost of producing software by 10-100x.」攻めるべき対象として「chip design software, ERPs, industrial control systems, supply chain management」を挙げ、「$50K per seat」級の製品のオープンソース代替を例示する。
- **Company Brain**（Tom Blomfield）：企業内に散在する暗黙知を構造化し「an executable skills file for AI」に変える新しい基盤を提唱。「We need Garry's G-Brain, but for every business in the world.」
- **The AI Operating System for Companies**（Diana Hu）：会社全体を「queryable」にして「open loop」から「closed loop」へ移す。「Slack, Linear, GitHub, Notion」等を束ねる接続層が欠けているとし、これを実践したチームは「cut sprint time in half and ship twice as much」と報告されている。
- **Dynamic Software Interfaces**（Ankit Gupta）：コーディングエージェントの進歩でユーザー自身が「forward deployed engineers」になり、UIを個別最適化する未来を描く。
このクラスタの含意は、SaaSの優位の源泉だった「custom softwareが高価だった」という前提が崩れたことだ。YCは「The moat that once protected legacy SaaS — millions of lines of code, built over decades — is gone」と踏み込み、AIネイティブ企業の機会は「ツールの改善」ではなく「サービスや既存スタックそのものの置換」にあると位置づけている。

## 計算基盤——エージェント処理に最適化した推論シリコンと半導体供給網

第二のクラスタは、上記のソフトを支える計算基盤に向かう。

- **Inference Chips for Agent Workflows**（Diana Hu）：エージェントは「loop: calling tools, branching, backtracking」する処理であり、「Current GPUs hit 30 to 40 percent of peak utilization on these workloads.」根拠として「NVIDIA bought Groq for $20 billion」「Google built TPU v7 for inference specifically」を挙げ、実行グラフ全体で持続する「KV caches」向けメモリが鍵だとする。
- **Supply Chain 2.0 for Semiconductors**（Diana Hu）：「A single advanced AI chip goes through about 1,400 process steps, crosses a dozen countries, and takes five months to build.」「In 2021 a $300 chip held up a $50,000 car, and $210 billion in vehicles didn't get built.」さらに「TSMC's advanced packaging is the single biggest bottleneck」で「NVIDIA has locked up over 60 percent of it」、「HBM memory is booked through 2026」。CHIPS Actで「Arizona, Texas, Ohio, and New York」に新fabが立ち上がる。
- **Electronics in Space**（Philip Johnston）：「reusable rockets from SpaceX and Stoke Space」により宇宙の計算需要が拡大。宇宙向け推論チップは「mass」「thermal」「radiation」に最適化される。
- **Industrial Capabilities in Space**（Adi Oltean）：月や宇宙での「electrolysis」による「silicon, aluminum, iron, and titanium」の抽出と、「molten regolith」からの複雑構造の3Dプリント。
推論需要の形そのものが「prompt in, response out」からエージェントのループ実行へ変わり、それがシリコン設計（チップとコンパイラ）と、その製造を支える供給網（パッケージング・HBM・国内fab・宇宙）まで一連のテーマを形成している。Diana Huが計算基盤系の複数テーマに署名している事実は、この領域がRFSの重心であることを示す。

## AIの物理世界への展開——農業・医療・防衛・ハードウェア

第三のクラスタは、AIの知能を物理的な行動に接続する領域である。

- **AI for Low-Pesticide Agriculture**（Garry Tan）：AIが個々の雑草・害虫を実時間で識別し、ロボットが一株単位で処置する。「The company that cuts pesticide use by 90% and helps farmers grow more food」を「generational company」と表現する。
- **AI Personalized Medicine**（Ankit Gupta）：「an agent harness like Claude Code」で診断・ゲノム・EHR・ウェアラブルのデータを解析。ゲノム解読コストは「faster than Moore's law」で低下し、「n of 1 genetic therapies」をmRNA等の搬送系で実現するという。
- **AI-Native Discovery Engines**（Jon Xu）：フロンティアモデルが「PhD-level performance on many scientific reasoning benchmarks」に達し、「design-make-test-analyze loop」を閉じる方向へ移る。
- **Counter-Swarm Defense**（Tyler Bosmeny）：「A Patriot missile costs three million dollars. An FPV drone? Five hundred bucks.」コストの非対称を突き、ドローン防衛は「more like Cloudflare than Raytheon」へ向かうとする。
- **Hardware Supply Chain**（Nicolas Dessaigne）：深圳では設計から新部品まで「a day」、米国では同じループに「weeks」かかる。例として「Hlabs (W26)」「Prototyping.io (P26)」を挙げる。
- **Startups That Want to Sell to Huge Companies**（Harshita Arora、Brad Flora）：F100規模の企業がパイロットや「multimillion dollar deals」をYCバッチ中に締結する例が増えていると述べる。
この物理世界クラスタの共通項は、コストの非対称（Patriot $3M 対 FPV $500、農薬の90%削減）を市場規模の根拠として繰り返し提示する点にある。

## 本サイトにとっての含意

このRFSは、本サイトが追う「AIネイティブな組織・働き方」というテーマと正面から重なる。とりわけ "Software for Agents"・"Company Brain"・"The AI Operating System for Companies" は、エージェントが一級市民（first-class citizens）として扱われるソフト基盤を要請しており、人間向けUIを前提にした既存スタックの作り直しを促している。YCの言葉を借りれば、次世代の機会は「agents as first-class citizens」を前提に構築された基盤の側にある。
