---
title: "NVIDIA「OpenShell Reference Architecture」——エージェントの安全を、ソフトウェアの外側のシリコンで強制する"
lang: "ja"
type: "explanation"
category: "Agentic AI"
date: "2026-10-25"
abstract: "NVIDIAは2026年10月21日、エージェントの封じ込めをソフトウェア境界の外側にあるシリコンで強制する「OpenShell Reference Architecture」を発表した。Vera Rubin（推論）、Vera CPU（ハーネス）、BlueField-4上のSentry（監視・隔離）を組にした設計だが、数値と提携先はすべてNVIDIA自身の主張である。"
notionId: "404d0f0b-e61e-81ec-9358-f1d7b9bffcaf"
sourceUrls: "https://nvidianews.nvidia.com/news/openshell-reference-architecture"
author: "ingrid"
---

## Executive Summary

NVIDIAは2026年10月21日、GTC Berlinで「OpenShell Reference Architecture」を発表した。エージェントが動くVera Rubin基盤、ハーネスを動かすVera CPU、そして挙動を監視して逸脱を止めるBlueField-4 DPU上の「NVIDIA Sentry」を一組にした参照設計である。核心は、エージェントの封じ込めをソフトウェア境界の内側ではなく、その外側にあるシリコンで強制するという設計思想にある。ただし数値と提携先はすべてNVIDIA自身のプレスリリースによるもので、第三者による検証はまだ示されていない。

## 何が発表されたか

発表の骨子は、エージェントの構築・封じ込め・観測・強制（build, contain, observe, enforce）を企業インフラとエッジの両方で行うための参照設計である。構成要素は次の通り。

- **NVIDIA Vera Rubin（Vera Rubin NVL72）**: モデル推論を担う。事前学習・事後学習・推論に融通できる基盤で、エージェント型ワークロードでは「メガワットあたりのスループットが30倍」とされる。Nemotronで作られたものを含む、クローズドおよびオープンなモデルの実行も対象に挙げられている。
- **NVIDIA Vera CPU**: エージェントのハーネスとツール利用を動かす。「x86プロセッサの2倍の性能」「より高いエネルギー効率」とされ、オープンソースの**NVIDIA OpenShell**（自律エージェントに安全なランタイム境界を与えるソフトウェア）を実行する。
- **NVIDIA BlueField-4 DPU + NVIDIA Sentry**: DOCAソフトウェア上に作られた統合セキュリティフレームワーク。エージェントの挙動を帯域外で継続監視し、「エージェントがソフトウェア境界の外へ出ようとすると、Sentryが数ミリ秒で隔離・停止する」とされる。Sentryは「エージェント容量を最大20%押し上げる」という記述もある。
- **エッジ**: NVIDIA RTX Spark、DGX Spark、DGX Stationに拡張でき、小売、ヘルスケア、製造、ロボティクス、ソフトウェア開発、通信などを想定する。
提供状況は「now available（提供中）」とされている。

## 設計思想：Jensen Huangの言葉が示すもの

ジェンスン・フアンCEOは「AIの能力と安全は同時に進歩しなければならない」と述べ、「エージェントが明確に定義された境界の中で有用な仕事をする自由を与える」ためにOpenShellを作ったと説明する。続けて「エージェントはRubinで考え、Vera上で行動し、BlueField上で統制される（think on Rubin, act on Vera, governed on BlueField）」と言う。

これは役割分担の宣言である。考える層、行動する層、統制する層を別のハードウェアに分ける。統制をエージェントと同じプロセスやソフトウェアスタックに置かないことで、エージェントが侵害されたり誤動作したりした場合でも、統制側が巻き込まれにくいという理屈だ。これは原文が明言している範囲を超えた推論ではなく、「ソフトウェア境界の外へ出ようとした場合にSentryが止める」という記述の構造をそのまま読んだものである。

## 誰が何をしているか（すべて発表者の主張）

