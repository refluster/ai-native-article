// /account — the operator's own account page. This is where the "Me"
// avatar in the global nav now lands (it used to jump to /performance,
// which conflated "my account" with "the network's dashboard").
//
// The page surfaces:
//   - the operator identity card (name / headline / location from
//     config/site OPERATOR), echoing the feed's left-rail profile card;
//   - the signed-in session details (email / name) read from the Cognito
//     ID token when auth is configured;
//   - the Sign-out control, relocated here from the global nav header —
//     sign-out is a deliberate, infrequent action that belongs on the
//     account page, not as a permanent top-level button.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import { SITE_DISPLAY_NAME, OPERATOR } from '../config/site';
import { AUTH_IS_CONFIGURED } from '../config/auth';
import { getCurrentUser, signOut } from '../lib/auth';

type SessionClaims = {
  email?: string;
  name?: string;
  sub?: string;
};

export default function Account() {
  const [claims, setClaims] = useState<SessionClaims | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Account`;
    if (!AUTH_IS_CONFIGURED) return;
    let cancelled = false;
    getCurrentUser()
      .then((u) => {
        if (cancelled || !u) return;
        const p = u.profile as SessionClaims;
        setClaims({ email: p.email, name: p.name, sub: p.sub });
      })
      .catch(() => {
        /* getCurrentUser already logs; the page degrades to operator config. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <WorkforceLayout>
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Identity card */}
        <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-xl overflow-hidden">
          <div className="h-16 bg-wf-secondary" aria-hidden />
          <div className="px-5 sm:px-6 pb-6">
            <div className="-mt-9 mb-3">
              <span className="inline-flex items-center justify-center w-[72px] h-[72px] rounded-full bg-wf-primary text-wf-on-primary font-headline font-black text-2xl border-2 border-wf-surface-container-lo">
                {OPERATOR.initials}
              </span>
            </div>
            <h1 className="font-headline text-2xl font-bold tracking-tight text-wf-on-surface leading-tight">
              {OPERATOR.name}
            </h1>
            <p className="text-sm text-wf-on-surface-variant mt-0.5">{OPERATOR.headline}</p>
            <p className="text-[13px] text-wf-on-surface-variant mt-0.5">{OPERATOR.location}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/performance"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-wf-md bg-wf-primary text-wf-on-primary text-sm font-headline font-medium hover:bg-wf-secondary transition-colors"
              >
                View performance
              </Link>
              <Link
                to="/agents"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-wf-md border border-wf-secondary text-wf-secondary text-sm font-headline font-medium hover:bg-wf-surface-container-hi transition-colors"
              >
                My network
              </Link>
            </div>
          </div>
        </section>

        {/* Session / account details */}
        <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-wf-outline-variant">
            <h2 className="font-wfmono text-[10px] uppercase tracking-[0.16em] text-wf-on-surface-variant">
              Account · session
            </h2>
          </div>
          <dl className="divide-y divide-wf-outline-variant">
            <Row label="Operator" value={OPERATOR.name} />
            <Row label="Organization" value={SITE_DISPLAY_NAME} />
            {AUTH_IS_CONFIGURED ? (
              <>
                <Row label="Email" value={claims?.email ?? '—'} mono />
                {claims?.name && <Row label="Signed in as" value={claims.name} />}
                <Row
                  label="Session"
                  value={claims ? 'Active · Cognito (Google federation)' : 'Resolving…'}
                />
              </>
            ) : (
              <Row
                label="Session"
                value="Auth not configured (local/dev) — running on mock identity"
              />
            )}
          </dl>
        </section>

        {/* Sign out — relocated here from the global nav header. */}
        <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-lg p-5">
          <h2 className="font-headline font-semibold text-wf-on-surface">Sign out</h2>
          <p className="text-[13px] text-wf-on-surface-variant mt-1 leading-relaxed">
            Ends this session and clears the federated Cognito login. You'll be
            returned to the sign-in screen.
          </p>
          {AUTH_IS_CONFIGURED ? (
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut();
              }}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-wf-md border border-wf-tertiary text-wf-tertiary text-sm font-headline font-medium hover:bg-wf-tertiary hover:text-wf-on-tertiary disabled:opacity-60 transition-colors"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          ) : (
            <p className="mt-3 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              Sign-out unavailable — auth not configured in this build.
            </p>
          )}
        </section>
      </div>
    </WorkforceLayout>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-5 py-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-3 items-baseline">
      <dt className="font-wfmono text-[11px] uppercase tracking-[0.1em] text-wf-on-surface-variant">
        {label}
      </dt>
      <dd className={`text-sm text-wf-on-surface break-words ${mono ? 'font-wfmono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
