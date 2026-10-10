---
title: "Anthropic、SDK・MCP サーバーツーリング企業 Stainless を買収"
lang: "ja"
type: "explanation"
category: "Big Tech"
date: "2026-05-24"
abstract: "Anthropic announced the acquisition of Stainless, a company known for developer tooling focused on API SDK generation and maintenance. The move suggests Anthropic is investing in stronger developer infrastructure and tooling to improve how teams build, integrate, and ship AI-powered applications, reflecting a broader rethinking of the software development lifecycle around AI-native workflows."
notionId: "36ad0f0b-e61e-81ce-b09b-fdefbd6c3e62"
sourceUrls: "https://www.anthropic.com/news/anthropic-acquires-stainless"
---

# Anthropic、SDK・MCP サーバーツーリング企業 Stainless を買収

## Executive Summary

Anthropic は 2026年5月18日、SDK と MCP server tooling のリーダーである Stainless の買収を発表した。発表文は、AI の重心が「答えるモデル」から「行動するエージェント」へ移るなかで、Claude の接続先となるデータやツールへの到達能力を広げるための組織統合としてこの買収を位置づけている。

Anthropic は Stainless が API 初期から「every official Anthropic SDK」の生成を担ってきた点を明示しており、今回の買収は新規提携というより、既存の開発者基盤を内製化・一体運用する動きとして読める。

## Stainless 買収の公式な位置づけ

Anthropic は今回の発表を、モデル性能そのものではなく、エージェントがどのシステムに接続できるかという実行能力の拡張として説明している。

- エビデンス
- 発表日は「May 18, 2026」。
- Anthropic は「Today, Anthropic is acquiring Stainless, a leader in SDKs and MCP server tooling, to extend that reach even further.」と述べている。
- 同文脈で「The frontier of AI is shifting from models that answer to agents that act—and agents are only as capable as the systems they can reach.」と記している。
- 結論
- 買収の主眼は、単体モデルの高度化ではなく、Claude を中心としたエージェントの接続性を強化することに置かれている。
- Anthropic 自身が「reach」を強調しており、開発者向け基盤をエージェント実行環境の一部として扱っていることがわかる。
## Stainless が担ってきた Anthropic SDK 基盤

発表文は、Stainless が Anthropic にとって周辺ツールのベンダーではなく、既存 SDK 供給の中核だったことを明記している。

- エビデンス
- Stainless は「Founded in 2022」。
- Anthropic は「Stainless has powered the generation of every official Anthropic SDK since the earliest days of our API.」と説明している。
- Stainless について「Hundreds of companies rely on Stainless to generate SDKs, CLIs, and MCP servers—the libraries, command-line tools, and connectors that let developers and agents use an API.」と記載している。
- 対応言語として「TypeScript, Python, Go, Java, and more」が挙げられている。
- 生成物について「Each one is fast, reliable, and built to feel native in its language.」としている。
- 結論
- Anthropic にとって Stainless は将来投資先というより、すでに本番の SDK 供給を支えてきた実績ある基盤である。
- SDK、CLI、MCP servers を同じ文脈で並べている点から、Anthropic は API 利用体験を単なるライブラリ提供ではなく、開発者とエージェントの双方が API を使うための総合的な接続レイヤーとして捉えている。
## Claude API から Claude の「data and tools」接続へ

Anthropic 幹部コメントは、買収の狙いを Claude API の開発者体験改善に留めず、Claude 自体の外部接続能力の拡張にまで広げている。

- エビデンス
- Katelyn Lesse, Head of Platform Engineering at Anthropic は次のように述べている。
「Stainless has shaped how developers experience the Claude API since the start, and it’s been great to work with them on that」

- 続けて次のように述べている。
「Agents are only as useful as what they can connect to. We’re excited to bring the Stainless team into Anthropic to advance Claude’s ability to connect to data and tools.」

- 結論
- Anthropic はこの買収を、SDK の品質改善だけでなく、Claude の「data and tools」接続能力の向上施策として表現している。
- Platform Engineering 責任者の発言であることから、対象はマーケティング上のメッセージではなく、Claude Platform の接続設計そのものと解釈できる。
## MCP を軸にした agent connectivity の内製化

発表の末尾では、Anthropic が MCP を agent connectivity の基盤として位置づけ、その上で Stainless チームとの統合を Claude Platform の推進力として描いている。

- エビデンス
- Anthropic は「Anthropic created MCP to make agent connectivity possible.」と記している。
- そのうえで「By bringing together the Stainless and Anthropic teams, the Claude Platform continues to push the frontier of developer experience and agent connectivity.」としている。
- Stainless の Founder and CEO である Alex Rattray は次のように述べている。
「I started Stainless because SDKs deserve as much care as the APIs they wrap. Anthropic was one of the first teams to bet on this with us.」

- さらに次のように述べている。
「We have been watching what developers have built on Claude over the last few years, which made bringing our teams together an easy decision. The team gets to keep doing the work we love, on the platform where it matters most.」

- 結論
- Anthropic は MCP を agent connectivity の成立条件として再確認し、その周辺ツーリングを外部連携ではなくチーム統合によって取り込む構図を示している。
- Alex Rattray のコメントからは、Stainless 側にとっても Anthropic は初期顧客の一社であり、今回の買収は既存協業を前提にした延長線上の統合であることが読み取れる。