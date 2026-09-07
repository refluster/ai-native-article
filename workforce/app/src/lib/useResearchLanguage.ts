// The Research reader's edition, resolved from the current URL. Re-runs
// whenever the query string changes (the LanguageToggle writes `?lang=`).

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { resolveLanguage, type ResearchLanguage } from './research';

export function useResearchLanguage(): ResearchLanguage {
  const { search } = useLocation();
  return useMemo(
    () =>
      resolveLanguage(
        search,
        typeof window === 'undefined' ? undefined : window.localStorage,
        typeof navigator === 'undefined' ? [] : navigator.languages ?? [],
      ),
    [search],
  );
}
