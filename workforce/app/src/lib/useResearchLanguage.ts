// The reader's edition, resolved from the current URL. Re-runs whenever
// the query string changes (the LanguageToggle writes `?lang=`). Shared by
// the Research and Docs surfaces; `fallback` is what a browser that names
// neither language gets (Research: ja, Docs: en — see lib/research.ts).

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { resolveLanguage, type ResearchLanguage } from './research';

export function useResearchLanguage(fallback: ResearchLanguage = 'ja'): ResearchLanguage {
  const { search } = useLocation();
  return useMemo(
    () =>
      resolveLanguage(
        search,
        typeof window === 'undefined' ? undefined : window.localStorage,
        typeof navigator === 'undefined' ? [] : navigator.languages ?? [],
        fallback,
      ),
    [search, fallback],
  );
}
