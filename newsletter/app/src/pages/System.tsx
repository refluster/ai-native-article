import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageProvider'
import { setSystemSeo } from '../lib/seo'
import { trackEvent } from '@kohuehara/shared/analytics'

const metrics = [
  { value: '≈250', ja: '専門エージェント', en: 'specialist agents' },
  { value: '30–50', ja: 'PR / 日', en: 'PRs merged / day' },
  { value: '75–80%', ja: 'タッチレス・マージ率', en: 'touchless merge rate' },
  { value: '16,000', ja: '最大コード行 / 日', en: 'peak lines of code / day' },
]

const problems = [
  {
    ja: 'プロジェクトを始めるたびに、人を採用・外注・教育し直す。',
    en: 'Every new project means hiring, outsourcing, and onboarding all over again.',
  },
  {
    ja: 'AIを導入しても、速くなるのは個人作業だけ。レビュー、調整、運用が次のボトルネックになる。',
    en: 'AI speeds up individual tasks, but review, coordination, and operations become the next bottleneck.',
  },
  {
    ja: '知見がチャットや会議に流れ、次のプロジェクトで再利用できる組織資産にならない。',
    en: 'Knowledge disappears into chats and meetings instead of compounding into reusable organizational assets.',
  },
]

const capabilities = [
  {
    step: '01',
    jaTitle: '仕事を分解する',
    enTitle: 'Decompose the work',
    jaBody: '曖昧な目的を、収集・解析・仮説生成・実装・レビュー・運用の機械実行可能な工程へ分解します。',
    enBody: 'Turn ambiguous goals into machine-executable stages for research, analysis, hypothesis generation, implementation, review, and operations.',
  },
  {
    step: '02',
    jaTitle: '専門家を配属する',
    enTitle: 'Deploy specialists',
    jaBody: '役割・スキル・判断基準を持つエージェントを、必要なプロジェクトへチーム単位で配属します。',
    enBody: 'Deploy agents with explicit roles, skills, and decision criteria as a project team—not as a single generic assistant.',
  },
  {
    step: '03',
    jaTitle: 'ゲートで品質を担保する',
    enTitle: 'Gate quality',
    jaBody: '生成とレビューを分離し、複数の品質ゲートと自動修復を通して、人間が触らなくても前に進める範囲を広げます。',
    enBody: 'Separate creation from review, then use layered quality gates and auto-repair to expand the work that can progress without human touch.',
  },
  {
    step: '04',
    jaTitle: '学習を資産化する',
    enTitle: 'Compound the learning',
    jaBody: '試行錯誤をスキル・ルール・知識として保存し、次の仕事で再利用します。毎回ゼロから始めません。',
    enBody: 'Store trial-and-error as skills, rules, and knowledge that can be reused by the next project. The system does not reset to zero.',
  },
]

const comparisons = [
  ['Copilot / ChatGPT', '個人を速くする', '組織全体を動かす'],
  ['RPA / Workflow', '決められた手順を自動化', '不確実な仕事を判断しながら進める'],
  ['外注 / コンサル', '成果物を納品して終了', '知識と運用能力を内部資産として残す'],
  ['人間組織', '採用・育成・固定費が先行', '小さく始め、必要な能力だけ増減する'],
]

