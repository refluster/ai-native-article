// Public landing page for workforce.kohuehara.xyz.
//
// This is the only route besides /auth/callback and /docs that renders
// outside AuthBoundary: it is what an unauthenticated visitor sees at the
// apex. The console itself starts at /feed and stays gated.

import { useEffect, useState } from 'react';
import { AUTH_IS_CONFIGURED } from '../config/auth';
import { getCurrentUser, signIn } from '../lib/auth';
import { SITE_DISPLAY_NAME } from '../config/site';
import BrandMark from '../components/BrandMark';

const CONSOLE_HOME = '/feed';

const PILLARS = [
  {
    k: 'Projects',
    h: 'Scope and authority',
    p: 'A project carries the surface it delivers to, the governance documents that apply, the credentials available and the reviewer roster. Authority is bounded by the engagement.',
  },
  {
    k: 'Skills',
    h: 'Executable job procedures',
    p: 'A skill defines input, judgment, deliverable shape and destination, and is owned by a role. Scheduled ones run as cadences — recurring work nobody has to file.',
  },
  {
    k: 'Agents',
    h: 'Professionals with a record',
    p: 'A job description, a position in the org, operating principles, long-term memory, an activity record and assignments. Judgment lives here; procedure does not.',
  },
];

export default function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!AUTH_IS_CONFIGURED) return;
    let cancelled = false;
    getCurrentUser()
      .then((u) => {
        if (!cancelled) setSignedIn(Boolean(u));
      })
      .catch(() => {
        /* an unreadable session is simply "signed out" here */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function enterConsole() {
    if (signedIn || !AUTH_IS_CONFIGURED) {
      window.location.assign(CONSOLE_HOME);
      return;
    }
    signIn(CONSOLE_HOME).catch((err) => {
      console.error('signIn redirect failed:', err);
    });
  }

  return (
    <div className="min-h-screen bg-wf-surface text-wf-on-surface flex flex-col">
      <header className="w-full max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BrandMark size={26} />
          <span className="font-headline font-bold text-[15px]">{SITE_DISPLAY_NAME}</span>
        </div>
        <nav className="flex items-center gap-4">
          <a
            href="/docs/"
            className="font-wfmono text-[11px] uppercase tracking-[0.16em] text-wf-on-surface-variant hover:text-wf-on-surface"
          >
            Docs
          </a>
          <button
            type="button"
            onClick={enterConsole}
            className="font-wfmono text-[11px] uppercase tracking-[0.16em] px-4 py-2 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90"
          >
            {signedIn ? 'Open console' : 'Sign in'}
          </button>
        </nav>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-6">
        <section className="pt-16 pb-14 border-b border-wf-outline-variant">
          <p className="font-wfmono text-[11px] uppercase tracking-[0.2em] text-wf-on-surface-variant">
            A software-defined operating organization
          </p>
          <h1 className="font-headline font-bold text-[clamp(38px,7vw,72px)] leading-[1.05] tracking-[-0.035em] mt-4">
            Software
            <br />
            Talent Network
          </h1>
          <p className="text-[clamp(17px,2.1vw,21px)] text-wf-on-surface-variant max-w-[60ch] mt-6">
            Persistent AI professionals — each with a job description, memory and a track
            record — assemble around a project, raise its value, deliver, and disband.
            One human decision-maker owns purpose and consequence.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-9">
            <button
              type="button"
              onClick={enterConsole}
              className="font-wfmono text-[12px] uppercase tracking-[0.16em] px-6 py-3 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90"
            >
              {signedIn ? 'Open console' : 'Sign in to the console'}
            </button>
            <a
              href="/docs/"
              className="font-wfmono text-[12px] uppercase tracking-[0.16em] px-6 py-3 rounded-full border border-wf-outline text-wf-on-surface hover:border-wf-primary hover:text-wf-primary"
            >
              Read the docs
            </a>
          </div>
        </section>

        <section className="py-14 border-b border-wf-outline-variant">
          <h2 className="font-headline font-bold text-[clamp(24px,3.2vw,32px)] tracking-[-0.015em]">
            Projects × Skills × Agents
          </h2>
          <p className="text-wf-on-surface-variant max-w-[64ch] mt-3">
            Three axes, defined independently and composed at run time. Each can grow without
            redoing the other two.
          </p>
          <div className="grid gap-4 mt-8 md:grid-cols-3">
            {PILLARS.map((p) => (
              <div
                key={p.k}
                className="bg-wf-surface-container-lo border border-wf-outline-variant rounded-wf-md p-5"
              >
                <div className="font-wfmono text-[11px] uppercase tracking-[0.16em] text-wf-primary">
                  {p.k}
                </div>
                <h3 className="font-headline font-bold text-[17px] mt-2">{p.h}</h3>
                <p className="text-[14.5px] text-wf-on-surface-variant mt-2">{p.p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-14">
          <h2 className="font-headline font-bold text-[clamp(24px,3.2vw,32px)] tracking-[-0.015em]">
            Read before you sign in
          </h2>
          <div className="grid gap-4 mt-8 md:grid-cols-2">
            <a
              href="/docs/whitepaper.html"
              className="block bg-wf-surface-container-lo border border-wf-outline-variant rounded-wf-md p-6 hover:border-wf-primary"
            >
              <div className="font-wfmono text-[11px] uppercase tracking-[0.16em] text-wf-primary">
                Technical whitepaper
              </div>
              <h3 className="font-headline font-bold text-[19px] mt-2">
                Capability as a governed internal asset
              </h3>
              <p className="text-[14.5px] text-wf-on-surface-variant mt-2">
                Architecture, governance, operating evidence, economics — and the limits, stated
                with what is measured and what is not.
              </p>
            </a>
            <a
              href="/docs/manifesto.html"
              className="block bg-wf-surface-container-lo border border-wf-outline-variant rounded-wf-md p-6 hover:border-wf-primary"
            >
              <div className="font-wfmono text-[11px] uppercase tracking-[0.16em] text-wf-primary">
                Manifesto
              </div>
              <h3 className="font-headline font-bold text-[19px] mt-2">
                Assemble, deliver, disband
              </h3>
              <p className="text-[14.5px] text-wf-on-surface-variant mt-2">
                What the network believes about work, professionalism, and why the project ends
                while the network goes on.
              </p>
            </a>
          </div>
        </section>
      </main>

      <footer className="w-full max-w-5xl mx-auto px-6 py-8 border-t border-wf-outline-variant font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant flex flex-wrap gap-x-6 gap-y-2">
        <span>{SITE_DISPLAY_NAME}</span>
        <a href="/docs/" className="hover:text-wf-on-surface">Docs</a>
      </footer>
    </div>
  );
}
