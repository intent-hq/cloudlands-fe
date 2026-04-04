/**
 * Deep Links slice types.
 * Safe to import from any process (no renderer/main dependencies).
 */

export type DeepLinkActionType = "open" | "create" | "clone" | "settings";

export type DeepLinkActionPayload = {
  type: DeepLinkActionType;
  params: Record<string, string>;
};

export type HomePageInitializerRequest = {
  nonce: number;
  applyPrefill: boolean;
  focus: boolean;
};

export type HomePageInitializerRequestPayload = {
  applyPrefill?: boolean;
  focus?: boolean;
};

export type DeepLinksState = {
  homePageInitializerRequest: HomePageInitializerRequest | null;
  pendingAction: DeepLinkActionPayload | null;
  processing: boolean;
  error: string | null;
};

