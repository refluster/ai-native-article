---
title: "AI が増やすのはコード量ではなく「誤った意図に整合した成果物」かもしれない――工学組織の律速段階としての信頼"
lang: "ja"
type: "explanation"
category: "Verification & Trust"
date: "2026-05-24"
abstract: "The article argues that the main constraint on AI adoption in engineering is not model capability but trust: teams hesitate to rely on AI-generated code and recommendations when correctness, maintainability, and accountability are uncertain. It likely explores how this trust gap affects software development workflows and suggests that organizations need better validation, review, and process changes to integrate AI effectively into the SDLC."
notionId: "36ad0f0b-e61e-8192-9bde-e19a2fd9ec3d"
sourceUrls: "https://blog.reqproof.com/p/engineerings-ai-bottleneck-is-trust"
---

# AI が増やすのはコード量ではなく「誤った意図に整合した成果物」かもしれない――工学組織の律速段階としての信頼

## Executive Summary

Leonid Bugaev の主張は明確で、エンジニアリング組織における AI 活用のボトルネックはモデル能力ではなく「信頼」である。AI は spec、code、tests、docs を一貫して生成できるが、その一貫性は正しさを保証せず、誤った intent に対して artifacts 全体が整合してしまうと、green CI ですら安全性の根拠にならない。

したがって論点は「AI がどれだけ多くのコードを書けるか」ではなく、「増えた change を安全に absorb するために、コードの周囲に何が必要か」に移る。著者はその答えとして、temporary artifact として消費される spec ではなく、requirements・obligations・tests・docs・implementation を traceable に結び、pull request を “evidence pack” に変える trust layer を提示する。

## green CI が証明するのは正しさではなく「現在の artifacts が現在の checks に一致している」こと

AI 導入後も開発速度が線形に伸びない理由を、著者は implementation コストの低下と trust コストの高止まりの乖離として説明する。pull request は change の提案にすぎず、それ自体は「trust されることを求めているもの」であって、信頼の根拠を内包しない。

- エビデンス
- 著者は「AI can write specs, code, tests, and docs. If all of them agree on the wrong intent, green CI isn’t enough.」と述べる。
- 「AI does make some things dramatically faster. MVPs are faster. Prototypes are faster. The time to validate an idea is reduced a lot.」としつつ、「creating the first version of something isn’t the same as maintaining a product」と区別する。
- 従来の trust model は「write the code, write the tests, pass CI/CD, review the pull request, ship」だったが、「Green CI never meant the product was correct. It meant the code passed the checks we had.」と整理する。
- 著者は checks が証明しない対象として、requirement の正しさ、tests が正しいことをテストしているか、documentation の完全性、change が real product behavior に合致しているか、を列挙する。
- 「They prove that the current artifacts agreed with the current checks.」と明言する。
- AI により「The spec can be wrong, the code can follow the wrong spec, the tests can validate the wrong code, the docs can describe the wrong behavior, and CI can still be green.」という連鎖が成立する。
- その状態を著者は「That’s not trust. That’s a consistent mistake.」と定義する。
- 結論
- CI/CD、tests、code review は必要だが、AI 時代にはそれだけでは intent の妥当性を担保できない。
- 問題は artifact 単体の品質ではなく、artifact 群が誤った intent に対して相互に整合してしまう構造にある。
- したがって review の対象は code の差分だけでは足りず、「なぜこの change が存在するのか」「何に影響するのか」「何が未解決か」を含む文脈へ拡張される。
## coverage の高さでも埋まらない「未記述の仕様」――security と malformed input が optional でなくなる

著者は、欠陥の多くは code に先立って specification の欠落にあると論じる。特に malformed input、authorization boundaries、resource limits、timeout behavior、error states、public API behavior のような項目は、enterprise extras ではなく product requirements として扱うべき対象だと位置づける。

