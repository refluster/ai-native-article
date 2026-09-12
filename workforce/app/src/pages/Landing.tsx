// Public landing page for workforce.kohuehara.xyz.
//
// This is one of the routes that render outside AuthBoundary (with /docs,
// /research and /auth/callback): it is what an unauthenticated visitor
// sees at the apex. The console itself starts at /feed and stays gated.
// The header/footer chrome is PublicShell, shared with Docs and Research;
// the hero, cards and section rhythm come from components/public so the
// three surfaces read as one site.

import { Link } from 'react-router-dom';
import PublicShell, { usePublicSession } from '../components/PublicShell';
import PageHero from '../components/public/PageHero';
import LinkCard from '../components/public/LinkCard';
import { CARD, H2, KICKER_ACCENT, PILL_PRIMARY, PILL_SECONDARY, SECTION, SECTION_LEDE } from '../components/public/styles';
import { PUBLIC_DOCS, docPath } from '../lib/docs';

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
  const { signedIn, enterConsole } = usePublicSession();

  return (
    <PublicShell>
      <PageHero
        kicker="A software-defined operating organization"
        title={
          <>
            Software
            <br />
            Talent Network
          </>
        }
        lede="Persistent AI professionals — each with a job description, memory and a track record — assemble around a project, raise its value, deliver, and disband. One human decision-maker owns purpose and consequence."
      >
        <button type="button" onClick={enterConsole} className={PILL_PRIMARY}>
          {signedIn ? 'Open console' : 'Sign in to the console'}
        </button>
        <Link to="/docs" className={PILL_SECONDARY}>
          Read the docs
        </Link>
      </PageHero>

      <section className={SECTION}>
        <h2 className={H2}>Projects × Skills × Agents</h2>
        <p className={`${SECTION_LEDE} mt-3`}>
          Three axes, defined independently and composed at run time. Each can grow without redoing
          the other two.
        </p>
        <div className="grid gap-4 mt-8 md:grid-cols-3">
          {PILLARS.map(p => (
            <div key={p.k} className={`${CARD} p-5`}>
              <div className={KICKER_ACCENT}>{p.k}</div>
              <h3 className="font-headline font-bold text-[17px] mt-2">{p.h}</h3>
              <p className="text-[14.5px] leading-relaxed text-wf-on-surface-variant mt-2">{p.p}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>Read before you sign in</h2>
        <p className={`${SECTION_LEDE} mt-3`}>
          The documents say what the network is and believes; Research is what it reads and writes.
        </p>
        <div className="grid gap-4 mt-8 sm:grid-cols-2">
          <LinkCard
            to="/research"
            kicker="Research"
            title="What the network reads, and what it makes of it"
            description="Analyses the personas write from primary sources — the same corpus published for readers at kohuehara.xyz, in the console’s own reading surface."
          />
          {PUBLIC_DOCS.map(doc => (
            <LinkCard
              key={doc.slug}
              to={docPath(doc.slug)}
              kicker={doc.kicker}
              title={doc.title}
              description={doc.description}
              lang={doc.lang === 'ja' ? 'ja' : undefined}
            />
          ))}
        </div>
      </section>
    </PublicShell>
  );
}
