import type { ForgeAuthMethod, ForgeDeviceFlowInfo, ForgeUser } from '$features/forge-auth/types';

/** Terminal transitions carried by `sourceControl:auth-changed { status }`. */
export type GitLabAuthChangedStatus = 'authorized' | 'expired' | 'denied' | 'error' | 'revoked';

export type GitLabAuthState = {
  /** Canonical status belongs to the current owner admission; pending is not a host. */
  statusReady: boolean;
  /** GitLab instance host the connection targets (defaults to gitlab.com) */
  host: string;
  /** Null until an explicit root or the daemon's configured root is known. */
  instanceBaseUrl: string | null;
  /** Whether a GitLab credential is configured daemon-side */
  isConfigured: boolean;
  /** Whether a connect (device grant or PAT) is in progress */
  isAuthenticating: boolean;
  isCancelling: boolean;
  cancelOutcome: 'cancelled' | 'already-started' | 'failed' | null;
  /** Device-grant codes while a flow is pending (null otherwise) */
  deviceFlow: ForgeDeviceFlowInfo | null;
  /**
   * Whether the host supports the device grant; false ⇒ lead with the PAT
   * path. `null` until the daemon has reported the status for `host` — the
   * device grant is attempted first until then.
   */
  deviceGrantSupported: boolean | null;
  /** Derived GitLab identity (if configured) */
  user: ForgeUser | null;
  /** Error message if any */
  error: string | null;
  /** How the stored credential was obtained; null when not configured */
  method: ForgeAuthMethod | null;
};
