import { Link } from 'react-router-dom'
import {
  hostnameOf,
  lookupByUrl,
  parseSourceUrls,
  type SourceIndex,
} from '../../lib/source-links'
import { displayTag } from '../../lib/article-types'
import { trackEvent } from '@kohuehara/shared/analytics'
import { useLanguage } from '../../i18n/LanguageProvider'
import { localizedAbstract, localizedTitle } from '../../i18n/article'

interface Props {
  slug: string
  sourceUrls?: string
  index: SourceIndex
}

export default function AnalysesUsingSection({ slug, sourceUrls, index }: Props) {
  const { language, t } = useLanguage()
  const urls = parseSourceUrls(sourceUrls)
  if (urls.length === 0) return null
  const externalUrl = urls[0]
  const entry = lookupByUrl(index, externalUrl)
  const analyses = entry?.analyses ?? []

  function onExternalClick() {
    trackEvent({
      name: 'outbound_click',
      params: { slug, href: externalUrl, host: hostnameOf(externalUrl) },
    })
  }

  return (
    <section className="max-w-3xl mx-auto px-6 md:px-12 pb-12">
      <div className="border-t border-outline-variant/20 pt-10 mt-10">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
          {t('sources.originalSource')}
        </h3>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onExternalClick}
          className="inline-flex items-center gap-2 text-sm md:text-base font-bold mb-2 hover:text-tertiary transition-colors break-all"
        >
          {hostnameOf(externalUrl)} ↗
        </a>
        <p className="text-[11px] text-outline break-all mb-8">{externalUrl}</p>

        {analyses.length > 0 && (
          <>
            <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
              {t('sources.featuredIn')}
            </h3>
            <ul className="space-y-6">
              {analyses.map(a => (
                <li key={a.slug} className="border-l-2 border-tertiary/60 pl-5 py-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                      {displayTag(a.category)}
                    </span>
                    <span className="text-[10px] font-medium tracking-widest text-outline uppercase">
                      {a.date}
                    </span>
                  </div>
                  <Link
                    to={`/article/${a.slug}`}
                    className="text-base md:text-lg font-extrabold tracking-tight leading-snug block mb-1 hover:text-tertiary transition-colors"
                  >
                    {localizedTitle(a, language)}
                  </Link>
                  <p className="text-sm leading-relaxed text-on-surface-variant line-clamp-2">
                    {localizedAbstract(a, language)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
