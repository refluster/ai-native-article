// One card that links somewhere: kicker, title, description, optional
// call-to-action. The landing page's "read before you sign in" grid, the
// Docs index and a document's "continue reading" footer all use it, so a
// document is presented the same way wherever it is offered.

import { Link } from 'react-router-dom';
import { CARD_LINK, KICKER_ACCENT } from './styles';

interface Props {
  to: string;
  kicker: string;
  title: string;
  description: string;
  /** Mono uppercase line at the bottom ("Read the whitepaper"). */
  cta?: string;
  /** BCP-47 tag when the card's text is not in the page language. */
  lang?: string;
  /** `lg` for a stacked list of few items; `md` for a grid. */
  size?: 'lg' | 'md';
  /** Plain anchor for another origin; router link otherwise. */
  external?: boolean;
}

export default function LinkCard({ to, kicker, title, description, cta, lang, size = 'md', external }: Props) {
  const titleClass =
    size === 'lg'
      ? 'font-headline font-bold text-[22px] leading-snug mt-2'
      : 'font-headline font-bold text-[19px] leading-snug mt-2';
  const body = (
    <>
      <div className={KICKER_ACCENT}>{kicker}</div>
      <h3 className={titleClass}>{title}</h3>
      <p className="text-[14.5px] leading-relaxed text-wf-on-surface-variant mt-2 max-w-[64ch]">{description}</p>
      {cta && (
        <span className="inline-block mt-4 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-primary">
          {cta} →
        </span>
      )}
    </>
  );
  const className = `${CARD_LINK} p-6`;
  if (external) {
    return (
      <a href={to} className={className} lang={lang} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }
  return (
    <Link to={to} className={className} lang={lang}>
      {body}
    </Link>
  );
}