- エビデンス
- 著者は以前の jsonparser の記事に触れ、「I had near-100% coverage in the area that mattered. The problem was that malformed input behavior was never properly described. So the tests proved what existed, not what should have existed.」と述べる。
- そこから「You cannot test what you never described.」という命題を導く。
- security については、過去には「some quiet version of security by obscurity」に依存していたチームが少なくなかったとする。
- その前提が崩れている根拠として、「VulnCheck reported that in the first half of 2025, 32.1% of known exploited vulnerabilities had exploitation evidence on or before the day the CVE was issued.」を挙げる。
- そのうえで、「malformed input, authorization boundaries, resource limits, timeout behavior, error states, data exposure, public API behavior. These aren’t enterprise extras. They’re product requirements.」と明示する。
- subtle cases として「Concurrency. Non-deterministic behavior. Map iteration. Merge order. I’m looking at you, Go.」も挙げる。
- 結論
- test coverage の高さは、記述済みの振る舞いに対する検証の厚みを示すにすぎず、未記述領域の欠落は補えない。
- AI が tests まで自動生成する環境では、「何を問うべきか」を specification に先立って定義していない限り、検証は容易に空洞化する。
- とくに security・error handling・determinism のような「退屈な項目」は、後付けの品質活動ではなく、requirements に埋め込むべき obligation になる。
## open source でも社内でも同じ――outside structure に触れる contributor は intent を所有していない

著者はこの trust 問題を open source の maintainer 経験から説明する。外部 contributor も社内の support engineer も solutions architecture の担当者も、見えているコードや tests や docs には触れられるが、長年積み上がった product promises や load-bearing な振る舞いまでは共有していない、という点で同型だとする。

- エビデンス
- 著者は「For the last 12 years at least, I worked a lot in open source.」と述べ、自身の popular open source projects と、Tyk で open source API Gateway を作っている経験を前提に語る。
- maintainer の仕事は PR の technical correctness だけでは足りず、「you still need to get inside the context. You need to understand what’s happening and why this person is doing it.」だとする。
- contributors は「the outside structure」を見るが、「they don’t see the intent in the same way the owner of the project sees it」と述べる。
- さらに「They don’t know all the small product promises made over the years. They don’t know which ugly thing is accidental and which ugly thing is load-bearing.」と書く。
- 同じ構造は社内にもあり、「A support engineer may understand the product from the customer side, but not the architecture. Another team may understand code, but not the local history. AI may generate something that looks clean, but it has no real ownership unless someone gives it context and checks it.」と整理する。
- Tyk の顧客文脈として、「banks, governments, and large enterprises」が使う software であり、bug のコストは「Sometimes it’s legal. Sometimes it’s regulatory. Sometimes it’s very big money.」とされる。
- 著者は速度の定義を「Speed isn’t how quickly you can make a change. Speed is how quickly you can safely absorb change.」と置き換える。
- さらに Lehman の software evolution work から「The safe rate of change per release is constrained by the process dynamics.」を引用し、change の number、size、architectural distance が増すと complexity と fault rate が more than linearly grow すると説明する。
- 結論
- contributor の属性が external か internal か、human か AI かは二次的で、核心は「その change が deep intent に接続されているか」にある。
- AI によって contribution の入口が広がるほど、maintainer 側の trust system が弱い組織では review 負荷だけが増幅する。
- 顧客が稼働基盤に組み込む成熟プロダクトでは、「move fast」は change 生成能力ではなく、安全に取り込める change の上限として再定義される。
## temporary spec はやがて archaeology になる――必要なのは obligations と traceability を持つ source of truth

consumer engineering における多くの spec は、一時的な artifact として作られ、その後の実装・レビュー・運用で更新されず、知識が Jira、GitHub comments、Slack threads、Confluence、個人の記憶へと分散する。著者はこの状態を development ではなく archaeology と呼ぶ。

