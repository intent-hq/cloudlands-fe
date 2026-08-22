/**
 * Deep Links slice types.
 * Safe to import from any process (no renderer/main dependencies).
 */

type DeepLinkActionType = 'open' | 'create' | 'clone' | 'settings';

type DeepLinkActionPayload = {
  type: DeepLinkActionType;
  params: Record<string, string>;
};

type HomePageInitializerRequest = {
  nonce: number;
  applyPrefill: boolean;
  focus: boolean;
};

export type DeepLinksState = {
  homePageInitializerRequest: HomePageInitializerRequest | null;
  pendingAction: DeepLinkActionPayload | null;
  processing: boolean;
  error: string | null;
};
