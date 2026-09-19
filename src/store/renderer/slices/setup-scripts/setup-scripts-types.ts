/**
 * Setup Scripts Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type SetupScriptsState = {
  isBannerDismissedGlobally: boolean;
  bannerDismissedByWorkspaceId: Record<string, true>;
  presenceByWorkspaceId: Record<string, SetupScriptPresenceState>;
};

export type SetupScriptPresenceState = {
  version: number;
  status: 'idle' | 'loading' | 'success' | 'error';
  hasScript: boolean | null;
};
