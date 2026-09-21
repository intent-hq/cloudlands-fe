import type { GitHubDeviceFlow } from '$features/github-auth/types';

/** Forge providers the daemon's `sourceControl.*` namespace accepts. */
export type ForgeProvider = 'github' | 'gitlab';

/** How the stored credential was obtained (`sourceControl.authStatus.method`). */
export type ForgeAuthMethod = 'device' | 'pat' | 'env';

/**
 * Device-grant codes shown to the user — the same user-facing shape the
 * GitHub device flow carries (never the `device_code` or a token).
 */
export type ForgeDeviceFlow = GitHubDeviceFlow;

/** In-flight device-grant codes held by the slice (status modelled separately). */
export type ForgeDeviceFlowInfo = Omit<ForgeDeviceFlow, 'status'>;

/**
 * Derived forge identity (`sourceControl.authStatus.user` / `sourceControl.getUser`).
 * `id` is the forge user id rendered as a string on the wire.
 */
export interface ForgeUser {
  id: string;
  login: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * `sourceControl.authStatus` result: the `github.authStatus` shape plus the
 * additive provider-generic fields.
 */
export interface ForgeAuthStatus {
  provider: ForgeProvider;
  host: string;
  isConfigured: boolean;
  oauthUrl: string;
  configuredButNeedsUpdate: boolean;
  updatedScopes: string;
  deviceFlow?: ForgeDeviceFlow | null;
  method: ForgeAuthMethod | null;
  user?: ForgeUser | null;
  /**
   * False when no OAuth client id resolves for the host or the instance does
   * not support the device grant — the UI then leads with the PAT path.
   */
  deviceGrantSupported: boolean;
}

/** `sourceControl.connect` params. `token` is only sent for `method: "pat"`. */
export interface ForgeConnectParams {
  provider: ForgeProvider;
  host?: string;
  /** Credential acquisition path: device grant (default) or a PAT. */
  method?: 'device' | 'pat';
  token?: string;
}

/** Stable `error.data.code` values the connect flow keys UI decisions on. */
export type ForgeConnectErrorCode = 'device-grant-unsupported' | 'source-control-unauthorized';

/** Seam envelope for `sourceControl.connect`. */
export interface ForgeConnectResult {
  success: boolean;
  error?: string;
  code?: ForgeConnectErrorCode;
  /** Device-grant codes when a device flow was started (or is still pending). */
  deviceFlow?: ForgeDeviceFlowInfo;
}

/** Seam envelope for `sourceControl.cancelAuth` / `sourceControl.revoke`. */
export interface ForgeAuthResult {
  success: boolean;
  error?: string;
}
