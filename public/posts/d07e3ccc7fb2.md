---
title: "Jensen Huangが定義するAIの未来"
type: "explanation"
category: "A: AI Hyper-productivity"
date: "2026-03-30"
abstract: "Jensen Huang氏の対談から、AI進化の要点を抽出。"
notionId: "34fd0f0b-e61e-810f-81cc-d07e3ccc7fb2"
sourceUrls: "https://lexfridman.com/jensen-huang-transcript/"
---

# Jensen Huangが描く「AI factory」への移行：extreme co-design、CUDA、4つのscaling laws

## Executive Summary

Jensen Huang氏は、AIの進化を「より良いチップ」ではなく、GPU・CPU・memory・networking・storage・power・cooling・software・rack・pod・data centerまで含む「extreme co-design」の問題として定義している。単体GPUの性能向上ではなく、分散された計算全体をどう成立させるかが中心課題だという整理である。

同氏の議論では、NVIDIAの転換点はCUDAをGeForceに載せてinstall baseを先に作った判断と、AIのscaling lawsをpre-trainingだけでなくpost-training、test time、agenticへ拡張して捉えている点にある。知能のスケーリングを最終的に規定するものは「compute」だと位置づけている。

## Extreme co-designは「1台のGPU」ではなく「分散問題」を解く設計思想

Huang氏は、extreme co-designが必要になった理由を、解くべき問題が「one computer to be accelerated by one GPU」に収まらなくなったからだと説明する。目標は、たとえば「10,000 computers」を追加したときに、単なる台数比例ではなく「a million times faster」を狙うことにある。

- エビデンス
- Huang氏は、問題を高速化するにはアルゴリズムを「break up」「refactor」し、「shard the pipeline」「shard the data」「shard the model」する必要があると述べている。
- その結果、「the CPU is a problem, the GPU is a problem, the networking is a problem, the switching is a problem」となり、分散そのものが課題になると整理している。
- 背景として「Amdahl’s law problem」を挙げ、計算部分だけを極端に高速化しても、全体性能は非計算部分に制約されると説明している。
- Moore’s Lawについては「has largely slowed because Dennard scaling has slowed」と述べ、単純な半導体進化だけでは足りないという前提を置いている。
- co-designの対象は「architectures to chips, to systems, to system software, to the algorithms, to the applications」に加え、「CPUs and GPUs and networking chips and scale up switches and scale out switches」「power and cooling」まで広がっている。
- 結論
- Huang氏のAI観では、性能ボトルネックはGPU単体ではなく、分散実行時に露出する通信・切替・電力・冷却・ソフトウェアの総和にある。
- したがって、AIインフラの競争軸は半導体単体の優劣ではなく、ラックスケール、さらにdata centerスケールでの整合設計へ移っている。
- 「AI factory」という見立ては比喩ではなく、計算資源の束ね方そのものを製品化する発想として語られている。
## NVIDIAの組織設計は、製品ではなくco-designのために最適化されている

Huang氏は、会社組織もまたco-designの対象だと述べる。会社は「the machinery, the mechanism, the system that produces the output」であり、その構造は作りたい製品と置かれた環境を反映すべきだという立場である。

- エビデンス
- Huang氏は「My direct staff is 60 people」「More」と述べ、直属スタッフが「60 people」を超えると説明している。
- その多くは「memory」「CPUs」「optical」「GPUs」「Architecture」「algorithms」「design」の専門家だとしている。
- 「I don’t do one-on-ones」と明言し、「No conversation is ever one person. We present a problem and all of us attack it」と述べている。
- 個別テーマが「cooling」「networking」であっても全員が聞き、「This doesn’t work for the power distribution」「This doesn’t work for the memory」と横断的に介入できる形を取っている。
- 同氏は、一般的な会社のorganization chartを「hamburger organization charts, soft organization charts, and car company organization charts. They all look the same」と批判している。
- 結論
- NVIDIAの組織は、機能別分業の効率よりも、相互依存の強い技術課題を同時解決することを優先して設計されている。
- Huang氏がone-on-oneを避けるのは管理手法の好みではなく、extreme co-designの前提条件として情報を横流しするためである。
- ここではCEOの役割も意思決定の一点集中ではなく、専門家同士を同じ問題空間に置き続ける統合装置として定義されている。
## CUDAをGeForceに載せた判断は、install baseを先に作るための賭けだった

Huang氏は、NVIDIAの初期を「accelerator company」と位置づけつつ、そのままではapplication domainが狭く、market sizeがR&D capacityを制約すると振り返る。そこで同社はspecializationを維持しながらcomputing companyへ拡張する「really narrow path」を進んだという。

