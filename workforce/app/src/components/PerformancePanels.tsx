// Loads one scope's PerformanceSeries and renders the two Epic-016 decks
// (agent lifecycle + PR automation). Shared by the workforce Dashboard
// (/performance) and the per-project Performance tab so the two scopes stay
// visually + behaviourally identical. Handles loading / error / empty-scope
// states and the "* mocked" advisory the rest of the console uses.

import { useEffect, useState } from 'react';
import AgentLifecycleDeck from './AgentLifecycleDeck';
import PrAutomationDeck from './PrAutomationDeck';
import { apiConfigured, loadPerformance, type PerformanceScope } from '../lib/performance';
import type { PerformanceSeries } from '../types/performance';

export default function PerformancePanels({ scope }: { scope: PerformanceScope }) {
  const [series, setSeries] = useState<PerformanceSeries | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch whenever the scope identity changes. For a project scope that is
  // its id; for workforce it is the constant 'workforce'.
  const scopeKey = scope.kind === 'workforce' ? 'workforce' : `project:${scope.id}`;

  useEffect(() => {
    let cancelled = false;
    setSeries(undefined);
    setError(null);
    loadPerformance(scope)
      .then((s) => {
        if (!cancelled) setSeries(s ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // scope is recreated each render; key on the stable identity instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  if (error) {
    return (
      <p className="font-wfmono text-xs text-wf-throwing">
        Failed to load performance: {error}
      </p>
    );
  }
  if (series === undefined) {
    return (
      <p className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
        Loading performance…
      </p>
    );
  }
  if (series === null) {
    return (
      <p className="text-sm text-wf-on-surface-variant leading-relaxed">
        No performance series for this scope yet. Metrics appear here once the
        scope has lifecycle + PR activity in the window.
      </p>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <AgentLifecycleDeck series={series} />
      <PrAutomationDeck series={series} />
      {!apiConfigured() && (
        <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          * illustrative — wire WORKFORCE_AGENTS_API_BASE for the live roll-up
        </p>
      )}
    </div>
  );
}
