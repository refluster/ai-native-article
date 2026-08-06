import { useLanguage } from '../../i18n/LanguageProvider'
import { LANGUAGES, type Language } from '../../i18n/language'
import { trackEvent } from '@kohuehara/shared/analytics'

const LABELS: Record<Language, string> = { ja: 'JA', en: 'EN' }

/**
 * The manual language switch.
 *
 * Two buttons rather than a dropdown: with exactly two editions a select is a
 * click more for no information gained, and the pair doubles as the indicator
 * of which edition you are reading. Styling follows the header's existing
 * 10px/bold/tracked-widest meta type so it reads as chrome, not as a control
 * competing with the wordmark.
 */
export default function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage()

  function onSelect(next: Language) {
    if (next === language) return
    setLanguage(next)
    trackEvent({ name: 'language_switch', params: { from: language, to: next } } as never)
  }

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={t('lang.label')}
    >
      {LANGUAGES.map((code, i) => (
        <span key={code} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className="text-outline-variant/60 text-[10px]">/</span>}
          <button
            type="button"
            onClick={() => onSelect(code)}
            aria-current={code === language ? 'true' : undefined}
            className={`text-[10px] font-bold tracking-widest uppercase transition-colors pb-1 border-b-2 ${
              code === language
                ? 'text-on-surface border-tertiary'
                : 'text-outline border-transparent hover:text-on-surface'
            }`}
          >
            {LABELS[code]}
          </button>
        </span>
      ))}
    </div>
  )
}
