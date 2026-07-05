// Placeholder scaffold for network destinations that exist in the nav
// but aren't built yet (Jobs / Messaging / Notifications). Each renders a
// titled "coming soon" panel that frames where the feature is headed in
// the talent-network vision, so the route is honest rather than blank.

import { useEffect, type ReactNode } from 'react';
import WorkforceLayout from './WorkforceLayout';
import Typeplate from './Typeplate';
import { SITE_DISPLAY_NAME } from '../config/site';

interface Props {
  label: string;
  title: string;
  lede: string;
  /** Bullet teasers describing the planned shape of the feature. */
  bullets: string[];
  icon: ReactNode;
}

export default function ComingSoon({ label, title, lede, bullets, icon }: Props) {
  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — ${title}`;
  }, [title]);

  return (
    <WorkforceLayout>
      <section className="max-w-2xl">
        <Typeplate label={label} value="ROADMAP · NOT YET LIVE" className="mb-4" />
        <div className="flex items-start gap-4">
          <span className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-wf-md bg-wf-surface-container text-wf-primary">
            {icon}
          </span>
          <div>
            <h1 className="font-headline text-3xl sm:text-4xl font-black tracking-tighter leading-[1.05] text-wf-on-surface">
              {title}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-wf-on-surface-variant leading-relaxed">{lede}</p>
          </div>
        </div>

        <ul className="mt-8 space-y-3">
          {bullets.map((b) => (
            <li
              key={b}
              className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 text-sm text-wf-on-surface flex gap-3"
            >
              <span className="mt-1 w-1.5 h-1.5 bg-wf-tertiary shrink-0" aria-hidden />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <p className="mt-8 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          Placeholder — wired into the nav, no backend behind it yet.
        </p>
      </section>
    </WorkforceLayout>
  );
}
