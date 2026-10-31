---
title: "NVIDIA「OpenShell Reference Architecture」:エージェントの安全をチップ側で強制するという賭け"
lang: "ja"
type: "explanation"
category: "AI Infrastructure"
date: "2026-10-26"
abstract: "OpenShell Reference Architecture は、モデル推論(Vera Rubin)・エージェント実行(Vera CPU)・監視と強制(BlueField-4上のSentry)を物理的に分離し、安全性をソフトウェア境界からシリコン内の強制へ移す設計だ。数値や提携先はすべてNVIDIA自身の発表で、第三者検証はない。"
notionId: "405d0f0b-e61e-816b-aaca-cef5c7e1c1f0"
sourceUrls: "https://nvidianews.nvidia.com/news/openshell-reference-architecture?utm_source=chatgpt.com"
author: "ingrid"
---

## Executive Summary

NVIDIAは2026年10月21日、GTC Berlinで「OpenShell Reference Architecture」を発表した。エージェントの推論をVera Rubin、実行をVera CPU、監視と強制をBlueField-4 DPU上のNVIDIA Sentryに割り当て、安全性を「ソフトウェアの境界」から「シリコン内の強制」へ移す設計である。重要なのは性能数値よりも、エージェントを動かす計算機と、エージェントを取り締まる計算機を物理的に分けるという設計思想そのものだ。ただし数値と提携先はすべてNVIDIA自身の発表であり、第三者による検証はこの文書にはない。

## 何が発表されたか(エビデンス)

発表文によれば、OpenShell Reference Architectureは「企業インフラとエッジシステム上で、安全なエージェントを構築・封じ込め・観測・強制する」ための参照アーキテクチャである。土台は既存のセキュア・ランタイム「NVIDIA OpenShell」で、これをフルスタックのインフラへ拡張したものと説明されている。構成要素は次の4層だ。

- **NVIDIA Vera Rubin**:モデル推論を担う。NemotronベースのクローズドおよびオープンなモデルをVera Rubin NVL72インフラ上で動かす。発表文は、エージェント向けワークロードで「メガワット当たりのスループットが30倍」と述べる。
- **NVIDIA Vera CPU**:エージェントのハーネスとツール利用を担う。発表文は「x86プロセッサの2倍の性能とより高いエネルギー効率」とし、ここでオープンソースのOpenShellが動き、自律エージェントのための「セキュアなランタイム境界」を提供する。
- **NVIDIA BlueField-4 DPU + NVIDIA Sentry**:DOCAソフトウェア上に構築されたSentryが、エージェントの挙動を帯域外で継続的に監視し、ポリシーをシリコン内で強制する。発表文によれば、エージェントがソフトウェア境界の外へ出ようとした場合、Sentryは「ミリ秒で」隔離して停止する。またSentryはエージェント容量を最大20%押し上げるとされる。
- **エッジ**:NVIDIA RTX Spark、DGX Spark、DGX Stationにより、小売、ヘルスケア、製造、ロボティクス、ソフトウェア開発、通信といった業界のエッジ上のエージェントにも拡張できる。
対応OSは、Canonical、SUSE、Red Hat由来のLinux/Kubernetes基盤と、Microsoft Execution Containers(MXC)を用いたMicrosoft Windows。クラウドはAmazon Web Services、Google Cloud、Microsoft Azureで動作するとされる。提供状況は「now available(現在利用可能)」の一文のみで、価格や出荷時期の詳細は書かれていない。

ジェンスン・フアンCEOの引用は設計思想を一行で要約している。「エージェントは Rubin で考え、Vera で行動し、BlueField で統治される」。同氏はさらに、企業が「数十億のAIエージェント」を展開しようとしている今、安全と制御は計算アーキテクチャに組み込まれなければならない、と述べた。

## 誰が乗っているか(エビデンス)

発表文が挙げる関係者は広い。

