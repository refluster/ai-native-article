// JA / EN edition switch shared by the public reading surfaces (Research
// articles, Docs documents). Writes `?lang=` so the choice is shareable,
// and remembers it in localStorage so it sticks across visits — one key
// for both surfaces, so a reader has one language. The chrome around the
// text stays English; this toggles only the edition.

import { useSearchParams } from 'react-router-dom';
import { storeLanguage, type ResearchLanguage } from '../../lib/research';

interface Props {
  value: ResearchLanguage;
  /** Accessible name of the group: what is being switched ("Article
   *  edition" on Research, "Document edition" on Docs). */
  label?: string;
}

const OPTIONS: { value: ResearchLanguage; label: string; title: string }[] = [
  { value: 'ja', label: 'JA', title: '日本語' },
  { value: 'en', label: 'EN', title: 'English' },
];

export default function LanguageToggle({ value, label = 'Article edition' }: Props) {
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
      aria-label={label}
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