export default function System() {
  const { language } = useLanguage()
  const ja = language === 'ja'

  useEffect(() => {
    setSystemSeo(language)
  }, [language])

  const copy = {
    eyebrow: ja ? 'AI WORKFORCE / OPERATING SYSTEM FOR KNOWLEDGE WORK' : 'AI WORKFORCE / OPERATING SYSTEM FOR KNOWLEDGE WORK',
    title: ja ? 'AIを使うのではなく、AIで組織をつくる。' : 'Don’t just use AI. Build an organization with it.',
    lead: ja
      ? '調査、分析、ソフトウェア開発、レビュー、運用まで。専門エージェントをチームとして配属し、知的労働そのものを継続運転する仕組みです。'
      : 'Research, analysis, software delivery, review, and operations—run by specialist agents deployed as a team, not a one-off prompt.',
    primary: ja ? '実際の記事を見る' : 'See the live publication',
    secondary: ja ? 'GitHubで実装を見る' : 'Inspect the implementation on GitHub',
  }

  return (
    <div className="overflow-hidden">
      <section className="max-w-[1440px] mx-auto px-6 md:px-12 pt-20 md:pt-28 pb-16 md:pb-24">
        <div className="max-w-5xl">
          <p className="text-[10px] md:text-xs font-bold tracking-[0.22em] text-tertiary uppercase mb-8">
            {copy.eyebrow}
          </p>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-[-0.06em] leading-[0.93] max-w-6xl">
            {copy.title}
          </h1>
          <p className="mt-8 text-lg md:text-2xl leading-relaxed text-on-surface-variant max-w-3xl">
            {copy.lead}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              to="/"
              onClick={() => trackEvent({ name: 'system_cta_click', params: { target: 'articles' } })}
              className="inline-flex items-center justify-center bg-on-surface text-surface px-7 py-4 text-xs font-black tracking-widest uppercase hover:opacity-85 transition-opacity"
            >
              {copy.primary} →
            </Link>
            <a
              href="https://github.com/refluster/ai-native-article"
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent({ name: 'system_cta_click', params: { target: 'github' } })}
              className="inline-flex items-center justify-center border-2 border-on-surface px-7 py-4 text-xs font-black tracking-widest uppercase hover:bg-on-surface hover:text-surface transition-colors"
            >
              {copy.secondary}
            </a>
          </div>
        </div>
      </section>

      <section className="border-y border-outline-variant/30 bg-surface-variant/20">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 grid grid-cols-2 lg:grid-cols-4">
          {metrics.map((m, i) => (
            <div key={m.value} className={`py-8 md:py-10 ${i > 0 ? 'lg:border-l lg:border-outline-variant/30 lg:pl-8' : ''}`}>
              <div className="text-4xl md:text-5xl font-black tracking-tighter">{m.value}</div>
              <div className="mt-2 text-[10px] md:text-xs font-bold tracking-widest uppercase text-outline">
                {ja ? m.ja : m.en}
              </div>
            </div>
          ))}
        </div>
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pb-6 text-[10px] tracking-wide text-outline">
          {ja ? '2026 Q2時点の運用実績。内部の実活動ログ・リポジトリ記録に基づく。' : 'Operating snapshot as of 2026 Q2, based on internal activity logs and repository records.'}
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">01 / PROBLEM</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.98]">
              {ja ? '人を増やすだけでは、知的労働はスケールしない。' : 'Knowledge work does not scale just by adding people.'}
            </h2>
          </div>
          <div className="lg:col-span-7 divide-y divide-outline-variant/30 border-y border-outline-variant/30">
            {problems.map((p, i) => (
              <div key={i} className="py-7 flex gap-6">
                <span className="text-xs font-black text-tertiary">0{i + 1}</span>
                <p className="text-xl md:text-2xl leading-relaxed">{ja ? p.ja : p.en}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-on-surface text-surface py-24 md:py-32">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">02 / DIFFERENCE</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] max-w-4xl leading-[0.98]">
            {ja ? '一人のAIではなく、工程と役割を持つワークフォース。' : 'Not one AI. A workforce with process and roles.'}
          </h2>
          <div className="mt-14 overflow-x-auto">
            <div className="min-w-[720px] border-t border-surface/30">
              <div className="grid grid-cols-[1.1fr_1.3fr_1.6fr] text-[10px] font-bold tracking-widest uppercase text-surface/60 py-4 border-b border-surface/30">
                <div>{ja ? '比較対象' : 'Compared with'}</div>
                <div>{ja ? '従来' : 'Typical model'}</div>
                <div>AI WORKFORCE</div>
              </div>
              {comparisons.map(([name, before, after]) => (
                <div key={name} className="grid grid-cols-[1.1fr_1.3fr_1.6fr] gap-6 py-6 border-b border-surface/20 items-start">
                  <div className="font-black">{name}</div>
                  <div className="text-surface/65">{before}</div>
                  <div className="font-bold">{after}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">03 / HOW IT WORKS</p>
        <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] max-w-4xl leading-[0.98]">
          {ja ? '生成を速くするのではなく、仕事の流れ全体を作り替える。' : 'Do not optimize generation. Redesign the whole flow of work.'}
        </h2>
        <div className="mt-16 grid md:grid-cols-2 gap-px bg-outline-variant/30 border border-outline-variant/30">
          {capabilities.map(c => (
            <div key={c.step} className="bg-surface p-8 md:p-10 min-h-[280px] flex flex-col">
              <span className="text-xs font-black text-tertiary">{c.step}</span>
              <h3 className="mt-10 text-3xl font-black tracking-tight">{ja ? c.jaTitle : c.enTitle}</h3>
              <p className="mt-5 text-base md:text-lg leading-relaxed text-on-surface-variant">
                {ja ? c.jaBody : c.enBody}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-outline-variant/30 bg-surface-variant/20 py-24 md:py-32">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-5">
              <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">04 / PROOF</p>
              <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.98]">
                {ja ? 'これは構想ではなく、すでに動いている。' : 'This is not a concept. It is already operating.'}
              </h2>
            </div>
            <div className="lg:col-span-7 space-y-8 text-lg md:text-xl leading-relaxed">
              <p>
                {ja
                  ? '2026 Q2には、約250体のエージェントを役職・専門性ごとに管理し、VP／ディレクター／ICをチーム単位でデプロイ。新しい専門エージェントは約2週間でオンボーディングされます。'
                  : 'By 2026 Q2, roughly 250 agents were managed by role and specialty, with VP / director / IC structures deployed as teams. New specialist agents are onboarded in about two weeks.'}
              </p>
              <p>
                {ja
                  ? 'ソフトウェア開発では1日30〜50件のPRをマージし、75〜80%を人間のタッチなしで処理。初回ゲートで落ちても自動修復し、最終マージまで進めます。'
                  : 'In software delivery, 30–50 PRs are merged per day, with 75–80% processed without human touch. Failed checks can trigger automated repair before final merge.'}
              </p>
              <p>
                {ja
                  ? 'このサイト自体も成果物の一つです。一次情報の収集、解説、横断分析、公開、改善を同じワークフォースが継続運用しています。'
                  : 'This publication is itself one of the outputs: the same workforce continuously operates source capture, explanation, cross-source analysis, publishing, and improvement.'}
              </p>
              <Link to="/" className="inline-flex mt-4 text-xs font-black tracking-widest uppercase border-b-2 border-tertiary pb-1">
                {ja ? 'LIVE OUTPUTを見る →' : 'SEE THE LIVE OUTPUT →'}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="max-w-5xl">
          <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">05 / WHO IT IS FOR</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.98]">
            {ja ? '人を増やす前に、能力を増やしたいチームへ。' : 'For teams that need more capability before more headcount.'}
          </h2>
          <div className="mt-12 grid md:grid-cols-3 gap-8">
            {[
              [ja ? 'R&D / 新規事業' : 'R&D / Venture', ja ? '不確実なテーマを調査・仮説検証・実装まで高速に回す。' : 'Run uncertain research, hypothesis testing, and implementation at high speed.'],
              [ja ? 'ソフトウェア組織' : 'Software teams', ja ? '開発だけでなく、レビュー、CI/CD、運用、改善まで連続させる。' : 'Connect development with review, CI/CD, operations, and continuous improvement.'],
              [ja ? '知識集約型チーム' : 'Knowledge-intensive teams', ja ? '調査・分析・文書化を、その場限りの作業から再利用可能な知的資産へ変える。' : 'Turn research, analysis, and documentation into reusable intellectual assets.'],
            ].map(([title, body]) => (
              <div key={title} className="border-t-4 border-on-surface pt-5">
                <h3 className="text-xl font-black">{title}</h3>
                <p className="mt-4 leading-relaxed text-on-surface-variant">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-tertiary text-on-tertiary py-20 md:py-28">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <h2 className="text-4xl md:text-7xl font-black tracking-[-0.05em] leading-[0.95] max-w-5xl">
            {ja ? 'AIを導入する。ではなく、AIで仕事をする組織そのものを再設計する。' : 'Do not “adopt AI.” Redesign the organization that does the work.'}
          </h2>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link to="/" className="bg-on-tertiary text-tertiary px-7 py-4 text-xs font-black tracking-widest uppercase">
              {ja ? '実際の記事を見る →' : 'See the live publication →'}
            </Link>
            <a href="https://github.com/refluster/ai-native-article" target="_blank" rel="noreferrer" className="border-2 border-on-tertiary px-7 py-4 text-xs font-black tracking-widest uppercase">
              {ja ? 'GitHubで見る →' : 'Inspect on GitHub →'}
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