- **モデル提供者**:Anthropic、Cohere、Google、Meta、OpenAI、Perplexity、Reflection、SpaceX Super Intelligenceのエージェントを、OpenShellインフラ上で動かせる。
- **セキュリティ事業者**:1Password、Check Point、CrowdStrike、Cisco、F5、Fortinet、Microsoft、Okta、Palo Alto Networks、TrendAI、Zscalerが、自社のエージェント向けセキュリティ製品にOpenShell Reference Architectureへの対応を組み込んでいる。
- **金融**:欧州のBBVAとSantanderが、エージェントの安全・セキュリティ・ガバナンスの枠組みとしての可能性を、NVIDIAと「探索」している。
- **ソフトウェア**:Cadence、Dassault Systèmes、IBM、SAP、Siemens、Synopsysがエージェント・ソフトウェア基盤の構築に利用する。PalantirはNVIDIAと顧客のもとで本番のセキュアなエージェントを展開している。SAPはJoule Studioランタイム(SAP Business AI Platformの一部)と統合する。
- **システム製造とクラウド**:Dell Technologies、Cisco、HPE、Lenovo、Supermicroがインフラを構築し、CoreWeave、Crusoe、Firebird、Firmus、GMI Cloud、IREN、Lambda、Nebius、Nscale、Oracle Cloud Infrastructure、Vultrが対応インフラを展開する。Baseten、Deepinfra、Fireworks、Together AIはモデル開発パイプラインに統合する。
最も具体的な事例はServiceNowだ。同社は「ServiceNow Arc」(長時間稼働する個人用AIエージェント)の一般提供を発表した。その行動は「ServiceNow Super Intelligence Control Tower」によって実行時に統治され、NVIDIA OpenShellによって強制される。さらにServiceNowのAI Passport権限レイヤーが、そのポリシーをOpenShellとSentryに運び、企業は「ソフトウェアとハードウェアの両方にわたり、AIエージェントのアクセスを数秒で失効」できるという。

## 読み解き(結論)

以下は発表文の事実から私たちが導く解釈であり、NVIDIAの主張ではない。

**1. 「誰が見張るか」の分離が核心である。** 従来のエージェント安全策は、エージェントと同じプロセスやランタイムの内側に置かれたガードレールが中心だった。今回の設計は、監視と強制を別のシリコン(BlueField-4)に出す。発表文の言葉でいえば「帯域外」の監視である。エージェントが侵害されても監視側は同じ攻撃面を共有しない、というセキュリティ上の古典的な利点を、エージェント運用に持ち込む試みと読める。

**2. ミリ秒の隔離は、人間の承認を前提にしない。** 発表文は、境界を越えた場合にSentryが「quarantines and stops it in milliseconds」と書く。ミリ秒の応答は人間のレビューが入る余地がない。つまりこの設計は「人が毎回承認する」運用ではなく、事前に定義した境界の内側で自律させる運用を前提とする。「clearly defined boundaries」の中で自由に働かせるというフアン氏の言葉と整合する。境界の定義の質が、そのまま安全性の質になる。

**3. 失効の速さが統治の実体になる。** ServiceNowの例で重要なのは、検知よりも「数秒でアクセスを失効できる」点だ。数十億のエージェントを前提にするなら、個別に止める手作業は成立しない。権限を一箇所で取り消し、ソフトウェアとハードウェアの両方に伝播させる経路が必要になる。ここでは AI Passport が政策の出どころ、OpenShell/Sentry が執行点という役割分担になっている。

**4. 参照アーキテクチャという形式の意味。** 製品の発表ではなく「参照アーキテクチャ」である点は見落とせない。モデル提供者、セキュリティ事業者、OEM、クラウドが同じ構成図に並ぶことで、エージェントの安全基盤を各社ごとの独自実装ではなく、共通の接続点として標準化する意図が読み取れる。一方で、これはNVIDIAのハードウェアを前提とする標準化でもある。

## 割り引いて読むべき点

- 「30倍」「2倍」「最大20%」はいずれもNVIDIAの数値であり、比較条件(何と比べた30倍か、どのワークロードか)は発表文に書かれていない。
- 「working with」「exploring」「integrating」といった表現が多く、パートナーの実運用への採用度合いは文面から区別できない。BBVAとSantanderは明示的に「探索」の段階である。
- 発表文自体が、多くの製品や機能は「when-and-if-available basis」で提供され、時期は変更され得ると注記している。「now available」と将来見通しの免責が同居している。
- 「ミリ秒で停止」の精度、誤検知率、ポリシー記述の方法についての情報はない。安全性を判断する材料としては不足している。
## 実務上の含意

自律エージェントを運用する組織にとっての実務的な問いは、NVIDIAの構成を採るか否かの前に、自社の設計が次の三点に答えられるかだ。エージェントを監視する主体はエージェントと独立しているか。境界はあらかじめ機械可読な形で定義されているか。権限の失効は数秒で全体に及ぶか。OpenShell Reference Architectureは、この三点に対するひとつの具体的な回答として公開された。その実効性は、第三者の評価と本番の運用記録が出てから判断すべきである。
