import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { setSystemSeo } from '../lib/seo'
import { trackEvent } from '@kohuehara/shared/analytics'

const metrics = [
  { value: '≈250', label: 'specialist agents' },
  { value: '30–50', label: 'PRs merged / day' },
  { value: '75–80%', label: 'touchless merge rate' },
  { value: '16,000', label: 'peak lines of code / day' },
]

const problems = [
  'Every new project means hiring, outsourcing, and onboarding all over again.',
  'AI speeds up individual tasks, but review, coordination, and operations become the next bottleneck.',
  'Knowledge disappears into chats and meetings instead of compounding into reusable organizational assets.',
]

const capabilities = [
  {
    step: '01',
    title: 'Decompose the work',
    body: 'Turn ambiguous goals into machine-executable stages for research, analysis, hypothesis generation, implementation, review, and operations.',
  },
  {
    step: '02',
    title: 'Deploy specialists',
    body: 'Deploy agents with explicit roles, skills, and decision criteria as a project team—not as a single generic assistant.',
  },
  {
    step: '03',
    title: 'Gate quality',
    body: 'Separate creation from review, then use layered quality gates and auto-repair to expand the work that can progress without human touch.',
  },
  {
    step: '04',
    title: 'Compound the learning',
    body: 'Store trial-and-error as skills, rules, and knowledge that can be reused by the next project. The system does not reset to zero.',
  },
]

const comparisons = [
  ['Copilot / ChatGPT', 'Makes an individual faster', 'Runs work across an organization'],
  ['RPA / Workflow', 'Automates predefined steps', 'Advances uncertain work through judgment'],
  ['Outsourcing / Consulting', 'Delivers an output and leaves', 'Leaves knowledge and operating capability behind'],
  ['Human-only teams', 'Requires hiring, training, and fixed cost first', 'Starts small and scales only the capabilities needed'],
]

const audiences = [
  {
    title: 'R&D and new business',
    body: 'Explore more hypotheses without staffing every possibility in advance.',
  },
  {
    title: 'Software teams',
    body: 'Extend delivery beyond code generation into review, testing, remediation, and operations.',
  },
  {
    title: 'Knowledge-intensive teams',
    body: 'Turn research, analysis, and institutional knowledge into a reusable operating asset.',
  },
]

