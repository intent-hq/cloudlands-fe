export interface EmbeddedBrowserNavigationSyncState {
  previousUrlProp: string | null;
}

export interface UrlPropNavigationDecision {
  shouldLoad: boolean;
  targetUrl: string | null;
}

export interface EmbeddedBrowserWebviewNavigationTarget {
  loadURL: (url: string) => Promise<void>;
}

export function navigateEmbeddedBrowserWebview(
  webview: EmbeddedBrowserWebviewNavigationTarget,
  url: string,
): Promise<void> {
  return webview.loadURL(url);
}

export function createEmbeddedBrowserNavigationSyncState(
  initialUrl: string | null | undefined,
): EmbeddedBrowserNavigationSyncState {
  return { previousUrlProp: initialUrl || null };
}

export function recordEmbeddedBrowserNavigation(
  state: EmbeddedBrowserNavigationSyncState,
  navigatedUrl: string,
): void {
  state.previousUrlProp = navigatedUrl;
}

export function reconcileEmbeddedBrowserLoadCompletion(
  state: EmbeddedBrowserNavigationSyncState,
  requestedUrl: string,
  loadedUrl: string | null | undefined,
): string | null {
  const finalUrl = loadedUrl || requestedUrl;
  if (state.previousUrlProp === finalUrl) return null;
  state.previousUrlProp = finalUrl;
  return finalUrl;
}

export function reconcileEmbeddedBrowserUrlProp(
  state: EmbeddedBrowserNavigationSyncState,
  url: string,
  options: {
    webviewReady: boolean;
    isValidBrowserUrl: (url: string) => boolean;
  },
): UrlPropNavigationDecision {
  if (!url) return { shouldLoad: false, targetUrl: null };

  if (state.previousUrlProp === null) {
    state.previousUrlProp = url;
    return { shouldLoad: false, targetUrl: null };
  }

  if (url === state.previousUrlProp) {
    return { shouldLoad: false, targetUrl: null };
  }

  // Defer — do NOT consume — a prop change that lands while the webview is
  // still loading (mounted but not ready). Leaving previousUrlProp untouched
  // makes the readiness flip re-run the reconcile and load the URL then;
  // consuming it here would strand the webview on its in-flight page while
  // the store already points elsewhere (e.g. a restart-rehydrated tab whose
  // fresh tunnel URL resolves during the dead initial load, monorepo#2789).
  if (!options.webviewReady) {
    return { shouldLoad: false, targetUrl: null };
  }

  state.previousUrlProp = url;

  if (!options.isValidBrowserUrl(url)) {
    return { shouldLoad: false, targetUrl: null };
  }

  return { shouldLoad: true, targetUrl: url };
}
