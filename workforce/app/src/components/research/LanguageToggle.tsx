// JA / EN edition switch for the Research surface. Writes `?lang=` so the
// choice is shareable, and remembers it in localStorage so it sticks
// across visits. The chrome around the articles stays English; this
// toggles only the article edition.

import { useSearchParams } from 'react-router-dom';
import { storeLanguage, type ResearchLanguage } from '../../lib/research';

interface Props {
  value: ResearchLanguage;
}

const OPTIONS: { value: ResearchLanguage; label: string; title: string }[] = [
  { value: 'ja', label: 'JA', title: '日本語' },
  { value: 'en', label: 'EN', title: 'English' },
];

export default function LanguageToggle({ value }: Props) {
  const [params, setParams] = useSearchParams();

  function choose(next: ResearchLanguage) {
    if (next === value) return;
    storeLanguage(next, typeof window === 'undefined' ? undefined : window.localStorage);
    const p = new URLSearchParams(params);
    p.set('lang', next);
    setParams(p, { replace: true });
  }

  return (
    <div
      role="group"
      aria-label="Article edition"
      className="inline-flex items-center rounded-full border border-wf-outline-variant bg-wf-surface-container-lo p-0.5"
    >
      {OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => choose(o.value)}
          className={`font-wfmono text-[11px] uppercase tracking-[0.14em] px-3 py-1 rounded-full transition-colors ${
            o.value === value
              ? 'bg-wf-primary text-wf-on-primary'
              : 'text-wf-on-surface-variant hover:text-wf-on-surface'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