export default function System() {
  useEffect(() => {
    setSystemSeo('en')
  }, [])

  return (
    <div className="overflow-hidden">
      <section className="max-w-[1440px] mx-auto px-6 md:px-12 pt-20 md:pt-28 pb-16 md:pb-24">
        <div className="max-w-5xl">
          <p className="text-[10px] md:text-xs font-bold tracking-[0.22em] text-tertiary uppercase mb-8">
            AI WORKFORCE / OPERATING SYSTEM FOR KNOWLEDGE WORK
          </p>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-[-0.06em] leading-[0.93] max-w-6xl">
            Don’t just use AI. Build an organization with it.
          </h1>
          <p className="mt-8 text-lg md:text-2xl leading-relaxed text-on-surface-variant max-w-3xl">
            Research, analysis, software delivery, review, and operations—run by specialist agents deployed as a team, not a one-off prompt.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              to="/"
              onClick={() => trackEvent({ name: 'system_cta_click', params: { target: 'articles' } })}
              className="inline-flex items-center justify-center bg-on-surface text-surface px-7 py-4 text-xs font-black tracking-widest uppercase hover:opacity-85 transition-opacity"
            >
              See the live publication →
            </Link>
            <a
              href="https://github.com/refluster/ai-native-article"
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent({ name: 'system_cta_click', params: { target: 'github' } })}
              className="inline-flex items-center justify-center border-2 border-on-surface px-7 py-4 text-xs font-black tracking-widest uppercase hover:bg-on-surface hover:text-surface transition-colors"
            >
              Inspect the implementation on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="border-y border-outline-variant/30 bg-surface-variant/20">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 grid grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric, index) => (
            <div
              key={metric.value}
              className={`py-8 md:py-10 ${index > 0 ? 'lg:border-l lg:border-outline-variant/30 lg:pl-8' : ''}`}
            >
              <div className="text-4xl md:text-5xl font-black tracking-tighter">{metric.value}</div>
              <div className="mt-2 text-[10px] md:text-xs font-bold tracking-widest uppercase text-outline">
                {metric.label}
              </div>
            </div>
          ))}
        </div>
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pb-6 text-[10px] tracking-wide text-outline">
          Operating snapshot as of 2026 Q2, based on internal activity logs and repository records.
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">01 / PROBLEM</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.98]">
              Knowledge work does not scale just by adding people.
            </h2>
          </div>
          <div className="lg:col-span-7 divide-y divide-outline-variant/30 border-y border-outline-variant/30">
            {problems.map((problem, index) => (
              <div key={problem} className="py-7 flex gap-6">
                <span className="text-xs font-black text-tertiary">0{index + 1}</span>
                <p className="text-xl md:text-2xl leading-relaxed">{problem}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-on-surface text-surface py-24 md:py-32">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">02 / DIFFERENCE</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] max-w-4xl leading-[0.98]">
            Not one AI. A workforce with process and roles.
          </h2>
          <div className="mt-14 overflow-x-auto">
            <div className="min-w-[720px] border-t border-surface/30">
              <div className="grid grid-cols-[1.1fr_1.3fr_1.6fr] text-[10px] font-bold tracking-widest uppercase text-surface/60 py-4 border-b border-surface/30">
                <div>Compared with</div>
                <div>Typical model</div>
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
          Do not optimize generation. Redesign the whole flow of work.
        </h2>
        <div className="mt-16 grid md:grid-cols-2 gap-px bg-outline-variant/30 border border-outline-variant/30">
          {capabilities.map(capability => (
            <div key={capability.step} className="bg-surface p-8 md:p-10 min-h-[280px] flex flex-col">
              <span className="text-xs font-black text-tertiary">{capability.step}</span>
              <h3 className="mt-10 text-3xl font-black tracking-tight">{capability.title}</h3>
              <p className="mt-5 text-base md:text-lg leading-relaxed text-on-surface-variant">
                {capability.body}
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
                This is not a concept. It is already operating.
              </h2>
            </div>
            <div className="lg:col-span-7 space-y-8 text-lg md:text-xl leading-relaxed">
              <p>
                By 2026 Q2, roughly 250 agents were managed by role and specialty, with VP / director / IC structures deployed as teams. New specialist agents are onboarded in about two weeks.
              </p>
              <p>
                In software delivery, 30–50 PRs are merged per day, with 75–80% processed without human touch. Failed checks can trigger automated repair before final merge.
              </p>
              <p>
                This publication is itself one of the outputs. The same workforce continuously operates source capture, explanation, cross-source analysis, publishing, and improvement.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-5">05 / WHO IT IS FOR</p>
        <h2 className="text-4xl md:text-6xl font-black tracking-[-0.05em] max-w-4xl leading-[0.98]">
          Increase capability before you increase headcount.
        </h2>
        <div className="mt-14 grid md:grid-cols-3 gap-px bg-outline-variant/30 border border-outline-variant/30">
          {audiences.map(audience => (
            <div key={audience.title} className="bg-surface p-8 md:p-10">
              <h3 className="text-2xl font-black tracking-tight">{audience.title}</h3>
              <p className="mt-5 leading-relaxed text-on-surface-variant">{audience.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-on-surface text-surface py-24 md:py-32">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <p className="text-[10px] font-bold tracking-widest text-tertiary uppercase mb-6">SEE IT RUN</p>
          <h2 className="text-4xl md:text-7xl font-black tracking-[-0.055em] max-w-5xl leading-[0.96]">
            The strongest proof of an AI workforce is the work it keeps shipping.
          </h2>
          <p className="mt-7 text-lg md:text-xl text-surface/70 max-w-3xl leading-relaxed">
            Read the publication it operates, then inspect the system behind it.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              to="/"
              onClick={() => trackEvent({ name: 'system_cta_click', params: { target: 'articles_final' } })}
              className="inline-flex items-center justify-center bg-surface text-on-surface px-7 py-4 text-xs font-black tracking-widest uppercase hover:opacity-85 transition-opacity"
            >
              Read the output →
            </Link>
            <a
              href="https://github.com/refluster/ai-native-article"
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent({ name: 'system_cta_click', params: { target: 'github_final' } })}
              className="inline-flex items-center justify-center border-2 border-surface px-7 py-4 text-xs font-black tracking-widest uppercase hover:bg-surface hover:text-on-surface transition-colors"
            >
              Inspect the system
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
