import { Link } from 'react-router-dom'
import {
  deriveTitle,
  hostnameOf,
  lookupByUrl,
  parseSourceUrls,
  type SourceIndex,
} from '../lib/source-links'
import { trackEvent } from '../lib/analytics'

interface Props {
  slug: string
  sourceUrls?: string
  index: SourceIndex
}

export default function SourcesUsedSection({ slug, sourceUrls, index }: Props) {
  const urls = parseSourceUrls(sourceUrls)
  if (urls.length === 0) return null

  function onExternalClick(href: string) {
    trackEvent({
      name: 'outbound_click',
      params: { slug, href, host: hostnameOf(href) },
    })
  }

  return (
    <section className="max-w-3xl mx-auto px-6 md:px-12 pb-12">
      <div className="border-t border-outline-variant/20 pt-10 mt-10">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
          SOURCES USED — 元になった出典
        </h3>
        <ul className="space-y-6">
          {urls.map(rawUrl => {
            const entry = lookupByUrl(index, rawUrl)
            const exp = entry?.explanation
            const host = hostnameOf(rawUrl)
            return (
              <li
                key={rawUrl}
                className="border-l-2 border-outline-variant/40 pl-5 py-1"
              >
                <div className="flex items-center gap-2 mb-2">
                  {exp?.category ? (
                    <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                      {exp.category}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                      外部のみ
                    </span>
                  )}
                  <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                    {host}
                  </span>
                </div>
                {exp ? (
                  <>
                    <Link
                      to={`/article/${exp.slug}`}
                      className="text-base md:text-lg font-extrabold tracking-tight leading-snug block mb-1 hover:text-tertiary transition-colors"
                    >
                      {exp.title}
                    </Link>
                    {exp.abstract && (
                      <p className="text-sm leading-relaxed text-on-surface-variant line-clamp-2 mb-3">
                        {exp.abstract}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm md:text-base text-on-surface-variant mb-3 break-words">
                    {deriveTitle(rawUrl)}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold tracking-widest uppercase">
                  {exp && (
                    <Link
                      to={`/article/${exp.slug}`}
                      className="border border-outline-variant/40 px-3 py-1.5 hover:border-tertiary hover:text-tertiary transition-colors"
                    >
                      解説を読む →
                    </Link>
                  )}
                  <a
                    href={rawUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onExternalClick(rawUrl)}
                    className="border border-outline-variant/40 px-3 py-1.5 hover:border-tertiary hover:text-tertiary transition-colors inline-flex items-center gap-1"
                  >
                    元記事 ↗
                  </a>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
