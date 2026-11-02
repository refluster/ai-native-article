// A console deploy syncs `assets/` with --delete, so a tab opened before the
// deploy fails its next dynamic import with "Failed to fetch dynamically
// imported module" (issue 844, mateo M4). Vite surfaces that as a
// `vite:preloadError` window event; reloading once fetches the new index and
// its chunk names. One reload per tab session, guarded by sessionStorage, so a
// genuinely missing chunk cannot loop — the page's own error card then shows
// (C-4: fail loud, never loop silently).

const KEY = 'wf:preload-reloaded';

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Returns true when a reload was triggered, false when already spent. */
export function reloadOnceOnPreloadError(
  store: Store | undefined,
  reload: () => void,
): boolean {
  try {
    if (store?.getItem(KEY)) return false;
    store?.setItem(KEY, '1');
  } catch {
    // Storage blocked: reloading without a guard could loop. Do nothing.
    return false;
  }
  reload();
  return true;
}

export function installPreloadErrorReload(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', event => {
    let store: Store | undefined;
    try {
      store = window.sessionStorage;
    } catch {
      store = undefined;
    }
    if (store && reloadOnceOnPreloadError(store, () => window.location.reload())) {
      event.preventDefault();
    }
  });
}
