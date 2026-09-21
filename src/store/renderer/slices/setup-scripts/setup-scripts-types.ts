/**
 * Setup Scripts Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type SetupScriptsState = {
  isBannerDismissedGlobally: boolean;
  bannerDismissedByWorkspaceId: Record<string, true>;
};
