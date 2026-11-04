# WS1 ファクトパック — 基盤・セキュリティ・権限 (H-2.1, H-2.2, H-4.1, H-4.2)

- 担当: sora (研究員。一次資料を先に読み、出典のない主張は仮説として扱う)
- 作成日: 2026-11-04 / 検索予算 12 回をすべて使用し、以降は URL 直接取得のみ
- 範囲: エージェント固有のセキュリティ事故、非人間ID・エージェント認可の標準化状況、人間による監督の規範、データ分類と段階的アクセス
- 方法: 一次資料 (NVD API の JSON、MCP 仕様本文、NIST AI 100-1 の PDF、Microsoft Learn、OWASP、CSA、IETF datatracker、JFrog/Invariant の公開アドバイザリ) をページ上で確認した。Gartner、ISO、TechRepublic は 403 で本文を取得できなかったため、該当する所見の確度を下げている。

## 1. 所見 (findings)

| F-ID | 仮説 | 所見 (値 · 単位 · 期間 · 対象範囲 / 何ではないか) | S-ID | 確度 |
|---|---|---|---|---|
| F-1.1 | H-2.1 | **EchoLeak (CVE-2025-32711)**。NVD の公開日は 2025-06-11。NVD の記述は "AI command injection in M365 Copilot allows an unauthorized attacker to disclose information over a network"。CVSS v3.1 は CNA である Microsoft が **9.3**、NVD が **7.5**。同じ CVE でも採点者によって値が違う。対象は Microsoft 365 Copilot (SaaS) のみで、オンプレミス製品は含まない | S-1.1 | A |
| F-1.2 | H-2.1 | EchoLeak は Aim Labs (Aim Security) が報告した。ゼロクリックの間接プロンプトインジェクションで、OneDrive・SharePoint・Teams の組織データを持ち出せた。Microsoft がサーバー側で修正済みで、顧客側の対応は不要とされる。「悪用は確認されていない」とする報道もある。「AI エージェントに対する初のゼロクリック攻撃」という形容は発見者ベンダ自身の主張である。修正日と悪用の有無は MSRC 本文が取得できず、**一次では NOT FOUND** | S-1.2, S-1.3 | B |
| F-1.3 | H-2.1 | **GitHub MCP の "toxic agent flow"** (Invariant Labs、2025-05-26)。公開リポジトリの悪意ある Issue による間接プロンプトインジェクションで、エージェントが利用者の**非公開リポジトリ**の内容を公開 PR に書き出した。再現環境は Claude Desktop + Claude 4 Opus + 公式 GitHub MCP server。著者は「サーバーのコード欠陥ではなくアーキテクチャの問題」で、サーバー側のパッチでは直らないと述べ、対策として最小権限 (例: "You can access only one repo per session") と監視を挙げる。CVE は付与されていない (GitHub issue #844 で未解決)。実害の報告はなく、研究上の実証にとどまる | S-1.4 | A |
| F-1.4 | H-2.1 | **CVE-2025-6514 (mcp-remote)**。信頼できない MCP サーバーが返す `authorization_endpoint` URL を細工すると、クライアント側で OS コマンドを実行できる。NVD の公開日は 2025-07-09。CVSS は CNA の JFrog が **9.6**。影響範囲は 0.0.5〜0.1.15。修正はコミット 607b226 で示され、修正版の番号はページに記載がない。MCP の**認可フロー自体**が攻撃面になった例である | S-1.5, S-1.6 | A |
| F-1.5 | H-2.1 | **OWASP Top 10 for LLM Applications 2025** は LLM01 Prompt Injection、LLM02 Sensitive Information Disclosure、LLM06 **Excessive Agency** などの 10 項目からなる。LLM06 は根本原因を "excessive functionality; excessive permissions; excessive autonomy" の 3 点とし、対策に "Minimize extension permissions" と "Require user approval … for high-impact actions" (human-in-the-loop) を挙げる。英語版の公開日はページに明記がなく、2025 年版の各国語訳は 2025-03-12 付 | S-1.7, S-1.8 | A |
| F-1.6 | H-2.1 | **OWASP Top 10 for Agentic Applications for 2026** は 2025-12-09 に公開された。100 人超の専門家による peer-reviewed framework と説明されている (以上は一次で確認)。項目名は ASI01 Agent Goal Hijack、ASI02 Tool Misuse & Exploitation、ASI03 **Identity & Privilege Abuse**、ASI04 Agentic Supply Chain、ASI05 Unexpected Code Execution、ASI06 Memory & Context Poisoning、ASI07 Insecure Inter-Agent Communication、ASI08 Cascading Failures、ASI09 Human-Agent Trust Exploitation、ASI10 Rogue Agents。ただし**項目名は二次資料のみで確認**しており、OWASP のページには一覧の本文がない (PDF は未取得) | S-1.9, S-1.10 | B |
| F-1.7 | H-2.1 / H-2.2 | **CSA × Aembit 調査** (n=228、IT・セキュリティ実務者、2026 年 1 月にオンラインで実施、2026-03-24 公表、地域・規模は混在)。主な結果: 68% がエージェントと人間の活動を明確に区別できない / 74% が「エージェントは必要以上のアクセスを持つことが多い」/ 43% が共有サービスアカウントを使う / 31% がエージェントを人間の ID で動かしている / 52% がワークロード ID を使う / 79% がエージェントは監視しにくいアクセス経路を作ると回答。調査費は IAM ベンダの Aembit が出し、設問も共同で作った。母集団を代表する標本ではない | S-1.11 | A (値) / 注意: ベンダ出資 |
| F-1.8 | H-2.2 | **MCP 認可仕様 (2025-06-18 版)** の要点。"Authorization is **OPTIONAL** for MCP implementations"。HTTP 実装では OAuth 2.1 (**IETF draft-ietf-oauth-v2-1-13**、まだ RFC ではない)、RFC 8414、RFC 7591 (SHOULD)、RFC 9728 (MUST)、RFC 8707 resource indicators (MUST) に従う。サーバーは自分宛ての token だけを受け入れ (audience 検証)、"MUST NOT pass through the token it received"。STDIO 実装は "SHOULD NOT follow this specification"(認証情報は環境変数などから取る)。認可は既存の OAuth 部品を組み合わせて作られており、その中核の OAuth 2.1 自体がまだドラフトである | S-1.12 | A |
| F-1.9 | H-2.2 | **IETF のエージェント向け OAuth 拡張**。draft-oauth-ai-agents-on-behalf-of-user の最新は -02 (2025-08-25)。状態は **Expired の個人 Internet-Draft** で、ストリームはなく、"not endorsed by the IETF"。同系統の draft-song-oauth-ai-agent-authorization-00 (2025-07) と draft-yao-agent-auth-considerations-00 (2025-06) は検索結果でのみ確認した。2026-11 時点で WG に採択されたエージェント認可の RFC 案は **NOT FOUND** | S-1.13, S-1.14 | A (on-behalf-of) / C (他 2 件) |
| F-1.10 | H-2.2 | **OWASP Non-Human Identities Top 10 (2025)**: NHI1 Improper Offboarding、NHI2 Secret Leakage、NHI3 Vulnerable Third-Party NHI、NHI4 Insecure Authentication、NHI5 Overprivileged NHI、NHI6 Insecure Cloud Deployment Configurations、NHI7 Long-Lived Secrets、NHI8 Environment Isolation、NHI9 NHI Reuse、NHI10 Human Use of NHI。熟議の「最小権限シークレットと失効手順」(D7) は NHI1・NHI5・NHI7 にそのまま当たる。エージェントに限った文書ではなく、サービスアカウントなど非人間 ID 全般を扱う | S-1.15 | A |
| F-1.11 | H-2.2 | **CSA "Agentic AI Identity and Access Management: A New Approach"** (2025-08-18)。"traditional identity and access management (IAM) protocols, designed for static applications and human users, can't keep up"。"OAuth's static scope model cannot accommodate the fine-grained, resource-specific permissions that AI agents require" と述べ、DID・VC による専用の枠組みを提案する。一方、CSA の 2026-06 の research note は「既存 IAM の延長として扱え」と読める要約が二次資料にあり、CSA 内でも立場が揺れている可能性がある (後者は未読、C) | S-1.16 | A (2025 論文) |
| F-1.12 | H-2.2 | **Gartner 2025-06-11 プレスリリース** の題名は "Gartner Predicts that Guardian Agents will Capture 10-15% of the Agentic AI Market by 2030"。市場の定義と調査母数は本文 (403) が取れず **NOT FOUND**。2026-03 の二次報道は「現状は agentic AI 予算の 1% 未満、2028 年に 5–7%」とするが、Gartner の一次では未確認 (C) | S-1.17, S-1.18 | B (題名・数値) / C (2026 更新) |
| F-1.13 | H-4.1 | **EU AI Act 第 14 条** (Regulation (EU) 2024/1689)。対象は**高リスク AI システムに限る**。14(1) は "can be effectively overseen by natural persons during the period in which they are in use" を求める。14(4) は (a) 能力と限界の理解、(b) 自動化バイアスの自覚、(c) 出力の正しい解釈、(d) "decide … not to use" / 出力の無視・覆し、(e) "'stop' button or a similar procedure" を列挙する。汎用の社内業務エージェントの多くは高リスクに当たらない可能性があり、第 14 条を全エージェントの法的要件と読むのは過剰である | S-1.19 | A (条文要旨。掲載は準公式の条文サイト) |
| F-1.14 | H-4.1 | **適用日**。原規則は Annex III 高リスクを 2026-08-02 とした。「AI Omnibus」(Regulation (EU) 2026/1744、OJ 掲載 2026-07-24、発効 2026-07-27) により **Annex III は 2027-12-02、Annex I は 2028-08-02** に延期されたと複数の二次資料が報じ、条文サイトの表示もこれと一致する。EUR-Lex 本文は取得できず、**OJ 原文では NOT FOUND** | S-1.19, S-1.20 | B |
| F-1.15 | H-4.1 | **NIST AI RMF 1.0 (NIST AI 100-1、2023 年 1 月)**。任意の枠組み ("voluntary")。GOVERN 3.2 は "Policies and procedures are in place to define and differentiate roles and responsibilities for human-AI configurations and oversight of AI systems"。MAP 3.5 は "Processes for human oversight are defined, assessed, and documented"。MANAGE 2.4 は "Mechanisms … to supersede, disengage, or deactivate AI systems"。付録には "Human-AI configurations can span from fully autonomous to fully manual … Some AI systems may not require human oversight" とあり、監督の程度はリスクに応じて決めるという立場で、一律の HITL は求めていない | S-1.21 | A |
| F-1.16 | H-4.1 | OWASP LLM06 は、高影響の行動に人間の承認を要求することを標準的な対策として挙げる (F-1.5)。業界の規範は「すべてを承認する」ではなく「**高影響の行動だけを**承認する」に揃っている | S-1.8 | A |
| F-1.17 | H-4.2 | **Microsoft Purview × Microsoft 365 Copilot** (Microsoft Learn、ms.date 2026-06-30)。ユーザーが VIEW 権限を持ち EXTRACT を持たない場合、"Copilot won't summarize this content but can reference it with a link"。EXTRACT (Copy) 権限が "determines whether Copilot or agents can display text"。DLP ポリシーで、ラベル付きのファイル・メールを Copilot・エージェントの要約対象から除外できる。新規生成物には最も優先度の高いラベルが**継承**される。Double Key Encryption で保護したデータには Copilot がアクセスできない。熟議 D7 の「読むだけ / 要約して下書き / 外部へ出す」は、既存の usage rights の組み合わせ **VIEW のみ / VIEW+EXTRACT / EXPORT・FULL CONTROL (ラベル変更に必要)** と DKE (AI に一切見せない) に、ほぼそのまま当てはまる | S-1.22 | A |
| F-1.18 | H-4.2 | 同じ文書が挙げる**限界**。コンテナ (Teams・サイト) のラベルは中の項目に継承されない。Teams 会議・チャットのラベルは Copilot が認識しない。Graph コネクタやプラグイン経由の外部データのラベルも認識しない。Channel Agent は要求者の EXTRACT だけを確認し、チャネルの全メンバーの権限は見ないため、閲覧権限のないメンバーに要約が見える可能性がある。監査ログには Copilot の検索活動は残るがプロンプトと応答は残らず、内容は eDiscovery や DSPM for AI で取る。既存の分類にそのまま乗る一方、**エージェントという新しい経路では穴が残る** | S-1.22 | A |
| F-1.19 | H-4.2 | **NIST SP 800-60 Vol.1 Rev.1** (2008-08) は、情報の種類を FISMA のセキュリティ区分に割り当てるためのガイドである。low / moderate / high の 3 段階は FIPS 199 に由来する (FIPS 199 は未取得のため C)。CSRC のページに Rev.2 への言及はない。区分は機密性・完全性・可用性の影響度で付け、「AI に何をさせてよいか」という操作の段階ではない | S-1.23 | A (文書の性格) / C (3 段階) |
| F-1.20 | H-4.2 | **ISO/IEC 27001:2022 附属書 A 5.12 "Classification of information"** (A 5.13 Labelling と組み)。ISO のページが 403 で、管理策本文は**一次で NOT FOUND**。分類の段階数を規格は定めておらず、組織が決めるという理解は一般知識にとどまり、未確認 | S-1.24 | C |

## 2. 仮説ごとの暫定判定

### H-2.1 エージェント固有の事故は実例があり、権限の線・最小権限・監査ログは現実の必要条件
- **暫定判定: 支持 / 確度: 高**
- 根拠: F-1.1、F-1.3、F-1.4 (互いに独立な 3 系統の公表事例と、一次のアドバイザリまたは研究公開)。F-1.5・F-1.6 (OWASP が Excessive Agency と Identity & Privilege Abuse を独立項目に置いている)。F-1.7 (74% が過剰権限を認めている。ただしベンダ出資)。
- 留保: 公表されたものは**脆弱性と実証**であり、悪用による実害が公表された事故は本調査の範囲では **NOT FOUND**。「現実の必要条件」とは言えるが、「事故が多発している」とは言えない。EchoLeak はベンダ側の修正 (顧客の対応不要) で閉じたので、「ベンダの標準対策で足りる」という反証側にも一部の根拠がある。一方、GitHub MCP の件は利用者側で権限を設計しないと防げない (F-1.3) ため、反証は全体としては成立しない。

### H-2.2 エージェントの ID・シークレット・監査はまだ標準が固まっておらず、先に敷いた企業が追随しやすい
- **暫定判定: 一部支持 / 確度: 中**
- 根拠: F-1.8 (MCP 認可は OPTIONAL で、OAuth 2.1 もまだドラフト)、F-1.9 (エージェント向け OAuth 拡張は失効した個人ドラフトのまま)、F-1.11 (CSA は既存 IAM では足りないと主張)、F-1.7 (31% が人間の ID を流用し、43% が共有アカウントを使う)。
- 「一部」にとどまる理由: (1)「標準が固まっていない」は強く支持されるが、その中身は**既存の部品 (OAuth・RFC 8707・RFC 9728、NHI の衛生管理) の組み合わせ**であり、新しい発明を待つ状態ではない (F-1.8、F-1.10)。(2)「先に敷いた企業が追随しやすい」を直接示す実証データ (先行導入企業と後発企業の比較) は **NOT FOUND**。設計上の推論にとどまる。(3) Gartner の guardian agents 予測 (F-1.12) は市場が立ち上がりつつあることを示すが、追随のしやすさの証拠ではない。
- 競合する説明: 既存 IAM の延長で足りる (CSA 2026 note の要約とされるもの。C)。標準が固まってから導入すれば手戻りが少ない (後発の利得)。

### H-4.1 「提案は人間が承認・出荷する」線は主要な枠組みで標準化されつつある
- **暫定判定: 一部支持 / 確度: 高** (規範の存在の確度は高い。「標準化」の範囲は限定的)
- 根拠: F-1.13 (EU AI Act 14(4)(d)(e)。覆す権限と停止手段)、F-1.15 (NIST GOVERN 3.2 / MAP 3.5 / MANAGE 2.4)、F-1.16 (OWASP LLM06 は高影響の行動に承認を求める)。
- 「一部」にとどまる理由: どの枠組みも**リスクに応じて監督の強さを変える**立場で、「全行動を人間が承認する」標準はない。EU は高リスクに限り、NIST は "may not require human oversight" と書く。熟議の Zone-A 線 (お金・マージ・制度は人間へ) は「高影響の行動のみ承認」と整合する。ただし「提案/出荷」という語彙を明示的に定めた標準は **NOT FOUND**。EU の適用日は延期され、2027-12 になった (F-1.14) ので、法的に強制される時期は後ろへずれた。

### H-4.2 等級と段階アクセス (読む / 要約・下書き / 外部へ出す) は既存の分類標準と DLP 実務に接続でき、新規発明ではない
- **暫定判定: 支持 / 確度: 中**
- 根拠: F-1.17 (Purview の usage rights と DLP が、AI 向けの段階に**製品として**すでに当てはまっている)、F-1.19 (NIST の分類の枠組み)、F-1.20 (ISO A 5.12。一次は未確認)。
- 確度が「中」の理由: 一次で確認できたのは Microsoft の 1 系統のみ。ISO と Google Workspace の DLP × Gemini は未確認。また F-1.18 のとおり、既存のラベルはエージェントの経路 (チャネル共有、外部コネクタ、会議チャット) で穴が残る。「接続できる」は支持されるが、「接続すれば足りる」は支持されない。
- 競合する説明: 既存の分類は機密性の等級 (C/I/A の影響度) であり、熟議の三段階は**操作**の等級である。両者は別の軸で、写像には設計の仕事が要る。

## 3. 矛盾・注意点

1. **CVSS の不一致**: EchoLeak は Microsoft が 9.3、NVD が 7.5 (F-1.1)。報道の「9.3 Critical」は CNA の値である。レポートでは採点者を明記すること。
2. **「初のゼロクリック AI 攻撃」はベンダの主張**: Aim Security の自称であり、独立した検証はない。
3. **ベンダ出資の調査**: CSA × Aembit (F-1.7) は IAM ベンダが出資し設問も共同設計した。n=228 で無作為抽出ではない。「74%」は方向を示す値として使い、規模の推定には使わない。
4. **「実証」と「事故」の区別**: F-1.3 と F-1.4 は研究者による実証やアドバイザリで、悪用による被害は公表されていない。H-2.1 を「事故の実例」と書くと誇張になる。「公表された脆弱性と実証」と書く。
5. **OWASP Agentic Top 10 の項目名**: 一次ページには一覧がなく、二次資料で揃えた名前である。ASI05 の範囲は二次資料間で揺れがある。引用前に PDF で確認すること。
6. **EU AI Act の日付**: 条文サイトと二次資料は Omnibus 後の日付 (2027-12-02 / 2028-08-02) を示す。事前の法律事務所の記事 (2026-05) は「OJ 掲載まで 2026-08-02 が有効」としていた。EUR-Lex で 2026/1744 を確認できていない。
7. **CSA の立場の揺れ**: 2025 年の論文は「専用の IAM が必要」、2026 年の note は「既存 IAM の延長」と要約されている (後者は未読)。H-2.2 の反証にも支持にも引用されうるので、レポートでは両論併記する。
8. **分類の軸**: ISO / NIST の分類は「どれだけ守るか」の等級で、熟議の三段階は「AI に何をさせるか」の操作権限である。Purview の usage rights は後者に近い。「既存標準そのまま」ではなく「既存の部品の組み合わせ」と書くのが正確。
9. **MCP 仕様の版**: 本パックは 2025-06-18 版を読んだ。以降の改訂 (2025-11 版など) で認可の要件が変わっている可能性があり、未確認。

## 4. 情報源台帳 (source register rows)

| S-ID | 区分 | 題名 | 発行者 | 日付 | URL | 検証メモ |
|---|---|---|---|---|---|---|
| S-1.1 | 一次 | CVE-2025-32711 Detail (NVD API 2.0 JSON) | NIST NVD | 2025-06-11 | https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2025-32711 | 2026-11-04 に API から公開日、英語の記述、CVSS (secure@microsoft.com 9.3 / nvd@nist.gov 7.5) を取得して確認 |
| S-1.2 | 二次 | Zero-Click AI Vulnerability Exposes Microsoft 365 Copilot Data Without User Interaction | The Hacker News | 2025-06-12 | https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html | 検索要約で、Aim Labs の発見、CVSS 9.3、顧客の対応不要を確認。本文は未取得 |
| S-1.3 | 二次 | Microsoft Copilot's own default configuration exposed users to the first-ever zero-click AI attack | Windows Central | 2025-06 | https://www.windowscentral.com/microsoft/microsoft-copilots-own-default-configuration-exposed-users-to-the-first-ever-zero-click-ai-attack-but-there-was-no-data-breach | 検索要約で「データ侵害なし、修正済み」を確認。MSRC の一次ページは本文を取得できず |
| S-1.4 | 一次 | GitHub MCP Exploited: Accessing private repositories via MCP | Invariant Labs | 2025-05-26 | https://invariantlabs.ai/blog/mcp-github-vulnerability | 本文を取得。日付、攻撃の流れ、Claude Desktop + Claude 4 Opus、"architectural" という評価、最小権限と 1 セッション 1 リポジトリの提案を確認 |
| S-1.5 | 一次 | mcp-remote command injection RCE (JFSA-2025-001290844) | JFrog Security Research | 2025-07-09 | https://research.jfrog.com/vulnerabilities/mcp-remote-command-injection-rce-jfsa-2025-001290844/ | 本文を取得。影響範囲 0.0.5〜0.1.15、CVSS 9.6、修正コミット 607b226 を確認。修正版の番号は記載なし |
| S-1.6 | 一次 | CVE-2025-6514 Detail (NVD API 2.0 JSON) | NIST NVD | 2025-07-09 | https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2025-6514 | API から公開日、記述、CVSS 9.6 (reefs@jfrog.com) を確認 |
| S-1.7 | 一次 | OWASP Top 10 for LLM Applications 2025 | OWASP GenAI Security Project | 2025 (翻訳は 2025-03-12) | https://genai.owasp.org/llm-top-10/ | 10 項目の ID と名称を逐語で確認。英語版の公開日はページに記載なし |
| S-1.8 | 一次 | LLM06:2025 Excessive Agency | OWASP GenAI Security Project | 2025 | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ | 根本原因 3 点、"Minimize extension permissions"、"Require user approval" の文言を確認 |
| S-1.9 | 一次 | OWASP Top 10 for Agentic Applications for 2026 | OWASP GenAI Security Project | 2025-12-09 | https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ | 公開日と "peer-reviewed … 100+ experts" を確認。ページに項目一覧はなし (PDF は未取得) |
| S-1.10 | 二次 | OWASP Drops First AI Agent Risk List | TechRepublic | 2025-12 | https://www.techrepublic.com/article/news-owasp-ai-agent-risk-list/ | 本文は 403。ASI01〜10 の名称は検索結果の要約 (TechRepublic と他の二次資料) で突き合わせた |
| S-1.11 | 一次 | More Than Two Thirds of Organizations Cannot Clearly Distinguish AI Agent from Human Actions (press release) | Cloud Security Alliance | 2026-03-24 | https://cloudsecurityalliance.org/press-releases/2026/03/24/more-than-two-thirds-of-organizations-cannot-clearly-distinguish-ai-agent-from-human-actions | 本文を取得。n=228、2026 年 1 月実施、Aembit 出資、68/74/43/31/52/79% を確認 |
| S-1.12 | 一次 | Model Context Protocol Specification — Authorization (2025-06-18) | Model Context Protocol (Anthropic 主導の OSS 仕様) | 2025-06-18 | https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization | 本文を全文取得。OPTIONAL、依拠する RFC 群、OAuth 2.1 が draft-13 であること、audience 検証と passthrough 禁止の MUST を確認 |
| S-1.13 | 一次 | draft-oauth-ai-agents-on-behalf-of-user (datatracker) | IETF Datatracker | -02: 2025-08-25 | https://datatracker.ietf.org/doc/draft-oauth-ai-agents-on-behalf-of-user/ | 本文を取得。Expired の個人ドラフト、ストリームなし、"not endorsed by the IETF" を確認 |
| S-1.14 | 一次 (未取得) | draft-song-oauth-ai-agent-authorization-00 / draft-yao-agent-auth-considerations-00 | IETF (個人ドラフト) | 2025-07 / 2025-06 | https://datatracker.ietf.org/doc/draft-song-oauth-ai-agent-authorization/ | 検索結果 (ミラー) で存在と日付のみを確認。datatracker の状態は未確認のため確度 C |
| S-1.15 | 一次 | OWASP Non-Human Identities Top 10 (2025) | OWASP Foundation | 2025 | https://owasp.org/www-project-non-human-identities-top-10/ | NHI1〜NHI10 の名称を逐語で確認 |
| S-1.16 | 一次 | Agentic AI Identity and Access Management: A New Approach | Cloud Security Alliance | 2025-08-18 | https://cloudsecurityalliance.org/artifacts/agentic-ai-identity-and-access-management-a-new-approach | 本文の前半約 100k 文字を取得。公開日、"can't keep up"、OAuth の静的スコープ批判の逐語を確認 |
| S-1.17 | 一次 (本文未取得) | Gartner Predicts that Guardian Agents will Capture 10-15% of the Agentic AI Market by 2030 | Gartner Newsroom | 2025-06-11 | https://www.gartner.com/en/newsroom/press-releases/2025-06-11-gartner-predicts-that-guardian-agents-will-capture-10-15-percent-of-the-agentic-ai-market-by-2030 | WebFetch は 403。題名と日付は検索結果と URL で確認。本文 (調査母数、定義) は未確認のため確度 B |
| S-1.18 | 二次 | Enterprises are worried about agentic AI security risks – Gartner says the answer is just adding more AI agents | ITPro | 2025-06-12 | https://www.itpro.com/technology/artificial-intelligence/enterprises-are-worried-about-agentic-ai-security-risks-gartner-says-the-answer-is-just-adding-more-ai-agents | 見出しと日付のみを取得 (本文は途中で切れていた)。2026 年の 1% / 5–7% は ITBrew (2026-03-06) の検索要約のみで、確度 C |
| S-1.19 | 準一次 (条文転載) | EU AI Act Article 14: Human Oversight | artificialintelligenceact.eu (Future of Life Institute 運営の条文サイト) | 条文は 2024-06-13 採択 (Reg. 2024/1689) | https://artificialintelligenceact.eu/article/14/ | 14(1) と 14(4)(a)〜(e) の文言、高リスク限定、表示された適用日 2027-12-02 / 2028-08-02 を確認。EUR-Lex の正文は未照合 |
| S-1.20 | 二次 | EU AI Act Omnibus Agreement — Postponed High-Risk Deadlines / Digital Omnibus on AI enters into force | Gibson Dunn (2026-05) / Mondaq | 2026-05〜2026-08 | https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/ | 検索要約で Reg. 2026/1744、OJ 掲載 2026-07-24、発効 07-27 を確認。EUR-Lex (https://eur-lex.europa.eu/eli/reg/2026/1744/oj) は空のページで照合できず |
| S-1.21 | 一次 | Artificial Intelligence Risk Management Framework (AI RMF 1.0), NIST AI 100-1 | NIST | 2023-01 | https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf | PDF を取得してテキスト化。GOVERN 3.2、MAP 3.5、MANAGE 2.4、voluntary、"may not require human oversight" の逐語を確認 |
| S-1.22 | 一次 | Considerations for Microsoft Purview to manage Microsoft 365 Copilot and Channel Agent in Teams for security and compliance | Microsoft Learn | ms.date 2026-06-30 | https://learn.microsoft.com/en-us/purview/ai-m365-copilot-considerations | 全文を取得。VIEW と EXTRACT の扱い、DLP による除外、ラベル継承、DKE、Channel Agent の限界、監査の範囲を逐語で確認 |
| S-1.23 | 一次 | SP 800-60 Vol. 1 Rev. 1, Guide for Mapping Types of Information and Information Systems to Security Categories | NIST CSRC | 2008-08 | https://csrc.nist.gov/pubs/sp/800/60/v1/r1/final | 文書の目的と日付を確認。low / moderate / high の定義はページになく (FIPS 199 由来、未取得)、Rev.2 への言及もなし |
| S-1.24 | 一次 (本文未取得) | ISO/IEC 27001:2022 Information security management systems — Requirements | ISO | 2022-10 | https://www.iso.org/standard/27001 | 403。附属書 A 5.12 / 5.13 の文言は確認できず、確度 C |

### NOT FOUND (探したが確認できなかったもの)
- EchoLeak の MSRC 一次ページの本文 (修正日、悪用の有無)
- エージェント経由のプロンプトインジェクションで**実害 (悪用によるデータ流出) が公表された**企業事故 (2025–2026)
- WG に採択された IETF のエージェント認可ドラフト / RFC
- 「先にエージェントの ID 基盤を敷いた企業ほど制度改訂に追随しやすい」ことを示す比較データ
- 「提案 / 出荷」を明示的な語彙として定めた標準・枠組み
- Gartner guardian agents プレスリリースの本文 (市場定義、調査母数)
- OWASP Agentic Top 10 の項目名の一次確認 (PDF)
- ISO/IEC 27001:2022 A 5.12 の管理策本文、FIPS 199 の 3 段階の定義 (一次)
- EUR-Lex 上の Regulation (EU) 2026/1744 の正文
- Google Workspace DLP × Gemini の段階アクセスの公式文書 (検索予算の制約で未着手)