提携先は幅広く挙げられているが、「連携している」「統合を進めている」「探っている」という程度の差がある。区別して読む必要がある。

- **OS・オーケストレーション**: Canonical、SUSE、Red Hat上のLinuxとKubernetes。Microsoft Windowsは Microsoft Execution Containers（MXC）経由。AWS、Google Cloud、Microsoft Azureのクラウドでも動かせるとされる。
- **モデル提供者**: Anthropic、Cohere、Google、Meta、OpenAI、Perplexity、Reflection、SpaceX Super Intelligenceのエージェントを、OpenShellインフラ上で動かせるとされる。
- **セキュリティ企業**: 1Password、Check Point、CrowdStrike、Cisco、F5、Fortinet、Microsoft、Okta、Palo Alto Networks、TrendAI、Zscalerが、自社のエージェント向けセキュリティ製品にOpenShell Reference Architectureへの対応を「統合中」。
- **金融**: 欧州のBBVAとSantanderが、エージェントの安全・セキュリティ・ガバナンスの枠組みとして「探っている（exploring）」段階。
- **ソフトウェア**: Cadence、Dassault Systèmes、IBM、SAP、Siemens、Synopsysがエージェント基盤の構築に利用。PalantirはNVIDIAと顧客への本番展開を進める。SAPはJoule Studioランタイムに統合する。
- **ServiceNow**: 個人向けの長時間稼働エージェント「ServiceNow Arc」を一般提供開始。実行時の行動はServiceNow Super Intelligence Control Towerが統治し、OpenShellが強制する。同社のAI Passport権限レイヤーがポリシーをOpenShellとSentryに運び、「ソフトウェアからハードウェアまで、エージェントのアクセスを数秒で取り消せる」とされる。
- **ハードウェア・クラウド**: Dell Technologies、Cisco、HPE、Lenovo、Supermicroがインフラを構築。CoreWeave、Crusoe、Firebird、Firmus、GMI Cloud、IREN、Lambda、Nebius、Nscale、Oracle Cloud Infrastructure、VultrがOpenShell対応基盤を展開。Baseten、Deepinfra、Fireworks、Together AIは自社のモデル開発パイプラインに統合する。
## 読み方：何が事実で、何が未検証か

**事実として確認できるもの**は、発表日（2026年10月21日）、構成要素の名称と役割分担、提携先の列挙、そして「提供中」という提供状況である。

**未検証のもの**は次の通り。「30倍のスループット/MW」「x86の2倍」「最大20%の容量増」「数ミリ秒での隔離」はいずれもNVIDIA自身の数値で、測定条件が本文に示されていない。提携先の関与の深さも、「統合中」から「検討中」まで幅があるにもかかわらず、一つの列挙にまとめられている。また、リリース自身が末尾の免責で、記載の製品や機能の多くは「when-and-if-available（提供可能になり次第）」で提供され、時期は変わりうると断っている。「now available」と免責の両方が同じ文書に並ぶ点は、読者が自分で重みを付けるべきところだ。

## 示唆：エージェント運用の論点がどこに移るか

本稿の結論は、この発表自体より、そこに現れた論点の移動にある。エージェントの安全は、これまでプロンプトやモデルの振る舞い、あるいはソフトウェアのガードレールの問題として語られがちだった。この参照設計は、それをインフラの問題、つまり「誰が・どの層で・どれだけ速く止められるか」の問題として提示している。ServiceNowの例が示すように、権限の取り消しをソフトウェアとハードウェアの両方で数秒以内に行うという要件は、運用組織にとって監査可能な基準になりうる。

一方で、この設計を採用するかどうかは、ベンダー固有のハードウェア（BlueField-4やVera）への依存をどこまで許容するかという別の判断を伴う。参照設計はNVIDIAのスタックを前提としており、その外側で同等の強制をどう実現するかは、本文からは読み取れない。
