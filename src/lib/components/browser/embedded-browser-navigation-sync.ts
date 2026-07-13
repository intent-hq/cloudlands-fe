export interface EmbeddedBrowserNavigationSyncState {
  previousUrlProp: string | null;
}

export interface UrlPropNavigationDecision {
  shouldLoad: boolean;
  targetUrl: string | null;
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

  state.previousUrlProp = url;

  if (!options.webviewReady || !options.isValidBrowserUrl(url)) {
    return { shouldLoad: false, targetUrl: null };
  }

  return { shouldLoad: true, targetUrl: url };
}