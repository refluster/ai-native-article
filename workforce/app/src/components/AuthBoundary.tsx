// Auth boundary — wraps the routed app and blocks render until a
// Cognito ID token is in hand. Three terminal states:
//
//   - authenticated → renders children
//   - unauthenticated + auth IS configured → redirects to Cognito Hosted UI
//   - auth NOT configured (missing build env) → renders a friendly
//     "configure Cognito" panel so `npm run dev` doesn't error out
//     and the deployed SPA fails loud on a misconfigured CI build
//
// Sign-in state is held in component state, not context — there's
// only one consumer (the routed tree below).

import { useEffect, useState, type ReactNode } from 'react';
import { AUTH_IS_CONFIGURED } from '../config/auth';
import { getCurrentUser, signIn } from '../lib/auth';

interface Props {
  children: ReactNode;
}

type Status = 'loading' | 'authed' | 'redirecting' | 'unconfigured';

export default function AuthBoundary({ children }: Props) {
  const [status, setStatus] = useState<Status>(
    AUTH_IS_CONFIGURED ? 'loading' : 'unconfigured',
  );

  useEffect(() => {
    if (!AUTH_IS_CONFIGURED) return;
    let cancelled = false;
    getCurrentUser()
      .then((u) => {
        if (cancelled) return;
        if (u) {
          setStatus('authed');
        } else {
          setStatus('redirecting');
          // Preserve the deep link across the Cognito round-trip — the
          // callback restores it instead of dumping the operator at "/".
          const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          signIn(returnTo).catch((err) => {
            console.error('signIn redirect failed:', err);
            if (!cancelled) setStatus('unconfigured');
          });
        }
      })
      .catch((err) => {
        console.error('getCurrentUser failed:', err);
        if (!cancelled) setStatus('unconfigured');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'authed') return <>{children}</>;

  if (status === 'unconfigured') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wf-surface px-6">
        <div className="max-w-lg border border-wf-outline-variant bg-wf-surface-container-lo p-8">
          <p className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-tertiary mb-3">
            AUTH UNCONFIGURED
          </p>
          <h1 className="text-2xl font-black tracking-tighter text-wf-on-surface uppercase mb-4">
            Cognito not wired up
          </h1>
          <p className="text-sm text-wf-on-surface-variant mb-4 leading-relaxed">
            This build is missing one or more of <code>VITE_COGNITO_USER_POOL_ID</code>,
            <code> VITE_COGNITO_CLIENT_ID</code>, or <code>VITE_COGNITO_DOMAIN</code>.
            Local dev with mock data only works in this mode; a deployed
            build at <code>workforce.kohuehara.xyz</code> reaching this
            screen means CI failed to inject one of the secrets.
          </p>
          <p className="text-sm text-wf-on-surface-variant leading-relaxed">
            Operator runbook:{' '}
            <code>workforce/infra/sam-web/README.md §6</code>
          </p>
        </div>
      </div>
    );
  }

  // 'loading' or 'redirecting' — both render the same lightweight stub.
  return (
    <div className="min-h-screen flex items-center justify-center bg-wf-surface">
      <p className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-on-surface-variant">
        AUTHENTICATING ·{status === 'redirecting' ? ' redirecting' : ' loading'}
      </p>
    </div>
  );
}