- エビデンス
- 同氏は移行の段階として、「programmable pixel shader」、次に「FP32」「IEEE-compatible FP32」、その上に「C on top of FP32」「Cg」、最終的に「CUDA」と説明している。
- 決定的だったのは「putting CUDA on GeForce」であり、これは「very, very hard to do」「as close to an existential threat」と表現されている。
- 理由として、「a computing platform is all about developers」であり、開発者を引きつけるには「the install base is large」でなければならないと述べている。
- Huang氏は「The install base is, in fact, the single most important part of an architecture」「Install base defines an architecture. Not… Everything else is secondary」と明言している。
- 競合として「OpenCL」や「x86」「RISC architectures」に触れつつ、設計の美しさより普及基盤が支配的だと論じている。
- 当時、GeForceは「millions and millions of GeForce GPUs a year」を販売しており、これを使ってCUDAを「every single PC whether customers use it or not」に入れる判断をした。
- その結果、「CUDA increased our cost of that GPU」「completely consumed all of the company’s gross profit dollars」となり、「we increased our cost by 50%」とも述べている。
- 当時NVIDIAは「35% gross margin company」で、market capは「eight… Was it like $8 billion or something? Like six, $7 billion or something like that」から、「one and a half billion dollars」まで下がったと語っている。
- それでも「it took a decade」としつつ継続し、「NVIDIA is the house that GeForce built」と述べている。
- さらに大学に出向き、「wrote books and taught classes and put CUDA everywhere」として開発者育成を進めたという。
- 結論
- CUDA戦略の核心は、技術優位ではなくinstall baseの先行確保にあった。
- GeForceにCUDAを載せた判断は、consumer productに将来のcomputing architectureのコストを背負わせる構図であり、短期収益を犠牲にしたプラットフォーム形成策だった。
- Huang氏の説明では、deep learning革命はCUDAが偶然乗ったのではなく、PCを通じて研究者・学生に先回りで配布された結果として接続された。
## 「4つのscaling laws」は、pre-trainingからagenticまで循環する

Huang氏は「Yeah, we have more scaling laws now」と述べ、AIのスケーリングを1本の法則ではなく複数段階の連鎖として捉えている。会話中で明示されたのは「pre-training, post-training, test time, and agentic scaling」である。

- エビデンス
- pre-trainingについては、「The larger the model, the correspondingly more data results in a smarter AI」と説明している。
- 「Ilya Sutskever said, ‘We’re out of data,’ or something like that. ‘Pre-training is over,’ or something like that」と言及しつつ、それを「obviously not true」と退けている。
- 今後のデータについては「A lot of that data is probably gonna be synthetic」とし、人間が作って教え合うデータ自体が本質的に「synthetic」だと論じている。
- その結果、「the amount of data that we use to train models is going to continue to scale to the point where we’re no longer limited… Data is now limited by compute」と述べている。
- test timeについては、「Inference? Oh, yeah, that’s easy」という見方を否定し、「inference is thinking, and I think thinking is hard」「Thinking is way harder than reading」と述べる。
- pre-trainingを「memorization and generalization」「reading and reading」と表現する一方、test time scalingは「reasoning」「planning」「search」に関わるため「intensely compute intensive」だとしている。
- さらにagentic scalingについては、1つのagentic systemが「spawns off a whole bunch of sub-agents」するとし、「the next scaling law is the agentic scaling law. It’s kind of like multiplying AI」と説明している。
- この結果生じた経験やデータのうち有用なものを「We ought to memorize this」として再びpre-trainingに戻し、「This loop, this cycle, is gonna go on and on and on」と述べている。
- 最終的に「intelligence is gonna scale by one thing, and that’s compute」と総括している。
- 結論
- Huang氏は、AIの進歩を「学習済みモデルの大型化」だけではなく、synthetic data生成、test time reasoning、sub-agent増殖まで含む循環系として見ている。
- この見方では、データ不足は終点ではなく、synthetic dataとagentic systemsによって再生産される中間制約に変わる。
- したがって、compute需要は学習時だけでなく、推論時・推論後のエージェント運用時にも拡張し続けるという前提が置かれている。
## AIモデルは「about once every six months」、hardwareは「every three years」で進む

Huang氏は、AIのscalingを支えるうえで最も難しい点の1つとして、モデル進化の速度とhardware開発周期のズレを挙げている。Lex Fridman氏が「You have to anticipate where the AI innovation’s going to lead」と指摘すると、Huang氏はこれを明確に肯定している。

- エビデンス
- Huang氏は「these AI model architectures are being invented about once every six months」と述べている。
- 一方で「system architectures and hardware architectures kind of every three years」と説明している。
- そのため「you need to anticipate what likely is going to happen, you know, two, three years from now」と語っている。
- 文脈上、これは「mixture of experts with sparsity」のようなモデル上の変化に対して、hardware側は「just pivot on a week’s notice」できないという問題設定に対応している。
- 結論
- Huang氏のいうAIインフラ企業の難所は、現時点の需要に最適化することではなく、2〜3年先のモデル構造を前提に設計を固定しなければならない点にある。
- ここでextreme co-designは、既知の要件を統合する手法であると同時に、不確実な将来のモデル特性を織り込む予測行為でもある。
- 同氏の議論では、NVIDIAの優位は部品性能ではなく、この時間差を吸収する設計と意思決定の連結に置かれている。