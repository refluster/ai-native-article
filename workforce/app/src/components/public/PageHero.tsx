// The opening block of every public page: kicker → title → lede → actions.
// Landing, Docs and Research all open this way, so a visitor moving between
// them sees the same shape at the same place. No rule under it — the
// section that follows is separated by whitespace (styles.ts).

import type { ReactNode } from 'react';
import { H1, H1_MD, KICKER, LEDE } from './styles';

interface Props {
  kicker: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** `lg` is the display size (landing, Docs); `md` suits a sentence-length
   *  title (Research). */
  size?: 'lg' | 'md';
  /** Rendered on the title row's right edge (e.g. an edition toggle). */
  aside?: ReactNode;
  /** Action row under the lede (pill buttons). */
  children?: ReactNode;
}

export default function PageHero({ kicker, title, lede, size = 'lg', aside, children }: Props) {
  return (
    <section className="pt-12 pb-10 sm:pt-16 sm:pb-12">
      <p className={KICKER}>{kicker}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <h1 className={size === 'lg' ? H1 : H1_MD}>{title}</h1>
        {aside}
      </div>
      {lede && <p className={`${LEDE} mt-6`}>{lede}</p>}
      {children && <div className="flex flex-wrap items-center gap-3 mt-9">{children}</div>}
    </section>
  );
}
