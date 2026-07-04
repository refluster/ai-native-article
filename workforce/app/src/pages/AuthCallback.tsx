// /auth/callback — the OAuth code-exchange landing page. Cognito sends
// the operator here after they finish the Google consent screen. We
// complete the PKCE flow, then send the operator BACK TO WHERE THEY WERE
// (the deep link captured at redirect time via the OIDC state / a
// sessionStorage fallback) — never unconditionally to "/".

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeSignIn, consumeReturnTo } from '../lib/auth';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeSignIn()
      .then((user) => {
        navigate(consumeReturnTo(user), { replace: true });
      })
      .catch((err) => {
        console.error('completeSignIn failed:', err);
        setError(err?.message || 'sign-in failed');
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wf-surface px-6">
        <div className="max-w-lg border border-wf-outline-variant bg-wf-surface-container-lo p-8">
          <p className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-tertiary mb-3">
            SIGN-IN FAILED
          </p>
          <p className="text-sm text-wf-on-surface-variant mb-4">{error}</p>
          <a
            href="/"
            className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-primary hover:underline"
          >
            ← BACK TO CONSOLE
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-wf-surface">
      <p className="font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-on-surface-variant">
        FINISHING SIGN-IN
      </p>
    </div>
  );
}