- エビデンス
- 著者は specification の実態を「Maybe an RFC. Then it becomes a detailed Jira ticket. Maybe later there is an ADR. There are comments in GitHub. A Slack thread. A Confluence page.」と列挙する。
- 時間が経つと「If you want to understand how a component works, you need to dig through history.」となり、「This is archaeology, not development.」と述べる。
- 問題は artifacts が独立していることであり、「The RFC isn’t connected to all the code. The Jira ticket isn’t connected to all the tests. The docs are scattered across ten pages. The final implementation isn’t connected back to the original assumptions. It’s not a graph.」と指摘する。
- その結果、engineer、architect、lead、PM が high-level picture を頭の中に保持することが期待されるが、「this is too much context for one person to carry」とする。
- spec-first にも限界があり、「Spec-driven development is better than no spec.」だが、「if the spec is still treated as a temporary artifact, after a few iterations you end up in the same position, with intent chaos.」と述べる。
- obligations については、「An obligation is not a test case. It’s a category of behavior you are required to describe: malformed input, boundary behavior, error handling, access denied, determinism, idempotency, atomicity, nil safety, overflow safety, encoding safety.」と定義する。
- obligation の役割は「It forces you to ask the question.」であり、著者はこれを「turns “maybe someone remembers” into a deterministic process」と評価する。
- AI の役割は architecture taste を judge することではなく、たとえば goroutines を使っていれば cancellation、lifecycle、error propagation の記述箇所を問い、public API の変更では compatibility と documentation obligations を問う、といった missed questions の surfacing に置かれる。
- 著者は regulated industries から学ぶべきものとして、aviation、automotive、medical devices、space systems における requirement management を挙げ、「Requirements have IDs. They have layers. They are linked to documentation, tests, implementation, verification evidence. You can see blast radius.」と要点を示す。
- NASA’s FRET については、「hierarchical system requirements in structured natural language」「unambiguous semantics」「natural language, formal logic, diagrams, and interactive simulation」と説明する。
- 結論
- 信頼を支える最小単位は vague な ticket でも high-coverage な test suite でもなく、intent を durable・traceable・evidence-linked に保つ source of truth である。
- obligations は回答のテンプレートではなく、見落としやすい論点を deterministic に顕在化する仕組みとして位置づく。
- regulated engineering の価値は paperwork ではなく、requirements が software とともに生き、変更時に blast radius と verification evidence を追える点にある。
## pull request を “evidence pack” に変える――Proof が狙う trust layer

著者が提案する実装単位は、通常の pull request を置き換えるのではなく、その上位に evidence chain を添える “evidence pack” である。ここでは code だけでなく、intent、requirements、obligations、tests、docs、blast radius、spec conflict、implementation 中の変更、human judgment が必要な箇所までを一つの reviewable package に束ねる。

- エビデンス
- 現在の pull request について著者は、「Today a pull request usually gives me code, maybe tests, maybe a description. But it doesn’t give me the whole chain.」と述べる。
- 欠けているものとして、「the original intent」「which obligations apply」「the blast radius」「which docs changed or should have changed」「which specs this conflicts with」「what changed during implementation compared to the plan」を挙げる。
- そのため reviewer は再び「archaeology」を強いられる。
- 著者が望む “evidence pack” は、「Here is the intent. Here are the requirements. Here are the obligations. Here are the tests that witness them. Here are the docs. Here is the blast radius. Here is how it aligns with existing specs and where we checked for conflicts. Here is what changed during implementation. Here is what still needs human judgment.」という構成を持つ。
- これは「open source」「support engineers contributing fixes」「other internal teams」「AI agents」のいずれにも適用される。
- 著者は friction の増加を認め、「Writing obligations is slower than writing a vague ticket. Linking tests to requirements is slower than writing random tests.」と述べる一方で、「Bureaucracy gives you friction without trust. Evidence gives you friction that lets more people move safely.」と区別する。
- その文脈で Proof を作る理由を、「The problem isn’t that we can’t produce enough artifacts. The problem is that the artifacts don’t preserve intent.」と説明する。
- 目標として、「I want specs to stop being temporary. I want requirements to live with the software. I want obligations to force the boring questions before they become production bugs. I want code, tests, docs, and requirements to invalidate each other when they drift.」を掲げる。
- 最後に著者は、求める scaling を「Not just more code. More trusted change.」と要約する。
- 結論
- AI の価値を実運用に接続するには、artifact の生成速度ではなく、change を reviewable・traceable・mergeable にする証拠構造が必要になる。
- “evidence pack” は review の重さをなくすためのものではなく、review の対象を code diff から evidence chain へ移す提案である。
- その帰結として maintainer は「incoming things の管理者」ではなく、evidence に基づいて並列に change を吸収できる体制へ移行できる。